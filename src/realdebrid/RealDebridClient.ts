import { RealDebridError } from '@/realdebrid/RealDebridError.ts';
import type { ActiveTorrentCount, CreatedResource, Download, Page, Torrent, TorrentInfo, TranscodeLinks, UnrestrictedLink, User } from '@/realdebrid/types.ts';
import { sleep as realSleep, type Sleep } from '@/util/sleep.ts';

const BASE_URL = 'https://api.real-debrid.com/rest/1.0';

/** Entries requested per page when walking a whole listing (the API accepts up to 5000). */
const FULL_LISTING_PAGE_SIZE = 1000;

export interface RealDebridClientOptions {
	/** Private API token, sent as `Authorization: Bearer`. */
	token: string;
	fetch?: typeof fetch;
	sleep?: Sleep;
	now?: () => number;
	/**
	 * Minimum spacing between requests. The API allows 250 requests per minute and refused
	 * requests still count, so the default (250 ms = 240/min) keeps bulk operations under it.
	 */
	minIntervalMs?: number;
	/** How many times a rate-limited (HTTP 429) request is retried, with exponential backoff. */
	maxRetries?: number;
	baseUrl?: string;
}

interface RequestOptions {
	query?: Record<string, string | number | undefined>;
	/** Sent as `application/x-www-form-urlencoded`, the encoding the API documents for POST parameters. */
	form?: Record<string, string>;
	body?: BodyInit;
	contentType?: string;
}

/**
 * Thin, typed client for the Real-Debrid REST API v1.0. It only knows the protocol:
 * authentication, encoding, pagination, throttling, rate-limit retries and error mapping.
 */
export class RealDebridClient {
	private readonly token: string;
	private readonly fetch: typeof fetch;
	private readonly sleep: Sleep;
	private readonly now: () => number;
	private readonly minIntervalMs: number;
	private readonly maxRetries: number;
	private readonly baseUrl: string;
	private nextRequestAt = 0;

	constructor(options: RealDebridClientOptions) {
		this.token = options.token;
		this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
		this.sleep = options.sleep ?? realSleep;
		this.now = options.now ?? Date.now;
		this.minIntervalMs = options.minIntervalMs ?? 250;
		this.maxRetries = options.maxRetries ?? 3;
		this.baseUrl = options.baseUrl ?? BASE_URL;
	}

	getUser(): Promise<User> {
		return this.request<User>('GET', '/user');
	}

	/**
	 * Fetch one page of the torrent list.
	 * @param page - 1-based page number
	 * @param limit - Entries per page (1 to 5000)
	 */
	listTorrents(page: number, limit: number): Promise<Page<Torrent>> {
		return this.requestPage<Torrent>('/torrents', page, limit);
	}

	/** Fetch every torrent of the account, walking all pages. */
	listAllTorrents(): Promise<Torrent[]> {
		return this.requestAllPages<Torrent>('/torrents');
	}

	getTorrentInfo(id: string): Promise<TorrentInfo> {
		return this.request<TorrentInfo>('GET', `/torrents/info/${encodeURIComponent(id)}`);
	}

	getActiveTorrentCount(): Promise<ActiveTorrentCount> {
		return this.request<ActiveTorrentCount>('GET', '/torrents/activeCount');
	}

	/**
	 * Upload a `.torrent` file. The torrent stays in `waiting_files_selection` until `selectFiles` is called.
	 * @param torrentFile - Raw bytes of the `.torrent` file
	 */
	addTorrent(torrentFile: ArrayBuffer): Promise<CreatedResource> {
		return this.request<CreatedResource>('PUT', '/torrents/addTorrent', {
			body: torrentFile,
			contentType: 'application/x-bittorrent',
		});
	}

	/** Add a magnet link. The torrent stays in `waiting_files_selection` until `selectFiles` is called. */
	addMagnet(magnet: string): Promise<CreatedResource> {
		return this.request<CreatedResource>('POST', '/torrents/addMagnet', { form: { magnet } });
	}

	/**
	 * Select the files of a torrent, which starts it.
	 * @param id - Torrent id
	 * @param fileIds - File ids to select, or `'all'`
	 */
	async selectFiles(id: string, fileIds: readonly number[] | 'all'): Promise<void> {
		const files = fileIds === 'all' ? 'all' : fileIds.join(',');
		await this.request<void>('POST', `/torrents/selectFiles/${encodeURIComponent(id)}`, { form: { files } });
	}

	async deleteTorrent(id: string): Promise<void> {
		await this.request<void>('DELETE', `/torrents/delete/${encodeURIComponent(id)}`);
	}

	/**
	 * Fetch one page of the downloads (unrestricted links) list.
	 * @param page - 1-based page number
	 * @param limit - Entries per page (1 to 5000)
	 */
	listDownloads(page: number, limit: number): Promise<Page<Download>> {
		return this.requestPage<Download>('/downloads', page, limit);
	}

	/** Fetch every download of the account, walking all pages. */
	listAllDownloads(): Promise<Download[]> {
		return this.requestAllPages<Download>('/downloads');
	}

	async deleteDownload(id: string): Promise<void> {
		await this.request<void>('DELETE', `/downloads/delete/${encodeURIComponent(id)}`);
	}

	/** Turn a hoster link (e.g. one of a torrent's `links`) into a direct download link. */
	unrestrictLink(link: string): Promise<UnrestrictedLink> {
		return this.request<UnrestrictedLink>('POST', '/unrestrict/link', { form: { link } });
	}

	/**
	 * Get transcoded streaming links of a file.
	 * @param downloadId - Id from `/downloads` or `/unrestrict/link`
	 */
	getTranscodeLinks(downloadId: string): Promise<TranscodeLinks> {
		return this.request<TranscodeLinks>('GET', `/streaming/transcode/${encodeURIComponent(downloadId)}`);
	}

	private async requestPage<T>(path: string, page: number, limit: number): Promise<Page<T>> {
		const response = await this.send('GET', path, { query: { page, limit } });
		const items = (await this.parseBody<T[]>(response)) ?? [];
		return { items, total: reportedTotal(response) ?? items.length };
	}

	private async requestAllPages<T>(path: string): Promise<T[]> {
		const all: T[] = [];
		for (let page = 1; ; page++) {
			const response = await this.send('GET', path, { query: { page, limit: FULL_LISTING_PAGE_SIZE } });
			const items = (await this.parseBody<T[]>(response)) ?? [];
			all.push(...items);
			// Without a usable total, only a short page proves the listing is over.
			const total = reportedTotal(response);
			if (items.length < FULL_LISTING_PAGE_SIZE || (total !== undefined && all.length >= total)) return all;
		}
	}

	private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
		return (await this.parseBody<T>(await this.send(method, path, options))) as T;
	}

	/** Empty responses (204, or the 200/201 some endpoints send without a body) resolve to `undefined`. */
	private async parseBody<T>(response: Response): Promise<T | undefined> {
		const text = response.status === 204 ? '' : await response.text();
		return text ? (JSON.parse(text) as T) : undefined;
	}

	private async send(method: string, path: string, options: RequestOptions): Promise<Response> {
		const url = new URL(this.baseUrl + path);
		for (const [name, value] of Object.entries(options.query ?? {})) {
			if (value !== undefined) url.searchParams.set(name, String(value));
		}

		const headers = new Headers({ Authorization: `Bearer ${this.token}` });
		if (options.contentType) headers.set('Content-Type', options.contentType);
		const body = options.form ? new URLSearchParams(options.form) : options.body;

		for (let attempt = 0; ; attempt++) {
			await this.throttle();
			const response = await this.fetch(url, { method, headers, body });
			if (response.ok) return response;

			const error = await this.toError(response);
			if (!error.isRateLimited || attempt >= this.maxRetries) throw error;
			await this.sleep(this.backoffDelay(response, attempt));
		}
	}

	/** Reserve the next request slot, sleeping until it when requests are issued faster than the allowed rate. */
	private async throttle(): Promise<void> {
		const now = this.now();
		const slot = Math.max(now, this.nextRequestAt);
		this.nextRequestAt = slot + this.minIntervalMs;
		if (slot > now) await this.sleep(slot - now);
	}

	private backoffDelay(response: Response, attempt: number): number {
		const retryAfterSeconds = Number(response.headers.get('Retry-After'));
		if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
		return 2000 * 2 ** attempt;
	}

	private async toError(response: Response): Promise<RealDebridError> {
		try {
			const payload = (await response.json()) as { error?: string; error_code?: number };
			return new RealDebridError(response.status, payload.error_code, payload.error);
		} catch {
			return new RealDebridError(response.status);
		}
	}
}

/** Grand total from `X-Total-Count`, or `undefined` when the header is missing or not a number. */
function reportedTotal(response: Response): number | undefined {
	const header = response.headers.get('X-Total-Count');
	const total = header === null ? Number.NaN : Number(header);
	return Number.isInteger(total) && total >= 0 ? total : undefined;
}

import type { Download, Torrent, TorrentFile, TorrentInfo, TorrentStatus } from '@/realdebrid/types.ts';

export interface RecordedRequest {
	method: string;
	path: string;
	query: URLSearchParams;
	headers: Headers;
	body: string;
}

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);
const apiError = (status: number, error: string, error_code: number) => json({ error, error_code }, { status });

/** In-memory stand-in for the Real-Debrid REST API, reproducing the documented status codes and shapes. */
export class FakeRealDebrid {
	readonly requests: RecordedRequest[] = [];
	readonly torrents = new Map<string, TorrentInfo>();
	readonly downloads: Download[] = [];
	/** Files every newly added torrent resolves to. */
	filesOfNextTorrents: TorrentFile[] = [];
	/** `GET /torrents/info` calls a new torrent answers with `magnet_conversion` (and no files) before resolving. */
	conversionPolls = 0;
	/** Status reported for newly added torrents once resolved. */
	statusOfNextTorrents: TorrentStatus = 'waiting_files_selection';
	/** Makes `GET /torrents/info` fail for torrents whose files were already selected. */
	infoFailsAfterSelection = false;
	/** When false, listings omit the `X-Total-Count` header. */
	reportsTotal = true;
	/** Torrent ids whose file selection is refused. */
	readonly refusesSelection = new Set<string>();
	/** Torrent ids whose deletion is refused. */
	readonly refusesDeletion = new Set<string>();
	private sequence = 0;
	private readonly pendingPolls = new Map<string, number>();

	readonly fetch: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const path = url.pathname.replace('/rest/1.0', '');
		const body = new TextDecoder().decode(await request.arrayBuffer());
		this.requests.push({ method: request.method, path, query: url.searchParams, headers: request.headers, body });
		return this.route(request.method, path, url.searchParams, new URLSearchParams(body));
	};

	/** Seed a torrent as if it had been added earlier. */
	seedTorrent(overrides: Partial<TorrentInfo> & { id: string; filename: string }): TorrentInfo {
		const torrent: TorrentInfo = {
			hash: 'abc',
			bytes: 1024,
			host: 'real-debrid.com',
			split: 2000,
			progress: 100,
			status: 'downloaded',
			added: '2026-01-01T00:00:00.000Z',
			links: [],
			original_filename: overrides.filename,
			original_bytes: 1024,
			files: [],
			...overrides,
		};
		this.torrents.set(torrent.id, torrent);
		return torrent;
	}

	seedDownload(overrides: Partial<Download> & { id: string; filename: string }): Download {
		const download: Download = {
			mimeType: 'application/octet-stream',
			filesize: 5 * 1024 * 1024,
			link: `https://real-debrid.com/d/${overrides.id}`,
			host: 'real-debrid.com',
			chunks: 16,
			download: `https://dl.example/${overrides.id}`,
			generated: '2026-01-01T00:00:00.000Z',
			...overrides,
		};
		this.downloads.push(download);
		return download;
	}

	requestsTo(method: string, pathPrefix: string): RecordedRequest[] {
		return this.requests.filter((request) => request.method === method && request.path.startsWith(pathPrefix));
	}

	private route(method: string, path: string, query: URLSearchParams, form: URLSearchParams): Response {
		const [, resource, action, id] = path.split('/');

		switch (`${method} /${resource}${action ? `/${action}` : ''}`) {
			case 'GET /user':
				return json({ id: 1, username: 'lucas', points: 42, locale: 'pt', type: 'premium', premium: 864000, expiration: '2027-01-01T00:00:00.000Z' });
			case 'GET /torrents':
				return this.paginate([...this.torrents.values()].map(toListEntry), query);
			case 'GET /downloads':
				return this.paginate(this.downloads, query);
			case 'GET /torrents/activeCount':
				return json({ nb: 1, limit: 25 });
			case 'PUT /torrents/addTorrent':
			case 'POST /torrents/addMagnet':
				return this.add();
			case 'GET /torrents/info':
				return this.info(id);
			case 'POST /torrents/selectFiles':
				return this.select(id, form.get('files') ?? '');
			case 'DELETE /torrents/delete':
				if (this.refusesDeletion.has(id)) return apiError(403, 'permission_denied', 9);
				return this.torrents.delete(id) ? new Response(null, { status: 204 }) : apiError(404, 'unknown_ressource', 7);
			case 'DELETE /downloads/delete': {
				const index = this.downloads.findIndex((download) => download.id === id);
				if (index < 0) return apiError(404, 'unknown_ressource', 7);
				this.downloads.splice(index, 1);
				return new Response(null, { status: 204 });
			}
			case 'POST /unrestrict/link': {
				const link = form.get('link') ?? '';
				return json({
					id: 'DL1',
					filename: 'file.mkv',
					filesize: 2048,
					link,
					host: 'rd',
					download: `https://dl.example/${encodeURIComponent(link)}`,
					streamable: 1,
				});
			}
			case 'GET /streaming/transcode':
				return json({ apple: { full: 'https://stream.example/full.m3u8' }, dash: {}, liveMP4: { full: 'https://stream.example/full.mp4' }, h264WebM: {} });
			default:
				return apiError(404, 'unknown_method', 3);
		}
	}

	private paginate<T>(items: T[], query: URLSearchParams): Response {
		const limit = Number(query.get('limit') ?? 100);
		const page = Number(query.get('page') ?? 1);
		const slice = items.slice((page - 1) * limit, page * limit);
		// The real API answers an empty listing with 204 and no body.
		if (slice.length === 0) return new Response(null, { status: 204 });
		return json(slice, this.reportsTotal ? { headers: { 'X-Total-Count': String(items.length) } } : {});
	}

	private add(): Response {
		const id = `T${++this.sequence}`;
		this.seedTorrent({ id, filename: `torrent-${id}`, status: this.statusOfNextTorrents, progress: 0, files: structuredClone(this.filesOfNextTorrents) });
		this.pendingPolls.set(id, this.conversionPolls);
		return json({ id, uri: `https://api.real-debrid.com/rest/1.0/torrents/info/${id}` }, { status: 201 });
	}

	private info(id: string): Response {
		const torrent = this.torrents.get(id);
		if (!torrent) return apiError(404, 'unknown_ressource', 7);
		if (this.infoFailsAfterSelection && torrent.status === 'downloading') return apiError(503, 'service_unavailable', 25);
		const pending = this.pendingPolls.get(id) ?? 0;
		if (pending > 0) {
			this.pendingPolls.set(id, pending - 1);
			return json({ ...torrent, status: 'magnet_conversion', files: [] });
		}
		return json(torrent);
	}

	private select(id: string, files: string): Response {
		const torrent = this.torrents.get(id);
		if (!torrent) return apiError(404, 'unknown_ressource', 7);
		if (this.refusesSelection.has(id)) return apiError(400, 'parameter_bad', 2);
		const selected = new Set(files === 'all' ? torrent.files.map((file) => String(file.id)) : files.split(','));
		for (const file of torrent.files) file.selected = selected.has(String(file.id)) ? 1 : 0;
		torrent.status = 'downloading';
		return new Response(null, { status: 204 });
	}
}

function toListEntry({ original_filename: _name, original_bytes: _bytes, files: _files, ...entry }: TorrentInfo): Torrent {
	return entry;
}

export function torrentFile(id: number, path: string): TorrentFile {
	return { id, path, bytes: 1024 * id, selected: 0 };
}

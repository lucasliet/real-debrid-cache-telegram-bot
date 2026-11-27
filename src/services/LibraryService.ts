import { type LibrarySearchAssistant, MAX_CANDIDATES } from '@/ai/LibrarySearchAssistant.ts';
import { SWITCH_ROM_EXTENSIONS } from '@/config/constants.ts';
import type { RealDebridClient } from '@/realdebrid/RealDebridClient.ts';
import type { Download, Torrent, UnrestrictedLink } from '@/realdebrid/types.ts';
import { fileExtension } from '@/util/files.ts';
import { UserFacingError } from '@/util/UserFacingError.ts';

export interface SearchResult {
	readonly torrents: Torrent[];
	readonly downloads: Download[];
	/** True when nothing matched literally and the entries were suggested by the AI assistant instead. */
	readonly suggested: boolean;
}

export interface BulkDeleteResult {
	/** True when the time budget ran out before every torrent was handled. */
	interrupted: boolean;
	readonly deleted: Torrent[];
	readonly failed: { readonly torrent: Torrent; readonly error: unknown }[];
}

/**
 * Lowercase the text, strip diacritics and treat `.`, `_` and `-` as spaces,
 * so "Zelda.Tears_of-the Kingdom" matches "zelda tears of the kingdom".
 */
export function normalizeForSearch(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[._-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Shortest normalized term accepted for a bulk deletion; anything shorter matches far more than intended. */
const MIN_BULK_DELETE_TERM_LENGTH = 3;

/** An empty normalized query (e.g. "." or "-") matches nothing: `includes('')` would otherwise match everything. */
function filterByName<T extends { filename: string }>(items: readonly T[], query: string): T[] {
	const normalizedQuery = normalizeForSearch(query);
	if (!normalizedQuery) return [];
	return items.filter((item) => normalizeForSearch(item.filename).includes(normalizedQuery));
}

/** Greetings, single words typed wrong and pasted links are not descriptions; asking the model about them only costs money. */
function isWorthAskingAssistant(query: string): boolean {
	return normalizeForSearch(query).length >= 4 && !/^\w+:\/\//.test(query.trim());
}

export interface LibraryServiceOptions {
	/** Optional AI fallback for searches without a literal match. */
	assistant?: LibrarySearchAssistant;
	now?: () => number;
	/**
	 * How long a bulk operation may run before it stops and reports what it did. A queue consumer is cut off
	 * after 15 minutes of wall time, and the update is not redelivered, so the summary must be sent before that.
	 */
	bulkTimeBudgetMs?: number;
}

/** Queries and bulk maintenance over the torrents and downloads already in the Real-Debrid account. */
export class LibraryService {
	private readonly assistant?: LibrarySearchAssistant;
	private readonly now: () => number;
	private readonly bulkTimeBudgetMs: number;

	constructor(
		private readonly realDebrid: RealDebridClient,
		options: LibraryServiceOptions = {},
	) {
		this.assistant = options.assistant;
		this.now = options.now ?? Date.now;
		this.bulkTimeBudgetMs = options.bulkTimeBudgetMs ?? 12 * 60 * 1000;
	}

	/**
	 * Find torrents and downloads whose name contains the query. When nothing matches and an assistant
	 * is available, fall back to its suggestions; the fallback never fails the search.
	 */
	async search(query: string): Promise<SearchResult> {
		const [torrents, downloads] = await Promise.all([this.realDebrid.listAllTorrents(), this.realDebrid.listAllDownloads()]);
		const literal = { torrents: filterByName(torrents, query), downloads: filterByName(downloads, query), suggested: false };
		if (literal.torrents.length > 0 || literal.downloads.length > 0 || !this.assistant || !isWorthAskingAssistant(query)) return literal;

		try {
			return await this.suggest(this.assistant, query, torrents, downloads);
		} catch (error) {
			console.error('[LIBRARY] AI search suggestion failed:', error);
			return literal;
		}
	}

	/** Ask the assistant to pick among the newest entries, torrents first. */
	private async suggest(assistant: LibrarySearchAssistant, query: string, torrents: Torrent[], downloads: Download[]): Promise<SearchResult> {
		const consideredTorrents = torrents.slice(0, MAX_CANDIDATES);
		const consideredDownloads = downloads.slice(0, MAX_CANDIDATES - consideredTorrents.length);
		const names = [...consideredTorrents, ...consideredDownloads].map((entry) => entry.filename);

		const positions = await assistant.suggest(query, names);
		return {
			torrents: positions.filter((position) => position < consideredTorrents.length).map((position) => consideredTorrents[position]),
			downloads: positions
				.filter((position) => position >= consideredTorrents.length)
				.map((position) => consideredDownloads[position - consideredTorrents.length]),
			suggested: positions.length > 0,
		};
	}

	/** Torrents whose name contains the query (literal match only). */
	async findTorrents(query: string): Promise<Torrent[]> {
		return filterByName(await this.realDebrid.listAllTorrents(), query);
	}

	/** Downloads whose name contains the query (literal match only). */
	async findDownloads(query: string): Promise<Download[]> {
		return filterByName(await this.realDebrid.listAllDownloads(), query);
	}

	/** List the torrents that have not finished downloading, whatever the reason. */
	async listIncompleteTorrents(): Promise<Torrent[]> {
		const torrents = await this.realDebrid.listAllTorrents();
		return torrents.filter((torrent) => torrent.status !== 'downloaded');
	}

	/**
	 * Turn every hoster link of a torrent into a direct download link.
	 * @throws UserFacingError when the torrent has no links yet
	 */
	async getDownloadLinks(torrentId: string): Promise<UnrestrictedLink[]> {
		const { links } = await this.realDebrid.getTorrentInfo(torrentId);
		if (!links?.length) {
			throw new UserFacingError('Nenhum link disponível para este torrent. Ele já terminou de baixar?');
		}
		return Promise.all(links.map((link) => this.realDebrid.unrestrictLink(link)));
	}

	/** Delete every torrent whose name contains the query. */
	async deleteTorrentsByName(query: string): Promise<BulkDeleteResult> {
		if (normalizeForSearch(query).length < MIN_BULK_DELETE_TERM_LENGTH) {
			throw new UserFacingError(`Termo muito genérico para uma exclusão em massa: use pelo menos ${MIN_BULK_DELETE_TERM_LENGTH} letras ou números.`);
		}
		const torrents = await this.realDebrid.listAllTorrents();
		return this.deleteAll(filterByName(torrents, query));
	}

	/** Delete every torrent that contains at least one Nintendo Switch ROM. */
	async deleteSwitchTorrents(): Promise<BulkDeleteResult> {
		const result: BulkDeleteResult = { interrupted: false, deleted: [], failed: [] };
		const deadline = this.now() + this.bulkTimeBudgetMs;
		for (const torrent of await this.realDebrid.listAllTorrents()) {
			if (this.now() >= deadline) {
				result.interrupted = true;
				break;
			}
			try {
				const { files } = await this.realDebrid.getTorrentInfo(torrent.id);
				if (!files?.some((file) => SWITCH_ROM_EXTENSIONS.has(fileExtension(file.path)))) continue;
				await this.realDebrid.deleteTorrent(torrent.id);
				result.deleted.push(torrent);
			} catch (error) {
				console.error(`[LIBRARY] Failed to process torrent ${torrent.id}:`, error);
				result.failed.push({ torrent, error });
			}
		}
		return result;
	}

	private async deleteAll(torrents: readonly Torrent[]): Promise<BulkDeleteResult> {
		const result: BulkDeleteResult = { interrupted: false, deleted: [], failed: [] };
		const deadline = this.now() + this.bulkTimeBudgetMs;
		for (const torrent of torrents) {
			if (this.now() >= deadline) {
				result.interrupted = true;
				break;
			}
			try {
				await this.realDebrid.deleteTorrent(torrent.id);
				result.deleted.push(torrent);
			} catch (error) {
				console.error(`[LIBRARY] Failed to delete torrent ${torrent.id}:`, error);
				result.failed.push({ torrent, error });
			}
		}
		return result;
	}
}

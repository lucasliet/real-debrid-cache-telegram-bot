import { SWITCH_ROM_EXTENSIONS } from '@/config/constants.ts';
import type { RealDebridClient } from '@/realdebrid/RealDebridClient.ts';
import { type CreatedResource, FAILED_TORRENT_STATUSES, type TorrentFile, type TorrentInfo } from '@/realdebrid/types.ts';
import { fileExtension } from '@/util/files.ts';
import { type Sleep, sleep as realSleep } from '@/util/sleep.ts';
import { UserFacingError } from '@/util/UserFacingError.ts';

/** Where a torrent comes from; kept so it can be added again, once per file. */
export type TorrentSource =
	| { readonly kind: 'magnet'; readonly magnet: string }
	| { readonly kind: 'file'; readonly bytes: ArrayBuffer };

export interface FileFailure {
	readonly file: TorrentFile;
	readonly error: unknown;
}

/** Progress of a per-file ingestion, reported as each file is handled. */
export type IngestionEvent =
	| { readonly type: 'file-started'; readonly position: number; readonly total: number; readonly file: TorrentFile }
	| { readonly type: 'file-added'; readonly position: number; readonly total: number; readonly file: TorrentFile }
	| { readonly type: 'file-failed'; readonly position: number; readonly total: number; readonly file: TorrentFile; readonly error: unknown };

export type IngestionResult =
	/** All files were selected in a single torrent. */
	| { readonly strategy: 'bundle'; readonly torrent: TorrentInfo }
	/** Each file became its own torrent. */
	| { readonly strategy: 'individual'; readonly added: readonly TorrentFile[]; readonly failed: readonly FileFailure[] };

export interface TorrentIngestionOptions {
	sleep?: Sleep;
	/** Delay between checks while Real-Debrid resolves the file list. */
	pollIntervalMs?: number;
	/** Checks made before giving up on the file list. */
	maxPollAttempts?: number;
}

/**
 * Adds torrents to Real-Debrid. A torrent made only of Nintendo Switch ROMs is added once per file,
 * each copy with a single file selected, because Real-Debrid packs multi-file selections into RAR
 * archives that a Tinfoil shop cannot serve. Any other torrent is added once with every file selected.
 */
export class TorrentIngestionService {
	private readonly sleep: Sleep;
	private readonly pollIntervalMs: number;
	private readonly maxPollAttempts: number;

	constructor(private readonly realDebrid: RealDebridClient, options: TorrentIngestionOptions = {}) {
		this.sleep = options.sleep ?? realSleep;
		this.pollIntervalMs = options.pollIntervalMs ?? 1000;
		this.maxPollAttempts = options.maxPollAttempts ?? 30;
	}

	/**
	 * Add the torrent and select its files according to its content.
	 * @param source - Magnet link or `.torrent` bytes
	 * @param onEvent - Receives progress of a per-file ingestion
	 * @returns What was added, and what failed, per strategy
	 * @throws UserFacingError when Real-Debrid cannot resolve the torrent's files
	 */
	async ingest(source: TorrentSource, onEvent: (event: IngestionEvent) => Promise<void> = async () => {}): Promise<IngestionResult> {
		const first = await this.add(source);
		const files = await this.resolveFilesOrDiscard(first.id);

		if (!files.every(isSwitchRom)) {
			await this.realDebrid.selectFiles(first.id, 'all');
			return { strategy: 'bundle', torrent: await this.realDebrid.getTorrentInfo(first.id) };
		}

		const added: TorrentFile[] = [];
		const failed: FileFailure[] = [];
		const total = files.length;

		for (const [index, file] of files.entries()) {
			const position = index + 1;
			await onEvent({ type: 'file-started', position, total, file });
			try {
				await this.addSingleFile(source, file, index === 0 ? first.id : undefined);
				added.push(file);
				await onEvent({ type: 'file-added', position, total, file });
			} catch (error) {
				console.error(`[INGESTION] Failed to add file ${position}/${total} (${file.path}):`, error);
				failed.push({ file, error });
				await onEvent({ type: 'file-failed', position, total, file, error });
			}
		}

		return { strategy: 'individual', added, failed };
	}

	/**
	 * Select a single file on its own copy of the torrent, discarding the copy when that fails
	 * so no torrent is left behind waiting for a file selection.
	 * @param existingTorrentId - Copy already added (and resolved) to reuse instead of adding a new one
	 */
	private async addSingleFile(source: TorrentSource, file: TorrentFile, existingTorrentId?: string): Promise<void> {
		const torrentId = existingTorrentId ?? (await this.add(source)).id;
		try {
			if (!existingTorrentId) await this.waitForFiles(torrentId);
			await this.realDebrid.selectFiles(torrentId, [file.id]);
		} catch (error) {
			await this.discard(torrentId);
			throw error;
		}
	}

	private add(source: TorrentSource): Promise<CreatedResource> {
		return source.kind === 'magnet' ? this.realDebrid.addMagnet(source.magnet) : this.realDebrid.addTorrent(source.bytes);
	}

	private async resolveFilesOrDiscard(torrentId: string): Promise<TorrentFile[]> {
		try {
			return await this.waitForFiles(torrentId);
		} catch (error) {
			await this.discard(torrentId);
			throw error;
		}
	}

	/**
	 * Poll the torrent until Real-Debrid knows its files (a magnet first goes through `magnet_conversion`).
	 * @throws UserFacingError when the torrent fails or the file list does not show up in time
	 */
	private async waitForFiles(torrentId: string): Promise<TorrentFile[]> {
		for (let attempt = 1; attempt <= this.maxPollAttempts; attempt++) {
			const info = await this.realDebrid.getTorrentInfo(torrentId);
			if (FAILED_TORRENT_STATUSES.has(info.status)) {
				throw new UserFacingError(`O Real-Debrid rejeitou o torrent (status: ${info.status}).`);
			}
			if (info.files?.length > 0) return info.files;
			if (attempt < this.maxPollAttempts) await this.sleep(this.pollIntervalMs);
		}
		throw new UserFacingError('O Real-Debrid não disponibilizou a lista de arquivos do torrent a tempo. Tente novamente em instantes.');
	}

	private async discard(torrentId: string): Promise<void> {
		try {
			await this.realDebrid.deleteTorrent(torrentId);
		} catch (error) {
			console.warn(`[INGESTION] Could not discard torrent ${torrentId}:`, error);
		}
	}
}

function isSwitchRom(file: TorrentFile): boolean {
	return SWITCH_ROM_EXTENSIONS.has(fileExtension(file.path));
}

import { SWITCH_ROM_EXTENSIONS } from '@/config/constants.ts';
import type { RealDebridClient } from '@/realdebrid/RealDebridClient.ts';
import { type CreatedResource, FAILED_TORRENT_STATUSES, type TorrentFile, type TorrentInfo } from '@/realdebrid/types.ts';
import { fileExtension } from '@/util/files.ts';
import { sleep as realSleep, type Sleep } from '@/util/sleep.ts';
import { UserFacingError } from '@/util/UserFacingError.ts';

/** Where a torrent comes from; kept so it can be added again, once per file. */
export type TorrentSource = { readonly kind: 'magnet'; readonly magnet: string } | { readonly kind: 'file'; readonly bytes: ArrayBuffer };

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
	| {
			readonly strategy: 'individual';
			readonly added: readonly TorrentFile[];
			readonly failed: readonly FileFailure[];
			/** Files not attempted because the time budget ran out. */
			readonly skipped: readonly TorrentFile[];
	  };

/** The torrent was accepted but Real-Debrid has not resolved its files yet (e.g. a magnet with few peers). */
export class PendingTorrentError extends UserFacingError {
	constructor(readonly torrentId: string) {
		super(
			`O Real-Debrid ainda não resolveu os arquivos do torrent ${torrentId}. Ele continua na sua conta: quando sair de "convertendo magnet", selecione os arquivos no site do Real-Debrid.`,
		);
		this.name = 'PendingTorrentError';
	}
}

export interface TorrentIngestionOptions {
	sleep?: Sleep;
	/** Delay between checks while Real-Debrid resolves the file list. */
	pollIntervalMs?: number;
	/** Checks made before giving up on the file list. */
	maxPollAttempts?: number;
	now?: () => number;
	/**
	 * How long a per-file ingestion may run before it stops and reports what it did. A queue consumer is cut off
	 * after 15 minutes of wall time, and the update is not redelivered, so the summary must be sent before that.
	 */
	timeBudgetMs?: number;
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
	private readonly now: () => number;
	private readonly timeBudgetMs: number;

	constructor(
		private readonly realDebrid: RealDebridClient,
		options: TorrentIngestionOptions = {},
	) {
		this.sleep = options.sleep ?? realSleep;
		this.pollIntervalMs = options.pollIntervalMs ?? 1000;
		this.maxPollAttempts = options.maxPollAttempts ?? 30;
		this.now = options.now ?? Date.now;
		this.timeBudgetMs = options.timeBudgetMs ?? 12 * 60 * 1000;
	}

	/**
	 * Add the torrent and select its files according to its content.
	 * @param source - Magnet link or `.torrent` bytes
	 * @param onEvent - Receives progress of a per-file ingestion
	 * @returns What was added, and what failed, per strategy
	 * @throws UserFacingError when Real-Debrid cannot resolve the torrent's files
	 */
	async ingest(source: TorrentSource, onEvent: (event: IngestionEvent) => Promise<void> = async () => {}): Promise<IngestionResult> {
		const deadline = this.now() + this.timeBudgetMs;
		const first = await this.add(source);
		const resolved = await this.discardUnlessPending(first.id, () => this.waitForFiles(first.id));
		const files = resolved.files;

		if (!files.every(isSwitchRom)) {
			await this.discardUnlessPending(first.id, () => this.realDebrid.selectFiles(first.id, 'all'));
			return { strategy: 'bundle', torrent: await this.refreshed(resolved) };
		}

		const added: TorrentFile[] = [];
		const failed: FileFailure[] = [];
		const total = files.length;

		for (const [index, file] of files.entries()) {
			if (this.now() >= deadline) return { strategy: 'individual', added, failed, skipped: files.slice(index) };

			const position = index + 1;
			await onEvent({ type: 'file-started', position, total, file });
			try {
				await this.addSingleFile(source, file, deadline, index === 0 ? first.id : undefined);
				added.push(file);
				await onEvent({ type: 'file-added', position, total, file });
			} catch (error) {
				console.error(`[INGESTION] Failed to add file ${position}/${total} (${file.path}):`, error);
				failed.push({ file, error });
				await onEvent({ type: 'file-failed', position, total, file, error });
			}
		}

		return { strategy: 'individual', added, failed, skipped: [] };
	}

	/**
	 * Select a single file on its own copy of the torrent, discarding the copy when that fails
	 * so no torrent is left behind waiting for a file selection.
	 * @param deadline - When the whole ingestion must stop waiting
	 * @param existingTorrentId - Copy already added (and resolved) to reuse instead of adding a new one
	 */
	private async addSingleFile(source: TorrentSource, file: TorrentFile, deadline: number, existingTorrentId?: string): Promise<void> {
		const torrentId = existingTorrentId ?? (await this.add(source)).id;
		try {
			if (!existingTorrentId) await this.waitForFiles(torrentId, deadline);
			await this.realDebrid.selectFiles(torrentId, [file.id]);
		} catch (error) {
			// Unlike the first copy, an extra copy is always disposable: the file is simply reported as failed.
			await this.discard(torrentId);
			if (error instanceof PendingTorrentError && !existingTorrentId) {
				throw new UserFacingError('o Real-Debrid não resolveu os arquivos desta cópia a tempo; reenvie o torrent para tentar este arquivo de novo');
			}
			throw error;
		}
	}

	/**
	 * Read the torrent again after its files were selected. The selection already went through,
	 * so a failure here must not be reported as a failed ingestion: fall back to what is known.
	 */
	private async refreshed(known: TorrentInfo): Promise<TorrentInfo> {
		try {
			return await this.realDebrid.getTorrentInfo(known.id);
		} catch (error) {
			console.warn(`[INGESTION] Could not refresh torrent ${known.id} after selecting its files:`, error);
			return known;
		}
	}

	private add(source: TorrentSource): Promise<CreatedResource> {
		return source.kind === 'magnet' ? this.realDebrid.addMagnet(source.magnet) : this.realDebrid.addTorrent(source.bytes);
	}

	/**
	 * Run a step on the first copy of the torrent and discard that copy when the step fails, so nothing is left
	 * behind waiting for a file selection. A torrent that is merely still converting is kept: deleting it would
	 * throw the conversion away and make a slow magnet impossible to add.
	 */
	private async discardUnlessPending<T>(torrentId: string, step: () => Promise<T>): Promise<T> {
		try {
			return await step();
		} catch (error) {
			if (!(error instanceof PendingTorrentError)) await this.discard(torrentId);
			throw error;
		}
	}

	/**
	 * Poll the torrent until Real-Debrid knows its files (a magnet first goes through `magnet_conversion`).
	 * @param deadline - Stop waiting at this time even if polls remain
	 * @throws PendingTorrentError when the file list does not show up in time
	 * @throws UserFacingError when Real-Debrid rejects the torrent
	 */
	private async waitForFiles(torrentId: string, deadline = Number.POSITIVE_INFINITY): Promise<TorrentInfo> {
		for (let attempt = 1; attempt <= this.maxPollAttempts && this.now() < deadline; attempt++) {
			const info = await this.realDebrid.getTorrentInfo(torrentId);
			if (FAILED_TORRENT_STATUSES.has(info.status)) {
				throw new UserFacingError(`O Real-Debrid rejeitou o torrent (status: ${info.status}).`);
			}
			if (info.files?.length > 0) return info;
			if (attempt < this.maxPollAttempts) await this.sleep(this.pollIntervalMs);
		}
		throw new PendingTorrentError(torrentId);
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

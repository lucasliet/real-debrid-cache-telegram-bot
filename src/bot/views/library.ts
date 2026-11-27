import { actionRow, bold, code, commandLink, escapeHtml, failureLines, formatBytes, link, truncate } from '@/bot/views/html.ts';
import type { ActiveTorrentCount, Download, Torrent, TorrentStatus, TranscodeLinks, UnrestrictedLink, User } from '@/realdebrid/types.ts';
import type { BulkDeleteResult } from '@/services/LibraryService.ts';

const STATUS_LABELS: Readonly<Record<TorrentStatus, string>> = {
	magnet_error: '❌ erro no magnet',
	magnet_conversion: '🧲 convertendo magnet',
	waiting_files_selection: '⏸️ aguardando seleção de arquivos',
	queued: '🕒 na fila',
	downloading: '⬇️ baixando',
	downloaded: '✅ baixado',
	error: '❌ erro',
	virus: '☣️ vírus detectado',
	compressing: '🗜️ compactando',
	uploading: '⬆️ enviando',
	dead: '💀 sem seeds',
};

const STREAM_FORMATS: readonly { key: keyof TranscodeLinks; label: string }[] = [
	{ key: 'apple', label: '📱 HLS (Apple)' },
	{ key: 'dash', label: '🎮 DASH' },
	{ key: 'liveMP4', label: '📹 MP4' },
	{ key: 'h264WebM', label: '🎬 WebM' },
];

/** Longest name shown on a card of a compact page. */
const COMPACT_NAME_LENGTH = 60;

export interface CardOptions {
	/** Shorten the name, for pages whose full names would not fit one message. */
	compact?: boolean;
}

function cardName(name: string, options: CardOptions): string {
	return escapeHtml(options.compact ? truncate(name, COMPACT_NAME_LENGTH) : name);
}

export function torrentCard(torrent: Torrent, options: CardOptions = {}): string {
	const progress = [`${bold('📊 Status:')} ${STATUS_LABELS[torrent.status] ?? escapeHtml(torrent.status)}`, `${bold('📈 Progresso:')} ${torrent.progress}%`];
	if (torrent.speed) progress.push(`${bold('⚡ Velocidade:')} ${formatBytes(torrent.speed)}/s`);
	if (torrent.seeders !== undefined) progress.push(`${bold('🌱 Seeders:')} ${torrent.seeders}`);

	const actions = [commandLink('🗑️ Deletar', `/delete_torrent ${torrent.id}`)];
	if (torrent.status === 'downloaded') actions.push(commandLink('⬇️ Baixar', `/download ${torrent.id}`));

	return [
		`${bold('🆔 ID:')} ${code(torrent.id)}`,
		`${bold('📂 Nome:')} ${cardName(torrent.filename, options)}`,
		`${bold('💾 Tamanho:')} ${formatBytes(torrent.bytes)}`,
		...progress,
		actionRow(...actions),
	].join('\n');
}

export function downloadCard(download: Download, options: CardOptions = {}): string {
	const actions = [commandLink('🗑️ Deletar', `/delete_download ${download.id}`), link('   ⬇️ Baixar   ', download.download)];
	if (download.streamable === 1) actions.push(commandLink('🎥 Stream', `/stream ${download.id}`));

	return [
		`${bold('🆔 ID:')} ${code(download.id)}`,
		`${bold('📂 Nome:')} ${cardName(download.filename, options)}`,
		`${bold('💾 Tamanho:')} ${formatBytes(download.filesize)}`,
		actionRow(...actions),
	].join('\n');
}

export function unrestrictedLinkCard(file: UnrestrictedLink, position?: number): string {
	const prefix = position === undefined ? '' : `${position}. `;
	const lines = [`${prefix}${bold(file.filename)} (${formatBytes(file.filesize)})`, escapeHtml(file.download)];
	if (file.streamable === 1) lines.push(actionRow(commandLink('🎥 Stream', `/stream ${file.id}`)));
	return lines.join('\n');
}

/** One block per available streaming format; empty when the file has no transcoded streams. */
export function streamBlocks(links: TranscodeLinks): string[] {
	return STREAM_FORMATS.flatMap(({ key, label }) => {
		const qualities = Object.entries(links[key] ?? {});
		if (qualities.length === 0) return [];
		return [[bold(label), ...qualities.map(([quality, url]) => `${escapeHtml(quality)}: ${escapeHtml(url)}`)].join('\n')];
	});
}

export function accountSummary(user: User, activeTorrents: ActiveTorrentCount): string {
	const daysLeft = Math.floor(user.premium / 86_400);
	const expiration = new Date(user.expiration);
	const expirationText = Number.isNaN(expiration.getTime()) ? user.expiration : expiration.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
	const plan = user.type === 'premium' ? `⭐ Premium — ${daysLeft} dia(s) restante(s), expira em ${escapeHtml(expirationText)}` : '🆓 Gratuito';

	return [
		bold('👤 Conta Real-Debrid'),
		'',
		`${bold('Usuário:')} ${escapeHtml(user.username)}`,
		`${bold('Plano:')} ${plan}`,
		`${bold('Pontos de fidelidade:')} ${user.points}`,
		`${bold('Torrents ativos:')} ${activeTorrents.nb}/${activeTorrents.limit}`,
	].join('\n');
}

/**
 * @param result - Outcome of a bulk deletion
 * @param subject - What was deleted, completing "N torrent(s) ..."
 * @param describeError - Turns a failure into a user-facing reason
 */
export function bulkDeleteSummary(result: BulkDeleteResult, subject: string, describeError: (error: unknown) => string): string {
	const lines = [`✅ ${result.deleted.length} torrent(s) ${escapeHtml(subject)} deletado(s).`];
	if (result.interrupted) lines.push('⏱️ Interrompido para não exceder o tempo de execução: rode o comando de novo para continuar.');
	if (result.failed.length > 0) {
		lines.push('', '⚠️ Falhas:');
		lines.push(
			...failureLines(
				result.failed.map(({ torrent, error }) => `${escapeHtml(truncate(torrent.filename))} (${code(torrent.id)}): ${escapeHtml(describeError(error))}`),
			),
		);
	}
	return lines.join('\n');
}

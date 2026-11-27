import { actionRow, bold, code, commandLink, escapeHtml, formatBytes, link } from '@/bot/views/html.ts';
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

export function torrentCard(torrent: Torrent): string {
	const progress = [`${bold('📊 Status:')} ${STATUS_LABELS[torrent.status] ?? escapeHtml(torrent.status)}`, `${bold('📈 Progresso:')} ${torrent.progress}%`];
	if (torrent.speed) progress.push(`${bold('⚡ Velocidade:')} ${formatBytes(torrent.speed)}/s`);
	if (torrent.seeders !== undefined) progress.push(`${bold('🌱 Seeders:')} ${torrent.seeders}`);

	const actions = [commandLink('🗑️ Deletar', `/delete_torrent ${torrent.id}`)];
	if (torrent.status === 'downloaded') actions.push(commandLink('⬇️ Baixar', `/download ${torrent.id}`));

	return [
		`${bold('🆔 ID:')} ${code(torrent.id)}`,
		`${bold('📂 Nome:')} ${escapeHtml(torrent.filename)}`,
		`${bold('💾 Tamanho:')} ${formatBytes(torrent.bytes)}`,
		...progress,
		actionRow(...actions),
	].join('\n');
}

export function downloadCard(download: Download): string {
	const actions = [commandLink('🗑️ Deletar', `/delete_download ${download.id}`), link('   ⬇️ Baixar   ', download.download)];
	if (download.streamable === 1) actions.push(commandLink('🎥 Stream', `/stream ${download.id}`));

	return [
		`${bold('🆔 ID:')} ${code(download.id)}`,
		`${bold('📂 Nome:')} ${escapeHtml(download.filename)}`,
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
	if (result.failed.length > 0) {
		lines.push('', '⚠️ Falhas:');
		lines.push(...result.failed.map(({ torrent, error }) => `• ${escapeHtml(torrent.filename)} (${code(torrent.id)}): ${escapeHtml(describeError(error))}`));
	}
	return lines.join('\n');
}

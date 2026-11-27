import { bold, code, escapeHtml, failureLines, truncate } from '@/bot/views/html.ts';
import type { TorrentInfo } from '@/realdebrid/types.ts';
import type { IngestionEvent, IngestionResult } from '@/services/TorrentIngestionService.ts';
import { fileName } from '@/util/files.ts';

type IndividualResult = Extract<IngestionResult, { strategy: 'individual' }>;

/** How many of the latest per-file outcomes stay visible in the progress message. */
const RECENT_OUTCOMES_SHOWN = 3;

/** Keeps the state of the single progress message that is edited as each file of a torrent is handled. */
export class IngestionProgressView {
	private readonly recentOutcomes: string[] = [];

	/**
	 * Record the event and render the progress message that reflects it.
	 * @returns HTML text for the progress message
	 */
	render(event: IngestionEvent): string {
		const name = escapeHtml(fileName(event.file.path));
		const lines = [`⏳ Adicionando ${event.total} arquivo(s) individualmente…`, '', `${bold('Progresso:')} ${event.position}/${event.total}`];

		if (event.type === 'file-added') this.remember(`✅ ${name}`);
		if (event.type === 'file-failed') this.remember(`⚠️ Falha: ${name}`);

		lines.push(...this.recentOutcomes);
		if (event.type === 'file-started') lines.push(`➡️ ${name}`);
		return lines.join('\n');
	}

	private remember(outcome: string): void {
		this.recentOutcomes.push(outcome);
		if (this.recentOutcomes.length > RECENT_OUTCOMES_SHOWN) this.recentOutcomes.shift();
	}
}

export function individualSummary(result: IndividualResult, describeError: (error: unknown) => string): string {
	const total = result.added.length + result.failed.length + result.skipped.length;
	if (result.added.length === total) {
		return `✅ Todos os ${total} arquivo(s) foram adicionados, cada um em seu próprio torrent.\n\nUse /incomplete para acompanhar o progresso.`;
	}

	const lines = [`⚠️ ${result.added.length} de ${total} arquivo(s) adicionados.`];
	if (result.skipped.length > 0) {
		const names = result.skipped.map((file) => escapeHtml(truncate(fileName(file.path))));
		lines.push('', bold(`⏱️ ${result.skipped.length} arquivo(s) não processados para não exceder o tempo de execução:`), ...failureLines(names));
	}
	if (result.failed.length > 0) {
		const failures = result.failed.map(({ file, error }) => `${escapeHtml(truncate(fileName(file.path)))}: ${escapeHtml(describeError(error))}`);
		lines.push('', bold('Falhas:'), ...failureLines(failures));
	}
	return lines.join('\n');
}

export function bundleSummary(torrent: TorrentInfo): string {
	return [
		'📥 Torrent adicionado com todos os arquivos selecionados!',
		'',
		`${bold('🆔 ID:')} ${code(torrent.id)}`,
		`${bold('📂 Nome:')} ${escapeHtml(torrent.filename)}`,
		`${bold('📦 Arquivos:')} ${torrent.files.length}`,
		`${bold('📊 Status:')} ${escapeHtml(torrent.status)}`,
		`${bold('📈 Progresso:')} ${torrent.progress}%`,
		'',
		`Use /incomplete para acompanhar e ${code(`/download ${torrent.id}`)} para obter os links quando terminar.`,
	].join('\n');
}

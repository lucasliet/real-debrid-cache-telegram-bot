import { Composer, type Context } from 'grammy';
import type { BotDependencies } from '@/bot/createBot.ts';
import { replySearch } from '@/bot/handlers/library.ts';
import { describeError, editHtml, replyHtml } from '@/bot/messaging.ts';
import { bundleSummary, IngestionProgressView, individualSummary } from '@/bot/views/ingestion.ts';
import type { IngestionEvent, IngestionResult, TorrentSource } from '@/services/TorrentIngestionService.ts';
import { downloadTelegramFile } from '@/telegram/files.ts';

/** Minimum spacing between edits of the progress message. */
const MIN_PROGRESS_INTERVAL_MS = 2000;

const MAGNET_PATTERN = /magnet:\?[^\s]+/i;

/** Everything the user can send that is not a known command: `.torrent` files, magnet links and search text. */
export function ingestionHandlers(dependencies: BotDependencies): Composer<Context> {
	const { config, ingestion, fetch } = dependencies;
	const composer = new Composer<Context>();

	/** Add the torrent, editing one status message with the progress and replying with the outcome. */
	async function ingest(ctx: Context, source: TorrentSource): Promise<void> {
		const status = await ctx.reply('🔎 Analisando o torrent…');
		const updateStatus = (html: string) => editHtml(ctx, status.chat.id, status.message_id, html);
		const progress = new IngestionProgressView();
		let lastEditAt = 0;

		/** One edit per finished file at most, spaced out so a large pack does not trip Telegram's flood control. */
		const reportProgress = async (event: IngestionEvent) => {
			const html = progress.render(event);
			if (event.type === 'file-started' || Date.now() - lastEditAt < MIN_PROGRESS_INTERVAL_MS) return;
			lastEditAt = Date.now();
			await updateStatus(html);
		};

		let result: IngestionResult;
		try {
			result = await ingestion.ingest(source, reportProgress);
		} catch (error) {
			// The error boundary replies with the reason; the status message just stops claiming work is in progress.
			await updateStatus('❌ Não foi possível concluir a adição do torrent.');
			throw error;
		}

		// Reporting happens outside the try: a failure to deliver the summary is not a failed ingestion.
		await updateStatus('✅ Processamento concluído.');
		await replyHtml(ctx, result.strategy === 'bundle' ? bundleSummary(result.torrent) : individualSummary(result, describeError));
	}

	composer.on('message:document', async (ctx) => {
		const document = ctx.message.document;
		if (!document.file_name?.toLowerCase().endsWith('.torrent')) {
			return void (await ctx.reply('❌ Envie apenas arquivos .torrent ou links magnet. Use /ajuda para mais informações.'));
		}
		const bytes = await downloadTelegramFile(ctx.api, config.botToken, document, fetch);
		await ingest(ctx, { kind: 'file', bytes });
	});

	composer.on('message:text', async (ctx) => {
		const text = ctx.message.text.trim();
		const magnet = text.match(MAGNET_PATTERN)?.[0];
		if (magnet) return await ingest(ctx, { kind: 'magnet', magnet });
		if (text.startsWith('/')) return void (await ctx.reply('❌ Comando desconhecido. Use /ajuda para ver os comandos disponíveis.'));
		await replySearch(ctx, text, dependencies);
	});

	return composer;
}

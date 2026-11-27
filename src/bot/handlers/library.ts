import { Composer, type Context } from 'grammy';
import type { BotDependencies } from '@/bot/createBot.ts';
import { describeError, replyBlocks, replyHtml } from '@/bot/messaging.ts';
import { requireArgument } from '@/bot/middleware.ts';
import { bold, escapeHtml } from '@/bot/views/html.ts';
import { accountSummary, bulkDeleteSummary, downloadCard, streamBlocks, torrentCard, unrestrictedLinkCard } from '@/bot/views/library.ts';
import { LISTING_PAGE_SIZE } from '@/config/constants.ts';

/**
 * Header for a listing, telling the user when it was truncated.
 * @param title - Listing title
 * @param shown - Entries included in the reply
 * @param total - Entries that exist
 */
function listingHeader(title: string, shown: number, total: number): string {
	const header = bold(`${title} (${total})`);
	return shown < total ? `${header}\nMostrando ${shown} de ${total}. Envie parte do nome para buscar um item específico.` : header;
}

/** Commands that read and maintain what is already in the Real-Debrid account. */
export function libraryHandlers({ realDebrid, library, sleep }: BotDependencies): Composer<Context> {
	const composer = new Composer<Context>();

	composer.command('conta', async (ctx) => {
		const [user, activeTorrents] = await Promise.all([realDebrid.getUser(), realDebrid.getActiveTorrentCount()]);
		await replyHtml(ctx, accountSummary(user, activeTorrents));
	});

	composer.command('status_torrent', async (ctx) => {
		const { items, total } = await realDebrid.listTorrents(1, LISTING_PAGE_SIZE);
		if (items.length === 0) return void (await ctx.reply('❌ Nenhum torrent encontrado.'));
		await replyBlocks(ctx, [listingHeader('📥 Torrents', items.length, total), ...items.map(torrentCard)], sleep);
	});

	composer.command('status_download', async (ctx) => {
		const { items, total } = await realDebrid.listDownloads(1, LISTING_PAGE_SIZE);
		if (items.length === 0) return void (await ctx.reply('❌ Nenhum download encontrado.'));
		await replyBlocks(ctx, [listingHeader('📦 Downloads', items.length, total), ...items.map(downloadCard)], sleep);
	});

	composer.command('incomplete', async (ctx) => {
		const torrents = await library.listIncompleteTorrents();
		if (torrents.length === 0) return void (await ctx.reply('✅ Nenhum torrent incompleto.'));
		const shown = torrents.slice(0, LISTING_PAGE_SIZE);
		await replyBlocks(ctx, [listingHeader('⏳ Torrents incompletos', shown.length, torrents.length), ...shown.map(torrentCard)], sleep);
	});

	composer.command('download', async (ctx) => {
		const links = await library.getDownloadLinks(requireArgument(ctx, '/download 12345'));
		await replyBlocks(ctx, [bold('📥 Links de download'), ...links.map((file, index) => unrestrictedLinkCard(file, index + 1))], sleep);
	});

	composer.command('unrestrict', async (ctx) => {
		const file = await realDebrid.unrestrictLink(requireArgument(ctx, '/unrestrict https://hoster.com/arquivo'));
		await replyBlocks(ctx, [bold('🔓 Link liberado'), unrestrictedLinkCard(file)], sleep);
	});

	composer.command('stream', async (ctx) => {
		const blocks = streamBlocks(await realDebrid.getTranscodeLinks(requireArgument(ctx, '/stream 12345')));
		if (blocks.length === 0) return void (await ctx.reply('❌ Nenhum link de streaming disponível para este arquivo.'));
		await replyBlocks(ctx, [bold('🎥 Links de streaming'), ...blocks], sleep);
	});

	composer.command('delete_torrent', async (ctx) => {
		const id = requireArgument(ctx, '/delete_torrent 12345');
		await realDebrid.deleteTorrent(id);
		await ctx.reply(`✅ Torrent ${id} deletado.`);
	});

	composer.command('delete_download', async (ctx) => {
		const id = requireArgument(ctx, '/delete_download 12345');
		await realDebrid.deleteDownload(id);
		await ctx.reply(`✅ Download ${id} deletado.`);
	});

	composer.command('clean_by', async (ctx) => {
		const query = requireArgument(ctx, '/clean_by zelda');
		const result = await library.deleteTorrentsByName(query);
		await replyBlocks(ctx, [bulkDeleteSummary(result, `com "${query}" no nome`, describeError)], sleep);
	});

	composer.command('clean_nsw', async (ctx) => {
		await ctx.reply('🧹 Verificando os arquivos de cada torrent, isso pode levar alguns minutos…');
		const result = await library.deleteSwitchTorrents();
		await replyBlocks(ctx, [bulkDeleteSummary(result, 'de jogos de Nintendo Switch', describeError)], sleep);
	});

	return composer;
}

/**
 * Search torrents and downloads by name and reply with the matches.
 * @param ctx - Context of the message carrying the query
 * @param query - Text typed by the user
 */
export async function replySearch(ctx: Context, query: string, { library, sleep }: BotDependencies): Promise<void> {
	const { torrents, downloads, suggested } = await library.search(query);
	if (torrents.length === 0 && downloads.length === 0) {
		return void (await replyHtml(ctx, `❌ Nenhum resultado para "${escapeHtml(query)}".`));
	}
	if (suggested) await replyHtml(ctx, `🤖 Nenhum nome contém "${escapeHtml(query)}". Estas são sugestões da IA:`);

	if (torrents.length > 0) {
		const shown = torrents.slice(0, LISTING_PAGE_SIZE);
		await replyBlocks(ctx, [listingHeader('📥 Torrents encontrados', shown.length, torrents.length), ...shown.map(torrentCard)], sleep);
	}
	if (downloads.length > 0) {
		const shown = downloads.slice(0, LISTING_PAGE_SIZE);
		await replyBlocks(ctx, [listingHeader('📦 Downloads encontrados', shown.length, downloads.length), ...shown.map(downloadCard)], sleep);
	}
}

import { Composer, type Context } from 'grammy';
import type { BotDependencies } from '@/bot/createBot.ts';
import { listingNavigation, replyEntries, replyListing } from '@/bot/handlers/listings.ts';
import { describeError, replyBlocks, replyHtml } from '@/bot/messaging.ts';
import { requireArgument } from '@/bot/middleware.ts';
import { bold, escapeHtml, truncate } from '@/bot/views/html.ts';
import { accountSummary, bulkDeleteSummary, streamBlocks, unrestrictedLinkCard } from '@/bot/views/library.ts';

/** A pasted text can be as long as a whole message; echoing it in full would not fit the reply. */
const MAX_ECHOED_QUERY_LENGTH = 100;

/** Commands that read and maintain what is already in the Real-Debrid account. */
export function libraryHandlers(dependencies: BotDependencies): Composer<Context> {
	const { realDebrid, library, sleep } = dependencies;
	const composer = new Composer<Context>();
	composer.use(listingNavigation(dependencies));

	composer.command('conta', async (ctx) => {
		const [user, activeTorrents] = await Promise.all([realDebrid.getUser(), realDebrid.getActiveTorrentCount()]);
		await replyHtml(ctx, accountSummary(user, activeTorrents));
	});

	composer.command('status_torrent', (ctx) => replyListing(ctx, dependencies, 't'));
	composer.command('status_download', (ctx) => replyListing(ctx, dependencies, 'd'));
	composer.command('incomplete', (ctx) => replyListing(ctx, dependencies, 'i'));

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
		await replyBlocks(ctx, [bulkDeleteSummary(result, `com "${truncate(query, MAX_ECHOED_QUERY_LENGTH)}" no nome`, describeError)], sleep);
	});

	composer.command('clean_nsw', async (ctx) => {
		await ctx.reply('🧹 Verificando os arquivos de cada torrent, isso pode levar alguns minutos…');
		const result = await library.deleteSwitchTorrents();
		await replyBlocks(ctx, [bulkDeleteSummary(result, 'de jogos de Nintendo Switch', describeError)], sleep);
	});

	return composer;
}

/**
 * Search torrents and downloads by name and reply with the matches: literal matches as listings the user
 * can page through, AI suggestions (a handful at most) as plain cards.
 * @param ctx - Context of the message carrying the query
 * @param query - Text typed by the user
 */
export async function replySearch(ctx: Context, query: string, dependencies: BotDependencies): Promise<void> {
	const { torrents, downloads, suggested } = await dependencies.library.search(query);
	if (torrents.length === 0 && downloads.length === 0) {
		return void (await replyHtml(ctx, `❌ Nenhum resultado para "${escapeHtml(truncate(query, MAX_ECHOED_QUERY_LENGTH))}".`));
	}

	if (suggested) {
		await replyHtml(ctx, `🤖 Nenhum nome contém "${escapeHtml(truncate(query, MAX_ECHOED_QUERY_LENGTH))}". Estas são sugestões da IA:`);
		if (torrents.length > 0) await replyEntries(ctx, '📥 Torrents sugeridos', 'torrent', torrents);
		if (downloads.length > 0) await replyEntries(ctx, '📦 Downloads sugeridos', 'download', downloads);
		return;
	}

	if (torrents.length > 0) await replyListing(ctx, dependencies, 'st', query);
	if (downloads.length > 0) await replyListing(ctx, dependencies, 'sd', query);
}

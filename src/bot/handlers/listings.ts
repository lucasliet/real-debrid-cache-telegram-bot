import { Composer, type Context, InlineKeyboard } from 'grammy';
import type { BotDependencies } from '@/bot/createBot.ts';
import { bold } from '@/bot/views/html.ts';
import { downloadCard, torrentCard } from '@/bot/views/library.ts';
import { LISTING_PAGE_SIZE, TELEGRAM_MESSAGE_LIMIT } from '@/config/constants.ts';
import type { Page } from '@/realdebrid/types.ts';

/**
 * Listings the user can page through. Each one is a single message whose buttons edit it to another page,
 * so nothing is ever cut off and the chat is not flooded.
 */
const LISTINGS = {
	t: { title: '📥 Torrents', empty: '❌ Nenhum torrent encontrado.' },
	d: { title: '📦 Downloads', empty: '❌ Nenhum download encontrado.' },
	i: { title: '⏳ Torrents incompletos', empty: '✅ Nenhum torrent incompleto.' },
	st: { title: '📥 Torrents encontrados', empty: '❌ Nenhum torrent encontrado para esta busca.' },
	sd: { title: '📦 Downloads encontrados', empty: '❌ Nenhum download encontrado para esta busca.' },
} as const;

export type ListingKind = keyof typeof LISTINGS;

/** Renders an entry; `compact` shortens its name so a page of long names still fits one message. */
type CardRenderer = (compact: boolean) => string;

const HTML_OPTIONS = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } as const;

/** Telegram limits callback data to 64 bytes. */
const MAX_CALLBACK_DATA_BYTES = 64;
const CALLBACK_PATTERN = /^p:(t|d|i|st|sd):(\d+)(?::([\s\S]*))?$/;
const NOOP_CALLBACK = 'p:noop';

function callbackData(kind: ListingKind, page: number, query: string): string {
	return query ? `p:${kind}:${page}:${query}` : `p:${kind}:${page}`;
}

function slicePage<T>(items: readonly T[], page: number): Page<T> {
	return { items: items.slice((page - 1) * LISTING_PAGE_SIZE, page * LISTING_PAGE_SIZE), total: items.length };
}

/**
 * Load one page of a listing. Plain listings are paged by the API itself; filtered ones
 * (incomplete, search) are computed over the whole library and sliced.
 */
async function loadPage({ realDebrid, library }: BotDependencies, kind: ListingKind, page: number, query: string): Promise<Page<CardRenderer>> {
	const torrents = (source: Page<Parameters<typeof torrentCard>[0]>) => ({
		total: source.total,
		items: source.items.map((item) => (compact: boolean) => torrentCard(item, { compact })),
	});
	const downloads = (source: Page<Parameters<typeof downloadCard>[0]>) => ({
		total: source.total,
		items: source.items.map((item) => (compact: boolean) => downloadCard(item, { compact })),
	});

	switch (kind) {
		case 't':
			return torrents(await realDebrid.listTorrents(page, LISTING_PAGE_SIZE));
		case 'd':
			return downloads(await realDebrid.listDownloads(page, LISTING_PAGE_SIZE));
		case 'i':
			return torrents(slicePage(await library.listIncompleteTorrents(), page));
		case 'st':
			return torrents(slicePage(await library.findTorrents(query), page));
		case 'sd':
			return downloads(slicePage(await library.findDownloads(query), page));
	}
}

/** Navigation row: first, previous, position, next, last. Omitted when everything fits one page. */
function navigation(kind: ListingKind, page: number, totalPages: number, query: string): InlineKeyboard | undefined {
	if (totalPages <= 1) return undefined;
	// A search whose query does not fit the callback data cannot be paged: the query is all the state there is.
	if (new TextEncoder().encode(callbackData(kind, totalPages, query)).length > MAX_CALLBACK_DATA_BYTES) return undefined;

	const keyboard = new InlineKeyboard();
	if (page > 1) keyboard.text('⏮', callbackData(kind, 1, query)).text('◀️', callbackData(kind, page - 1, query));
	keyboard.text(`${page}/${totalPages}`, NOOP_CALLBACK);
	if (page < totalPages) keyboard.text('▶️', callbackData(kind, page + 1, query)).text('⏭', callbackData(kind, totalPages, query));
	return keyboard;
}

interface RenderedListing {
	text: string;
	keyboard?: InlineKeyboard;
}

/**
 * Build the message for one page, clamping the page to what exists (the library may have shrunk since the buttons were drawn).
 * @returns The message, or `undefined` when the listing is empty
 */
async function renderListing(dependencies: BotDependencies, kind: ListingKind, requestedPage: number, query: string): Promise<RenderedListing | undefined> {
	let page = Math.max(1, requestedPage);
	let { items, total } = await loadPage(dependencies, kind, page, query);
	const totalPages = Math.max(1, Math.ceil(total / LISTING_PAGE_SIZE));
	if (items.length === 0 && total > 0) {
		page = totalPages;
		({ items, total } = await loadPage(dependencies, kind, page, query));
	}
	if (items.length === 0) return undefined;

	const keyboard = navigation(kind, page, totalPages, query);
	const header = [bold(`${LISTINGS[kind].title} (${total})`)];
	if (totalPages > 1)
		header.push(keyboard ? `Página ${page} de ${totalPages}` : `Mostrando os ${items.length} primeiros: a busca é longa demais para paginar, refine o termo.`);

	const compose = (compact: boolean) => [header.join('\n'), ...items.map((render) => render(compact))].join('\n\n');
	const full = compose(false);
	return { text: full.length <= TELEGRAM_MESSAGE_LIMIT ? full : compose(true), keyboard };
}

/**
 * Reply with the first page of a listing.
 * @param query - Search text, for the search listings
 */
export async function replyListing(ctx: Context, dependencies: BotDependencies, kind: ListingKind, query = ''): Promise<void> {
	const listing = await renderListing(dependencies, kind, 1, query);
	if (!listing) return void (await ctx.reply(LISTINGS[kind].empty));
	await ctx.reply(listing.text, { ...HTML_OPTIONS, reply_markup: listing.keyboard });
}

/** Handles the navigation buttons by editing the listing message in place. */
export function listingNavigation(dependencies: BotDependencies): Composer<Context> {
	const composer = new Composer<Context>();

	composer.callbackQuery(NOOP_CALLBACK, (ctx) => ctx.answerCallbackQuery());

	composer.callbackQuery(CALLBACK_PATTERN, async (ctx) => {
		const [, kind, page, query = ''] = ctx.match as RegExpMatchArray;
		const listing = await renderListing(dependencies, kind as ListingKind, Number(page), query);

		try {
			if (listing) await ctx.editMessageText(listing.text, { ...HTML_OPTIONS, reply_markup: listing.keyboard });
			else await ctx.editMessageText(LISTINGS[kind as ListingKind].empty);
		} catch (error) {
			// Pressing the button of the page already shown changes nothing, which Telegram reports as an error.
			if (!(error instanceof Error && error.message.includes('message is not modified'))) throw error;
		}
		await ctx.answerCallbackQuery();
	});

	return composer;
}

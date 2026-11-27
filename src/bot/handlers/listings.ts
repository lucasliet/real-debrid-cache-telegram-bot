import { Composer, type Context, InlineKeyboard } from 'grammy';
import type { BotDependencies } from '@/bot/createBot.ts';
import { replyBlocks } from '@/bot/messaging.ts';
import { bold } from '@/bot/views/html.ts';
import { downloadCard, streamBlocks, torrentCard, unrestrictedLinkCard } from '@/bot/views/library.ts';
import { LISTING_PAGE_SIZE, TELEGRAM_MESSAGE_LIMIT } from '@/config/constants.ts';
import type { Download, Page, Torrent, UnrestrictedLink } from '@/realdebrid/types.ts';
import type { Sleep } from '@/util/sleep.ts';

/**
 * Listings the user can page through and act on. Each one is a single message with one row of action buttons
 * per entry, numbered like the cards. Everything is driven by inline keyboards because
 * links that prefill a command (`tg://msg`) are not understood by every Telegram client.
 */
const LISTINGS = {
	t: { title: '📥 Torrents', empty: '❌ Nenhum torrent encontrado.', entries: 'torrent' },
	d: { title: '📦 Downloads', empty: '❌ Nenhum download encontrado.', entries: 'download' },
	i: { title: '⏳ Torrents incompletos', empty: '✅ Nenhum torrent incompleto.', entries: 'torrent' },
	st: { title: '📥 Torrents encontrados', empty: '❌ Nenhum torrent encontrado para esta busca.', entries: 'torrent' },
	sd: { title: '📦 Downloads encontrados', empty: '❌ Nenhum download encontrado para esta busca.', entries: 'download' },
} as const;

export type ListingKind = keyof typeof LISTINGS;

function isListingKind(candidate: string): candidate is ListingKind {
	return Object.hasOwn(LISTINGS, candidate);
}

/** Listing kind carried in callback data; the navigation patterns only match known kinds, so the throw is a defensive guard. */
function listingKind(candidate: string): ListingKind {
	if (!isListingKind(candidate)) throw new Error(`Unknown listing kind in callback data: ${candidate}`);
	return candidate;
}

type Entry = { readonly type: 'torrent'; readonly item: Torrent } | { readonly type: 'download'; readonly item: Download };

/** Builds the torrent half of an `Entry`, so callers hand over items without crossing the union. */
export const torrentEntry = (item: Torrent): Extract<Entry, { type: 'torrent' }> => ({ type: 'torrent', item });

/** Builds the download half of an `Entry`. */
export const downloadEntry = (item: Download): Extract<Entry, { type: 'download' }> => ({ type: 'download', item });

/** Where a button leads back to: a page of a listing. All the state lives in the callback data. */
interface Location {
	readonly kind: ListingKind;
	readonly page: number;
	readonly query: string;
}

interface Screen {
	readonly text: string;
	readonly keyboard?: InlineKeyboard;
}

const HTML_OPTIONS = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } as const;

/**
 * Telegram limits callback data to 64 bytes. The longest prefix is `x:ry:sd:<page>:<id>:`, so a search text
 * up to this size always fits next to it; a longer one cannot be carried by the buttons.
 */
const MAX_QUERY_BYTES = 28;

const PAGE_PATTERN = /^p:(t|d|i|st|sd):(\d+)(?::([\s\S]*))?$/;
const ENTRY_PATTERN = /^(o|x:dl|x:sm|x:rm|x:ry):(t|d|i|st|sd):(\d+):([^:]+)(?::([\s\S]*))?$/;
const NOOP = 'noop';

/** Buttons that do not belong to a listing: they act on an id alone and answer with a new message. */
const SHOW_INCOMPLETE = 'n:i';
const DOWNLOAD_LINKS_PATTERN = /^g:([^:]+)$/;
const STREAM_PATTERN = /^s:([^:]+)$/;

function fitsInButtons(query: string): boolean {
	return new TextEncoder().encode(query).length <= MAX_QUERY_BYTES;
}

function suffix({ query }: Location): string {
	return query ? `:${query}` : '';
}

const pageData = (location: Location) => `p:${location.kind}:${location.page}${suffix(location)}`;
const entryData = (action: string, location: Location, id: string) => `${action}:${location.kind}:${location.page}:${id}${suffix(location)}`;

function slicePage<T>(items: readonly T[], page: number): Page<T> {
	return { items: items.slice((page - 1) * LISTING_PAGE_SIZE, page * LISTING_PAGE_SIZE), total: items.length };
}

const asTorrents = (page: Page<Torrent>): Page<Entry> => ({ total: page.total, items: page.items.map((item) => ({ type: 'torrent', item })) });
const asDownloads = (page: Page<Download>): Page<Entry> => ({ total: page.total, items: page.items.map((item) => ({ type: 'download', item })) });

/**
 * Load one page of a listing. Plain listings are paged by the API itself; filtered ones
 * (incomplete, search) are computed over the whole library and sliced.
 */
async function loadPage({ realDebrid, library }: BotDependencies, { kind, page, query }: Location): Promise<Page<Entry>> {
	switch (kind) {
		case 't':
			return asTorrents(await realDebrid.listTorrents(page, LISTING_PAGE_SIZE));
		case 'd':
			return asDownloads(await realDebrid.listDownloads(page, LISTING_PAGE_SIZE));
		case 'i':
			return asTorrents(slicePage(await library.listIncompleteTorrents(), page));
		case 'st':
			return asTorrents(slicePage(await library.findTorrents(query), page));
		case 'sd':
			return asDownloads(slicePage(await library.findDownloads(query), page));
	}
}

function card(entry: Entry, compact: boolean): string {
	return entry.type === 'torrent' ? torrentCard(entry.item, { compact }) : downloadCard(entry.item, { compact });
}

/** Numbered cards, with shortened names when the full ones would not fit one message. */
function numberedCards(header: string, entries: readonly Entry[]): string {
	// Numbers tie each card to its row of buttons; a single entry needs none.
	const numbered = entries.length > 1;
	const compose = (compact: boolean) =>
		[header, ...entries.map((entry, index) => (numbered ? `${bold(`${index + 1}.`)} ${card(entry, compact)}` : card(entry, compact)))].join('\n\n');
	const full = compose(false);
	return full.length <= TELEGRAM_MESSAGE_LIMIT ? full : compose(true);
}

/**
 * One row of action buttons per entry, labelled with the entry's number, so every action is one tap away.
 * Deleting leads to a confirmation screen; the other actions answer right away.
 */
function addActionRows(keyboard: InlineKeyboard, entries: readonly Entry[], location: Location): void {
	for (const [index, entry] of entries.entries()) {
		const number = entries.length > 1 ? ` ${index + 1}` : '';
		const { id } = entry.item;

		// Delete comes first, on the left, where it always was.
		keyboard.text(`🗑️ Deletar${number}`, entryData('x:rm', location, id));
		if (entry.type === 'torrent') {
			if (entry.item.status === 'downloaded') keyboard.text(`⬇️ Baixar${number}`, entryData('x:dl', location, id));
		} else {
			keyboard.url(`⬇️ Baixar${number}`, entry.item.download);
			if (entry.item.streamable === 1) keyboard.text(`🎥 Stream${number}`, entryData('x:sm', location, id));
		}
		keyboard.row();
	}
}

/**
 * Build one page of a listing, clamping the page to what exists (the library may have shrunk since the buttons were drawn).
 * @returns The screen, or `undefined` when the listing is empty
 */
async function listingScreen(dependencies: BotDependencies, requested: Location): Promise<Screen | undefined> {
	let location = { ...requested, page: Math.max(1, requested.page) };
	let { items, total } = await loadPage(dependencies, location);
	const totalPages = Math.max(1, Math.ceil(total / LISTING_PAGE_SIZE));
	if (items.length === 0 && total > 0) {
		location = { ...location, page: totalPages };
		({ items, total } = await loadPage(dependencies, location));
	}
	if (items.length === 0) return undefined;

	const { kind, page, query } = location;
	const pageable = fitsInButtons(query);
	// A search text too long for the buttons cannot be paged; its entries are still reachable by id.
	const anchor: Location = pageable ? location : { kind: LISTINGS[kind].entries === 'torrent' ? 't' : 'd', page: 1, query: '' };

	const header = [bold(`${LISTINGS[kind].title} (${total})`)];
	if (totalPages > 1)
		header.push(pageable ? `Página ${page} de ${totalPages}` : `Mostrando os ${items.length} primeiros: a busca é longa demais para paginar, refine o termo.`);
	if (items.length > 1) header.push('Os botões abaixo agem sobre o item de mesmo número.');

	const keyboard = new InlineKeyboard();
	addActionRows(keyboard, items, anchor);
	if (totalPages > 1 && pageable) {
		if (page > 1) keyboard.text('⏮', pageData({ kind, page: 1, query })).text('◀️', pageData({ kind, page: page - 1, query }));
		keyboard.text(`${page}/${totalPages}`, NOOP);
		if (page < totalPages) keyboard.text('▶️', pageData({ kind, page: page + 1, query })).text('⏭', pageData({ kind, page: totalPages, query }));
	}

	return { text: numberedCards(header.join('\n'), items), keyboard };
}

/** Find an entry on the page it was listed in, or by its id when the page has shifted since. */
async function findEntry(dependencies: BotDependencies, location: Location, id: string): Promise<Entry | undefined> {
	const onPage = (await loadPage(dependencies, location)).items.find((entry) => entry.item.id === id);
	if (onPage) return onPage;

	if (LISTINGS[location.kind].entries === 'torrent') {
		const all = await dependencies.realDebrid.listAllTorrents();
		const item = all.find((torrent) => torrent.id === id);
		return item && { type: 'torrent', item };
	}
	const item = (await dependencies.realDebrid.listAllDownloads()).find((download) => download.id === id);
	return item && { type: 'download', item };
}

/** One entry with its actions as buttons. Kept for the numbered buttons of listings sent before the actions moved into the list. */
function entryScreen(entry: Entry, location: Location): Screen {
	const keyboard = new InlineKeyboard();
	const { id } = entry.item;

	keyboard.text('🗑️ Deletar', entryData('x:rm', location, id));
	if (entry.type === 'torrent') {
		if (entry.item.status === 'downloaded') keyboard.text('⬇️ Baixar', entryData('x:dl', location, id));
	} else {
		keyboard.url('⬇️ Baixar', entry.item.download);
		if (entry.item.streamable === 1) keyboard.text('🎥 Stream', entryData('x:sm', location, id));
	}
	keyboard.row().text('↩️ Voltar à lista', pageData(location));

	return { text: card(entry, false), keyboard };
}

/** Deleting cannot be undone, so the button asks before doing it. */
function confirmDeletionScreen(entry: Entry, location: Location): Screen {
	const keyboard = new InlineKeyboard().text('✅ Sim, deletar', entryData('x:ry', location, entry.item.id)).text('↩️ Cancelar', pageData(location));
	return { text: `${card(entry, false)}\n\n${bold(`⚠️ Deletar este ${entry.type}? Esta ação não pode ser desfeita.`)}`, keyboard };
}

/** Button that lists, in a new message, the torrents still in progress. */
export function progressButton(keyboard = new InlineKeyboard()): InlineKeyboard {
	return keyboard.text('⏳ Ver progresso', SHOW_INCOMPLETE);
}

/** Button that sends the direct links of a torrent once it has finished. */
export function downloadLinksButton(torrentId: string, keyboard = new InlineKeyboard()): InlineKeyboard {
	return keyboard.text('⬇️ Baixar', `g:${torrentId}`);
}

/** Button that asks to delete a torrent the user was just told about; it reuses the confirmation of the listings. */
export function removeTorrentButton(torrentId: string, keyboard = new InlineKeyboard()): InlineKeyboard {
	return keyboard.text('🗑️ Remover', entryData('x:rm', { kind: 'i', page: 1, query: '' }, torrentId));
}

/**
 * Reply with direct download links, with one streaming button per streamable file.
 * @param title - Heading of the message
 */
export async function replyDownloadLinks(ctx: Context, title: string, files: readonly UnrestrictedLink[], sleep: Sleep): Promise<void> {
	const numbered = files.length > 1;
	const keyboard = new InlineKeyboard();
	for (const [index, file] of files.entries()) {
		if (file.streamable === 1) keyboard.text(numbered ? `🎥 Stream ${index + 1}` : '🎥 Stream', `s:${file.id}`).row();
	}
	const blocks = [bold(title), ...files.map((file, index) => unrestrictedLinkCard(file, numbered ? index + 1 : undefined))];
	await replyBlocks(ctx, blocks, sleep, keyboard.inline_keyboard.flat().length > 0 ? keyboard : undefined);
}

async function replyStreamLinks(ctx: Context, dependencies: BotDependencies, downloadId: string): Promise<void> {
	const blocks = streamBlocks(await dependencies.realDebrid.getTranscodeLinks(downloadId));
	if (blocks.length === 0) return void (await ctx.answerCallbackQuery({ text: 'Nenhum link de streaming disponível.', show_alert: true }));
	await replyBlocks(ctx, [bold('🎥 Links de streaming'), ...blocks], dependencies.sleep);
	await ctx.answerCallbackQuery();
}

/**
 * Reply with the first page of a listing.
 * @param query - Search text, for the search listings
 */
export async function replyListing(ctx: Context, dependencies: BotDependencies, kind: ListingKind, query = ''): Promise<void> {
	const screen = await listingScreen(dependencies, { kind, page: 1, query });
	if (!screen) return void (await ctx.reply(LISTINGS[kind].empty));
	await ctx.reply(screen.text, { ...HTML_OPTIONS, reply_markup: screen.keyboard });
}

/**
 * Reply with a fixed set of entries (such as AI suggestions), each one openable by its number.
 * @param title - Heading of the message
 * @param entries - Entries to show, all of the same kind, built with `torrentEntry`/`downloadEntry`; at most one page is sent
 */
export async function replyEntries(ctx: Context, title: string, entries: readonly Extract<Entry, { type: 'torrent' }>[]): Promise<void>;
export async function replyEntries(ctx: Context, title: string, entries: readonly Extract<Entry, { type: 'download' }>[]): Promise<void>;
export async function replyEntries(ctx: Context, title: string, entries: readonly Entry[]): Promise<void> {
	const visible = entries.slice(0, LISTING_PAGE_SIZE);
	const keyboard = new InlineKeyboard();
	// These entries come from no reproducible listing, so "back" leads to the plain listing of their type.
	const kind = visible[0]?.type === 'download' ? 'd' : 't';
	addActionRows(keyboard, visible, { kind, page: 1, query: '' });
	const header =
		visible.length > 1 ? `${bold(`${title} (${visible.length})`)}\nOs botões abaixo agem sobre o item de mesmo número.` : bold(`${title} (${visible.length})`);
	await ctx.reply(numberedCards(header, visible), { ...HTML_OPTIONS, reply_markup: keyboard });
}

/** Replace the message the button belongs to. */
async function show(ctx: Context, screen: Screen): Promise<void> {
	try {
		await ctx.editMessageText(screen.text, { ...HTML_OPTIONS, reply_markup: screen.keyboard });
	} catch (error) {
		// Tapping a button that leads to what is already shown changes nothing, which Telegram reports as an error.
		if (!(error instanceof Error && error.message.includes('message is not modified'))) throw error;
	}
}

async function showListing(ctx: Context, dependencies: BotDependencies, location: Location): Promise<void> {
	await show(ctx, (await listingScreen(dependencies, location)) ?? { text: LISTINGS[location.kind].empty });
}

/** Groups of callback data a pattern matched. grammy filtered with the same pattern, so the throw is unreachable — and loud, via the error boundary, if that ever changes. */
function capturesOf(pattern: RegExp, data: string): RegExpExecArray {
	const match = pattern.exec(data);
	if (!match) throw new Error(`Callback data does not match ${pattern}: ${data}`);
	return match;
}

/** Handles every button of the listings by editing the message in place. */
export function listingNavigation(dependencies: BotDependencies): Composer<Context> {
	const { realDebrid, library, sleep } = dependencies;
	const composer = new Composer<Context>();

	composer.callbackQuery(NOOP, (ctx) => ctx.answerCallbackQuery());

	composer.callbackQuery(SHOW_INCOMPLETE, async (ctx) => {
		await replyListing(ctx, dependencies, 'i');
		await ctx.answerCallbackQuery();
	});

	composer.callbackQuery(DOWNLOAD_LINKS_PATTERN, async (ctx) => {
		const [, torrentId] = capturesOf(DOWNLOAD_LINKS_PATTERN, ctx.callbackQuery.data);
		await replyDownloadLinks(ctx, '📥 Links de download', await library.getDownloadLinks(torrentId), sleep);
		await ctx.answerCallbackQuery();
	});

	composer.callbackQuery(STREAM_PATTERN, async (ctx) => {
		const [, downloadId] = capturesOf(STREAM_PATTERN, ctx.callbackQuery.data);
		await replyStreamLinks(ctx, dependencies, downloadId);
	});

	composer.callbackQuery(PAGE_PATTERN, async (ctx) => {
		const [, kind, page, query = ''] = capturesOf(PAGE_PATTERN, ctx.callbackQuery.data);
		await showListing(ctx, dependencies, { kind: listingKind(kind), page: Number(page), query });
		await ctx.answerCallbackQuery();
	});

	composer.callbackQuery(ENTRY_PATTERN, async (ctx) => {
		const [, action, kind, page, id, query = ''] = capturesOf(ENTRY_PATTERN, ctx.callbackQuery.data);
		const location: Location = { kind: listingKind(kind), page: Number(page), query };

		const entry = await findEntry(dependencies, location, id);
		if (!entry) {
			await showListing(ctx, dependencies, location);
			return void (await ctx.answerCallbackQuery({ text: 'Este item não existe mais.' }));
		}

		switch (action) {
			case 'o':
				await show(ctx, entryScreen(entry, location));
				break;
			case 'x:rm':
				await show(ctx, confirmDeletionScreen(entry, location));
				break;
			case 'x:ry':
				if (entry.type === 'torrent') await realDebrid.deleteTorrent(id);
				else await realDebrid.deleteDownload(id);
				await showListing(ctx, dependencies, location);
				return void (await ctx.answerCallbackQuery({ text: '✅ Deletado.' }));
			case 'x:dl':
				await replyDownloadLinks(ctx, '📥 Links de download', await library.getDownloadLinks(id), sleep);
				break;
			case 'x:sm':
				return await replyStreamLinks(ctx, dependencies, id);
		}
		await ctx.answerCallbackQuery();
	});

	return composer;
}

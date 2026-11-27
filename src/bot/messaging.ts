import type { Context } from 'grammy';
import { TELEGRAM_MESSAGE_LIMIT } from '@/config/constants.ts';
import { RealDebridError } from '@/realdebrid/RealDebridError.ts';
import { sleep as realSleep, type Sleep } from '@/util/sleep.ts';
import { UserFacingError } from '@/util/UserFacingError.ts';

const BLOCK_SEPARATOR = '\n\n';

/** Telegram allows about one message per second per chat; see https://core.telegram.org/bots/faq#broadcasting-to-users */
const DELAY_BETWEEN_MESSAGES_MS = 1100;

const HTML_OPTIONS = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } as const;

/**
 * Group blocks into as few messages as possible without splitting a block,
 * so HTML tags are never cut in half. A block longer than the limit is split between its lines.
 * @param blocks - Self-contained pieces of text (e.g. one per torrent)
 * @param limit - Maximum length of each message
 * @returns Messages ready to send, in order
 */
export function packBlocks(blocks: readonly string[], limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
	const messages: string[] = [];
	let current = '';

	for (const block of blocks.flatMap((block) => splitOversized(block, limit))) {
		const candidate = current ? current + BLOCK_SEPARATOR + block : block;
		if (candidate.length <= limit && countEntities(candidate) <= MAX_ENTITIES_PER_MESSAGE) {
			current = candidate;
			continue;
		}
		if (current) messages.push(current);
		current = block;
	}

	if (current) messages.push(current);
	return messages;
}

/** Telegram keeps only the first 100 formatting entities of a message; anything beyond loses its formatting and links. */
const MAX_ENTITIES_PER_MESSAGE = 100;

function countEntities(html: string): number {
	return html.match(/<(b|code|a)[ >]/g)?.length ?? 0;
}

/** Split an oversized block between lines, so markup is not cut; only a single line longer than the limit is sliced. */
function splitOversized(block: string, limit: number): string[] {
	if (block.length <= limit) return [block];
	const pieces: string[] = [];
	let current = '';

	for (const line of block.split('\n')) {
		const candidate = current ? `${current}\n${line}` : line;
		if (candidate.length <= limit) {
			current = candidate;
			continue;
		}
		if (current) pieces.push(current);
		current = line;
		while (current.length > limit) {
			pieces.push(current.slice(0, limit));
			current = current.slice(limit);
		}
	}

	if (current) pieces.push(current);
	return pieces;
}

/** Reply with a single HTML message. */
export async function replyHtml(ctx: Context, html: string): Promise<void> {
	await ctx.reply(html, HTML_OPTIONS);
}

/**
 * Reply with HTML blocks packed into as few messages as possible, pacing them to respect Telegram's rate limit.
 * @param blocks - Self-contained HTML pieces (already escaped)
 */
export async function replyBlocks(ctx: Context, blocks: readonly string[], sleep: Sleep = realSleep): Promise<void> {
	const messages = packBlocks(blocks);
	for (const [index, message] of messages.entries()) {
		if (index > 0) await sleep(DELAY_BETWEEN_MESSAGES_MS);
		await ctx.reply(message, HTML_OPTIONS);
	}
}

/**
 * Edit a previously sent message. Failures are logged and swallowed: progress updates are cosmetic
 * and must never abort the work they report on.
 */
export async function editHtml(ctx: Context, chatId: number, messageId: number, html: string): Promise<void> {
	try {
		await ctx.api.editMessageText(chatId, messageId, html, HTML_OPTIONS);
	} catch (error) {
		console.warn('[BOT] Could not edit progress message:', error);
	}
}

/**
 * Turn any failure into a plain-text explanation for the user,
 * without leaking internals of unexpected errors.
 */
export function describeError(error: unknown): string {
	if (error instanceof RealDebridError || error instanceof UserFacingError) return error.message;
	return 'erro inesperado, tente novamente mais tarde';
}

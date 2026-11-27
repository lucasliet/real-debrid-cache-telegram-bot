import type { Context, MiddlewareFn } from 'grammy';
import { describeError } from '@/bot/messaging.ts';
import { RealDebridError } from '@/realdebrid/RealDebridError.ts';
import { UserFacingError } from '@/util/UserFacingError.ts';

/**
 * Report any failure of the downstream handlers to the user, so handlers can simply throw.
 * Expected failures are logged as warnings; anything else is logged in full for diagnosis.
 */
export const errorBoundary: MiddlewareFn<Context> = async (ctx, next) => {
	try {
		await next();
	} catch (error) {
		const expected = error instanceof RealDebridError || error instanceof UserFacingError;
		if (expected) console.warn(`[BOT] Update ${ctx.update.update_id} failed: ${error.message}`);
		else console.error(`[BOT] Update ${ctx.update.update_id} failed unexpectedly:`, error);

		try {
			await ctx.reply(`❌ ${describeError(error)}`);
		} catch (replyError) {
			console.error('[BOT] Could not report the failure to the user:', replyError);
		}
	}
};

/**
 * Only let updates from the allowed user through. The webhook secret already guarantees
 * the update comes from Telegram, so `from.id` can be trusted.
 * @param allowedUserId - Telegram id of the bot owner
 */
export function allowOnly(allowedUserId: number): MiddlewareFn<Context> {
	return async (ctx, next) => {
		if (ctx.from?.id === allowedUserId) return await next();
		console.warn(`[BOT] Rejected update from user ${ctx.from?.id ?? 'unknown'}`);
		if (ctx.chat) await ctx.reply('Desculpe, você não tem permissão para usar este bot.');
	};
}

/**
 * Read the argument of a command.
 * @param ctx - Context of a command update
 * @param usage - Example shown when the argument is missing, e.g. `/download 12345`
 * @throws UserFacingError when the command came without an argument
 */
export function requireArgument(ctx: Context, usage: string): string {
	const argument = typeof ctx.match === 'string' ? ctx.match.trim() : '';
	if (!argument) throw new UserFacingError(`Faltou o argumento. Exemplo: ${usage}`);
	return argument;
}

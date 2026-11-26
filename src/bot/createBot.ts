import { Bot, type Context } from 'grammy';
import type { BotFullInfo } from 'grammy/types';
import { helpMessage, welcomeMessage } from '@/bot/commands.ts';
import { ingestionHandlers } from '@/bot/handlers/ingestion.ts';
import { libraryHandlers } from '@/bot/handlers/library.ts';
import { replyHtml } from '@/bot/messaging.ts';
import { allowOnly, errorBoundary } from '@/bot/middleware.ts';
import type { AppConfig } from '@/config/environment.ts';
import { RealDebridClient } from '@/realdebrid/RealDebridClient.ts';
import { LibraryService } from '@/services/LibraryService.ts';
import { TinfoilService } from '@/services/TinfoilService.ts';
import { TorrentIngestionService } from '@/services/TorrentIngestionService.ts';
import { type Sleep, sleep as realSleep } from '@/util/sleep.ts';

/** Everything the handlers depend on, wired once in `buildDependencies` and replaceable in tests. */
export interface BotDependencies {
	readonly config: AppConfig;
	readonly realDebrid: RealDebridClient;
	readonly library: LibraryService;
	readonly ingestion: TorrentIngestionService;
	readonly tinfoil: TinfoilService;
	readonly fetch: typeof fetch;
	readonly sleep: Sleep;
}

export interface BotOptions {
	/** Outbound HTTP used for Real-Debrid, Tinfoil and Telegram file downloads. */
	fetch?: typeof fetch;
	sleep?: Sleep;
	/** Bot identity; when given, the `getMe` call to Telegram is skipped. */
	botInfo?: BotFullInfo;
}

/** Composition root: build the object graph from the configuration. */
export function buildDependencies(config: AppConfig, options: BotOptions = {}): BotDependencies {
	const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
	const sleep = options.sleep ?? realSleep;
	const realDebrid = new RealDebridClient({ token: config.realDebridToken, fetch: fetchImpl, sleep });

	return {
		config,
		realDebrid,
		library: new LibraryService(realDebrid),
		ingestion: new TorrentIngestionService(realDebrid, { sleep }),
		tinfoil: new TinfoilService({ ...config.tinfoil, fetch: fetchImpl }),
		fetch: fetchImpl,
		sleep,
	};
}

/**
 * Create the bot with every handler registered. Handlers are awaited end to end, so an update
 * is only considered handled (and its queue message acknowledged) after the work finishes.
 * On Workers this must run inside a handler, since network I/O is not allowed at module scope.
 * @param config - Application configuration
 * @param options - Overrides for outbound I/O and bot identity
 * @returns Initialized bot
 */
export async function createBot(config: AppConfig, options: BotOptions = {}): Promise<Bot<Context>> {
	const dependencies = buildDependencies(config, options);
	const bot = new Bot<Context>(config.botToken, { botInfo: options.botInfo });
	if (!options.botInfo) await bot.init();

	bot.use(errorBoundary, allowOnly(config.allowedUserId));

	bot.command('start', (ctx) => replyHtml(ctx, welcomeMessage()));
	bot.command(['ajuda', 'help'], (ctx) => replyHtml(ctx, helpMessage()));
	bot.command('update_tinfoil', async (ctx) => {
		await dependencies.tinfoil.refresh();
		await ctx.reply('✅ Atualização do Tinfoil concluída com sucesso!');
	});

	bot.use(libraryHandlers(dependencies));
	bot.use(ingestionHandlers(dependencies));

	return bot;
}

import { Bot } from 'grammy';
import type { Update } from 'grammy-types';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Environment } from '@/config/environment.ts';
import { TorrentHandler } from '@/handlers/TorrentHandler.ts';
import { WebhookService } from '@/services/WebhookService.ts';
import { HelpService } from '@/services/HelpService.ts';
import { RealDebridService } from '@/services/RealDebridService.ts';
import { deriveWebhookSecret, isValidWebhookSecret, WEBHOOK_SECRET_HEADER } from '@/util/WebhookSecret.ts';
import type { MyContext } from '@/types/grammy.d.ts';
import '@/prototypes/ContextExtensionPrototype.ts';

const TINFOIL_UPDATE_URL = 'https://foil.lucasliet.com.br/update';

function isAllowedUser(ctx: MyContext): boolean {
	return ctx.from?.id === Environment.getInstance().ALLOWED_USER_ID;
}

/**
 * Build the Basic auth header from the `user:pass` pair, since Workers reject credentials embedded in the URL.
 * @param userPass - Credentials in the `user:pass` format
 * @returns Value for the `Authorization` header
 */
function basicAuthHeader(userPass: string): string {
	return `Basic ${btoa(userPass)}`;
}

async function updateTinfoil(ctx: MyContext): Promise<void> {
	try {
		const response = await fetch(TINFOIL_UPDATE_URL, {
			headers: { 'Authorization': basicAuthHeader(Environment.getInstance().TINFOIL_USER_PASS) },
			redirect: 'manual',
		});
		if (response.ok) {
			await ctx.reply('✅ Atualização do Tinfoil concluída com sucesso!');
		} else {
			await ctx.reply('❌ Erro ao atualizar Tinfoil: ' + response.statusText);
		}
	} catch (error) {
		await ctx.reply(
			`❌ Erro ao atualizar Tinfoil: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}

async function cleanSwitchTorrents(ctx: MyContext, realDebridService: RealDebridService): Promise<void> {
	try {
		const result = await realDebridService.deleteSwitchTorrents();
		let message = `✅ ${result.deleted} torrent(s) de jogos de Nintendo Switch foram deletados.`;

		if (result.errors.length > 0) {
			message += '\n\n⚠️ Erros encontrados:\n';
			message += result.errors.join('\n');
		}

		await ctx.reply(message);
	} catch (error) {
		await ctx.reply(
			`❌ Erro ao limpar torrents de Switch: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}

async function cleanTorrentsByName(ctx: MyContext, realDebridService: RealDebridService, query: string): Promise<void> {
	try {
		const result = await realDebridService.cleanByName(query);
		let message = `✅ ${result.deleted} torrent(s) com "${query}" no nome foram deletados.`;

		if (result.errors.length > 0) {
			message += '\n\n⚠️ Erros encontrados:\n';
			message += result.errors.join('\n');
		}

		await ctx.reply(message);
	} catch (error) {
		await ctx.reply(
			`❌ Erro ao limpar torrents: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}

/**
 * Register bot commands and handlers. Every handler is awaited, so the update is only
 * considered handled (and the queue message acknowledged) after its work finishes.
 * @param bot - Bot instance receiving the handlers
 */
function registerBotCommands(bot: Bot<MyContext>): void {
	const torrentHandler = new TorrentHandler();
	const helpService = HelpService.getInstance();
	const realDebridService = RealDebridService.getInstance();

	bot.use(async (ctx, next) => {
		if (!isAllowedUser(ctx)) {
			await ctx.reply('Desculpe, você não tem permissão para usar este bot.');
			return;
		}
		await next();
	});

	bot.command('start', (ctx) => helpService.sendWelcome(ctx));
	bot.command('ajuda', (ctx) => helpService.sendHelp(ctx));

	bot.command('update_tinfoil', (ctx) => updateTinfoil(ctx));

	bot.command('download', async (ctx) => {
		const id = ctx.message?.text.split(' ')[1];
		if (!id) {
			await ctx.reply(
				'Por favor, forneça o ID do torrent. Exemplo: /download 12345',
			);
			return;
		}
		await torrentHandler.handleDownload(ctx, id);
	});

	bot.command('status_torrent', async (ctx) => {
		try {
			const torrents = await realDebridService.listTorrents();
			const message = torrents.map((t) =>
				`**🆔 ID:** \`${t.id}\`\n**📂 Nome:** ${t.filename}\n**📊 Status:** ${t.status}\n**📈 Progresso:** ${t.progress}%\n──────────────\n[   🗑️ Deletar   ](tg://msg?text=/delete_torrent ${t.id}) [   ⬇️ Baixar   ](tg://msg?text=/download ${t.id})\n──────────────`
			).join('\n\n');
			await ctx.replyInChunks(message || '❌ Nenhum torrent encontrado');
		} catch (error) {
			await ctx.reply(
				`❌ Erro ao listar torrents: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
		}
	});

	bot.command('status_download', async (ctx) => {
		try {
			const downloads = await realDebridService.listDownloads();
			const message = downloads.map((d) => {
				let downloadInfo = `**🆔 ID:** \`${d.id}\`\n**📂 Nome:** ${d.filename}\n**💾 Tamanho:** ${(d.filesize / 1024 / 1024).toFixed(2)}MB\n──────────────\n`;

				downloadInfo += `[   🗑️ Deletar   ](tg://msg?text=/delete_download ${d.id}) [   ⬇️ Baixar   ](${d.download})`;

				if (d.streamable === 1) {
					downloadInfo += `\n──────────────\n[   🎥 Stream   ](tg://msg?text=/stream ${d.id})`;
				}

				downloadInfo += '\n──────────────';
				return downloadInfo;
			}).join('\n\n');
			await ctx.replyInChunks(message || '❌ Nenhum download encontrado');
		} catch (error) {
			await ctx.reply(
				`❌ Erro ao listar downloads: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
		}
	});

	bot.command('incomplete', async (ctx) => {
		try {
			const torrents = await realDebridService.listTorrents();
			const incompleteTorrents = torrents.filter((t) => t.status !== 'downloaded');
			const message = incompleteTorrents.map((t) =>
				`**🆔 ID:** \`${t.id}\`\n**📂 Nome:** ${t.filename}\n**📊 Status:** ${t.status}\n**📈 Progresso:** ${t.progress}%\n──────────────\n[   🗑️ Deletar   ](tg://msg?text=/delete_torrent ${t.id})\n──────────────`
			).join('\n\n');
			await ctx.replyInChunks(message || '❌ Nenhum torrent incompleto encontrado');
		} catch (error) {
			await ctx.reply(
				`❌ Erro ao listar torrents: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
		}
	});

	bot.command('delete_torrent', async (ctx) => {
		const id = ctx.message?.text.split(' ')[1];
		if (!id) {
			await ctx.reply(
				'Por favor, forneça o ID do torrent. Exemplo: /delete_torrent 12345',
			);
			return;
		}

		try {
			await realDebridService.deleteTorrent(id);
			await ctx.reply(`Torrent ${id} deletado com sucesso!`);
		} catch (error) {
			await ctx.reply(
				`Erro ao deletar torrent: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
		}
	});

	bot.command('delete_download', async (ctx) => {
		const id = ctx.message?.text.split(' ')[1];
		if (!id) {
			await ctx.reply(
				'Por favor, forneça o ID do download. Exemplo: /delete_download 12345',
			);
			return;
		}

		try {
			await realDebridService.deleteDownload(id);
			await ctx.reply(`Download ${id} deletado com sucesso!`);
		} catch (error) {
			await ctx.reply(
				`Erro ao deletar download: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
		}
	});

	bot.command('clean_nsw', (ctx) => cleanSwitchTorrents(ctx, realDebridService));

	bot.command('clean_by', async (ctx) => {
		const query = ctx.message?.text.split(' ').slice(1).join(' ');
		if (!query) {
			await ctx.reply(
				'Por favor, forneça um termo de busca. Exemplo: /clean_by zelda',
			);
			return;
		}
		await cleanTorrentsByName(ctx, realDebridService, query);
	});

	bot.command('stream', async (ctx) => {
		const id = ctx.message?.text.split(' ')[1];
		if (!id) {
			await ctx.reply(
				'Por favor, forneça o ID do arquivo. Exemplo: /stream 12345',
			);
			return;
		}
		await torrentHandler.handleStream(ctx, id);
	});

	bot.on('message:document', async (ctx) => {
		if (!ctx.message?.document?.file_name?.endsWith('.torrent')) {
			await helpService.sendInvalidFileHelp(ctx);
			return;
		}
		await torrentHandler.handleTorrentFile(ctx);
	});

	bot.on('message:text', (ctx) => {
		if (ctx.message.text.startsWith('magnet:')) {
			return torrentHandler.handleMagnetLink(ctx, ctx.message.text);
		}
		return torrentHandler.handleSearchText(ctx, ctx.message.text);
	});
}

/**
 * Create the bot, fetch its identity from Telegram and register every handler.
 * Must run inside a handler on Workers (network I/O is not allowed at module scope).
 * @returns Initialized bot instance
 */
export async function createBot(): Promise<Bot<MyContext>> {
	const bot = new Bot<MyContext>(Environment.getInstance().BOT_TOKEN);
	await bot.init();
	registerBotCommands(bot);
	return bot;
}

/**
 * Build the HTTP app that receives Telegram webhook updates and hands them to `enqueueUpdate`.
 * Requests without the secret header derived from the bot token are rejected with 401, since `from.id`
 * (used by the allowed user check) is otherwise unauthenticated. A failed enqueue returns 500 so Telegram redelivers it.
 * @param enqueueUpdate - Persists the update for asynchronous processing (a Cloudflare Queue in production)
 * @returns Hono app with CORS, logging, webhook and setWebhook routes
 */
export function createWebhookApp(enqueueUpdate: (update: Update) => Promise<void>): Hono {
	const app = new Hono();
	app.use('*', cors());

	app.use('*', async (c, next) => {
		const start = Date.now();
		await next();
		console.log(`${c.req.method} ${c.req.url} - ${Date.now() - start}ms`);
	});

	app.get('/', async (c) => {
		await WebhookService.getInstance().setWebhook();
		return c.text('Real-Debrid Cache Bot funcionando!');
	});

	app.post('/webhook', async (c) => {
		const botToken = Environment.getInstance().BOT_TOKEN;
		if (!botToken) {
			console.error('[WEBHOOK] BOT_TOKEN is not configured');
			return c.json({ ok: false, error: 'not configured' }, 500);
		}

		const expectedSecret = await deriveWebhookSecret(botToken);
		if (!isValidWebhookSecret(c.req.header(WEBHOOK_SECRET_HEADER), expectedSecret)) {
			console.warn('[WEBHOOK] Rejected request without a valid secret token');
			return c.json({ ok: false, error: 'unauthorized' }, 401);
		}

		let update: Update;
		try {
			update = await c.req.json();
		} catch (err) {
			console.error('[WEBHOOK] Failed to parse body:', err);
			return c.json({ ok: false, error: 'invalid body' }, 400);
		}

		try {
			await enqueueUpdate(update);
		} catch (err) {
			console.error(`[WEBHOOK] Failed to enqueue update ${update.update_id}:`, err);
			return c.json({ ok: false, error: 'enqueue failed' }, 500);
		}
		return c.json({ ok: true });
	});

	app.onError((err, c) => c.json({ message: err.message }, 500));

	return app;
}

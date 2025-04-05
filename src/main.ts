import { Bot, webhookCallback } from 'grammy';
import { Application } from 'oak';
import { oakCors } from 'oak/cors';
import { Environment } from '@/config/environment.ts';
import { TorrentHandler } from '@/handlers/TorrentHandler.ts';
import { WebhookService } from '@/services/WebhookService.ts';
import { HelpService } from '@/services/HelpService.ts';
import { RealDebridService } from '@/services/RealDebridService.ts';
import type { MyContext } from '@/types/grammy.d.ts';
import '@/prototypes/ContextExtensionPrototype.ts';

const env = Environment.getInstance();
const bot = new Bot<MyContext>(env.BOT_TOKEN);
const app = new Application();
const torrentHandler = new TorrentHandler();
const webhookService = WebhookService.getInstance();
const helpService = HelpService.getInstance();
const realDebridService = RealDebridService.getInstance();

const ALLOWED_USER_ID = env.ALLOWED_USER_ID;
const TINFOIL_USER_PASS = env.TINFOIL_USER_PASS;

function isAllowedUser(ctx: MyContext): boolean {
	return ctx.from?.id === ALLOWED_USER_ID;
}

bot.use(async (ctx, next) => {
	if (!isAllowedUser(ctx)) {
		await ctx.reply('Desculpe, você não tem permissão para usar este bot.');
		return;
	}
	await next();
});

app.use(oakCors());

app.use(async (ctx, next) => {
	try {
		if (ctx.request.url.pathname === '/') {
			ctx.response.status = 200;
			ctx.response.body = 'Real-Debrid Cache Bot funcionando!';
			webhookService.setWebhook();
			return;
		}
		await next();
	} catch (err) {
		ctx.response.status = 500;
		ctx.response.body = {
			message: err instanceof Error ? err.message : 'Unknown error occurred',
		};
	}
});

// Handlers
bot.command('start', (ctx) => helpService.sendWelcome(ctx));
bot.command('ajuda', (ctx) => helpService.sendHelp(ctx));

bot.command('updatetinfoil', async (ctx) => {
	try {
		const response = await fetch(
			`http://${TINFOIL_USER_PASS}@foil.lucasliet.com.br/update`,
		);
		if (response.ok) {
			await ctx.reply('✅ Atualização do Tinfoil concluída com sucesso!');
		} else {
			await ctx.reply('❌ Erro ao atualizar Tinfoil: ' + response.statusText);
		}
	} catch (error) {
		await ctx.reply(
			`❌ Erro ao atualizar Tinfoil: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
		);
	}
});

bot.command('download', async (ctx) => {
	const id = ctx.message?.text.split(' ')[1];
	if (!id) {
		await ctx.reply(
			'Por favor, forneça o ID do torrent. Exemplo: /download 12345',
		);
		return;
	}
	torrentHandler.handleDownload(ctx, id);
});

bot.command('status_torrent', async (ctx) => {
	try {
		const torrents = await realDebridService.listTorrents();
		const message = torrents.map((t) =>
			`**🆔 ID:** \`${t.id}\`\n**📂 Nome:** ${t.filename}\n**📊 Status:** ${t.status}\n**📈 Progresso:** ${t.progress}%\n──────────────\n[   🗑️ Deletar   ](tg://msg?text=/delete_torrent ${t.id}) [   ⬇️ Baixar   ](tg://msg?text=/download ${t.id})\n──────────────`
		).join('\n\n');
		ctx.replyInChunks(message || '❌ Nenhum torrent encontrado');
	} catch (error) {
		await ctx.reply(
			`❌ Erro ao listar torrents: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
		);
	}
});

bot.command('status_download', async (ctx) => {
	try {
		const downloads = await realDebridService.listDownloads();
		const message = downloads.map((d) => {
			let downloadInfo =
				`**🆔 ID:** \`${d.id}\`\n**📂 Nome:** ${d.filename}\n**💾 Tamanho:** ${
					(d.filesize / 1024 / 1024).toFixed(2)
				}MB\n──────────────\n`;

			downloadInfo +=
				`[   🗑️ Deletar   ](tg://msg?text=/delete_download ${d.id}) [   ⬇️ Baixar   ](${d.download})`;

			if (d.streamable === 1) {
				downloadInfo +=
					`\n──────────────\n[   🎥 Stream   ](tg://msg?text=/stream ${d.id})`;
			}

			downloadInfo += '\n──────────────';
			return downloadInfo;
		}).join('\n\n');
		ctx.replyInChunks(message || '❌ Nenhum download encontrado');
	} catch (error) {
		await ctx.reply(
			`❌ Erro ao listar downloads: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
		);
	}
});

bot.command('incomplete', async (ctx) => {
	try {
		const torrents = await realDebridService.listTorrents();
		const incompleteTorrents = torrents.filter((t) =>
			t.status !== 'downloaded'
		);
		const message = incompleteTorrents.map((t) =>
			`**🆔 ID:** \`${t.id}\`\n**📂 Nome:** ${t.filename}\n**📊 Status:** ${t.status}\n**📈 Progresso:** ${t.progress}%\n──────────────\n[   🗑️ Deletar   ](tg://msg?text=/delete_torrent ${t.id})\n──────────────`
		).join('\n\n');
		ctx.replyInChunks(message || '❌ Nenhum torrent incompleto encontrado');
	} catch (error) {
		await ctx.reply(
			`❌ Erro ao listar torrents: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
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
		ctx.reply(`Torrent ${id} deletado com sucesso!`);
	} catch (error) {
		await ctx.reply(
			`Erro ao deletar torrent: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
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
		ctx.reply(`Download ${id} deletado com sucesso!`);
	} catch (error) {
		await ctx.reply(
			`Erro ao deletar download: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
		);
	}
});

bot.command('stream', async (ctx) => {
	const id = ctx.message?.text.split(' ')[1];
	if (!id) {
		await ctx.reply(
			'Por favor, forneça o ID do arquivo. Exemplo: /stream 12345',
		);
		return;
	}
	torrentHandler.handleStream(ctx, id);
});

bot.on('message:document', async (ctx) => {
	if (!ctx.message?.document?.file_name?.endsWith('.torrent')) {
		await helpService.sendInvalidFileHelp(ctx);
		return;
	}
	torrentHandler.handleTorrentFile(ctx);
});

bot.on('message:text', (ctx) => {
	(async function handleTextMessage() {
		if (ctx.message.text.startsWith('magnet:')) {
			return torrentHandler.handleMagnetLink(ctx, ctx.message.text);
		}

		return torrentHandler.handleSearchText(ctx, ctx.message.text);
	})();
});

// Webhook setup e inicialização
if (Deno.env.get('DENO_DEPLOYMENT_ID')) {
	webhookService.setupCronJob();
	app.use(webhookCallback(bot, 'oak'));
	app.listen();
} else {
	bot.start();

	const cleanup = async () => {
		await bot.stop();

		await webhookService.setWebhook();
		console.log('Webhook configurado com sucesso. Encerrando...');
		Deno.exit();
	};

	Deno.addSignalListener('SIGINT', cleanup);
	Deno.addSignalListener('SIGTERM', cleanup);
}

import { Bot, webhookCallback } from "grammy";
import { Application } from "oak";
import { oakCors } from "oak/cors";
import { Environment } from "@/config/environment.ts";
import { WebhookService } from "@/services/WebhookService.ts";
import { CommandHandler } from "@/handlers/CommandHandler.ts";
import type { MyContext } from "@/types/grammy.d.ts";
import "../src/prototype/ContextExtensionPrototype.ts";

const env = Environment.getInstance();
const bot = new Bot<MyContext>(env.BOT_TOKEN);
const app = new Application();
const webhookService = WebhookService.getInstance();
const commandHandler = CommandHandler.getInstance();

// Middleware de autenticação
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== env.ALLOWED_USER_ID) {
    await ctx.reply("Desculpe, você não tem permissão para usar este bot.");
    return;
  }
  await next();
});

app.use(oakCors());

// Restaurar middleware do healthcheck
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

registerCommands(bot, commandHandler);

// Webhook setup e inicialização
if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
  webhookService.setupCronJob();
  app.use(webhookCallback(bot, 'oak'));
  app.listen();
} else {
  bot.start();
}

function registerCommands(bot: Bot<MyContext>, handler: CommandHandler) {
  // Comandos de ajuda
  bot.command("start", ctx => handler.handleStart(ctx));
  bot.command("ajuda", ctx => handler.handleHelp(ctx));
  
  // Comandos de gerenciamento
  bot.command("status_torrent", ctx => handler.handleStatusTorrent(ctx));
  bot.command("status_download", ctx => handler.handleStatusDownload(ctx));
  bot.command("incomplete", ctx => handler.handleIncomplete(ctx));
  
  // Comandos de ação
  bot.command("download", ctx => handler.handleDownload(ctx));
  bot.command("updatetinfoil", ctx => handler.handleUpdateTinfoil(ctx));
  bot.command("delete_torrent", ctx => handler.handleDeleteTorrent(ctx));
  bot.command("delete_download", ctx => handler.handleDeleteDownload(ctx));

  // Handlers de mensagem
  bot.on("message:document", ctx => handler.handleDocument(ctx));
  bot.on("message:text", ctx => handler.handleText(ctx));
}

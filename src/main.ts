import { Bot, webhookCallback } from "grammy";
import { Application } from "oak";
import { oakCors } from "oak/cors";
import { Environment } from "@/config/environment.ts";
import { TorrentHandler } from "@/handlers/TorrentHandler.ts";
import { WebhookService } from "@/services/WebhookService.ts";
import { HelpService } from "@/services/HelpService.ts";
import type { MyContext } from "@/types/grammy.d.ts";

const env = Environment.getInstance();
const bot = new Bot<MyContext>(env.BOT_TOKEN);
const app = new Application();
const torrentHandler = new TorrentHandler();
const webhookService = WebhookService.getInstance();
const helpService = HelpService.getInstance();

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
bot.command("start", (ctx) => helpService.sendWelcome(ctx));
bot.command("ajuda", (ctx) => helpService.sendHelp(ctx));

bot.on("message:document", async (ctx) => {
  if (!ctx.message?.document?.file_name?.endsWith(".torrent")) {
    await helpService.sendInvalidFileHelp(ctx);
    return;
  }
  return torrentHandler.handleTorrentFile(ctx);
});

bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("magnet:")) {
    return torrentHandler.handleMagnetLink(ctx, ctx.message.text);
  }
  await helpService.sendInvalidMessageHelp(ctx);
});

// Webhook setup e inicialização
if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
  webhookService.setupCronJob();
  app.use(webhookCallback(bot, 'oak'));
  app.listen();
} else {
  bot.start();
}

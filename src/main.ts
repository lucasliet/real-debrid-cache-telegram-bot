import { createBot } from '@/bot/createBot.ts';
import { loadConfig } from '@/config/environment.ts';
import { registerWebhook } from '@/telegram/webhook.ts';

/**
 * Local entrypoint: runs the bot in long-polling mode (which removes the webhook)
 * and restores the production webhook on exit. Production runs on Cloudflare Workers through `worker.ts`.
 */
async function startLocalBot(): Promise<void> {
	const config = loadConfig();
	const bot = await createBot(config);

	const shutdown = async () => {
		await bot.stop();
		await registerWebhook(config);
		Deno.exit();
	};
	Deno.addSignalListener('SIGINT', shutdown);
	Deno.addSignalListener('SIGTERM', shutdown);

	await bot.start({ onStart: (botInfo) => console.log(`[BOT] @${botInfo.username} running in long-polling mode`) });
}

await startLocalBot();

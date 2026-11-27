import process from 'node:process';
import { createBot } from '@/bot/createBot.ts';
import { loadConfig } from '@/config/environment.ts';
import { registerWebhook } from '@/telegram/webhook.ts';

/**
 * Local entrypoint (Node.js): runs the bot in long-polling mode, which removes the webhook,
 * and restores the production webhook on exit. Production runs on Cloudflare Workers through `worker.ts`.
 * There is no Workers AI binding here, so search works without the AI fallback.
 */
async function startLocalBot(): Promise<void> {
	const config = loadConfig(process.env);
	const bot = await createBot(config);

	const stop = () => void bot.stop();
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);

	try {
		// Resolves when the bot is stopped; rejects when polling fails for good (e.g. another instance took over).
		await bot.start({ onStart: (botInfo) => console.log(`[BOT] @${botInfo.username} running in long-polling mode`) });
	} finally {
		// Long polling removed the webhook; put it back however the run ended, or production stops receiving updates.
		await registerWebhook(config);
	}
}

await startLocalBot();

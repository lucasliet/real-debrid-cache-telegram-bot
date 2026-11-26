import { createBot } from '@/app.ts';
import { WebhookService } from '@/services/WebhookService.ts';

/**
 * Local entrypoint: runs the bot in long-polling mode and restores the production webhook on exit.
 * Production runs on Cloudflare Workers through `worker.ts`.
 */
async function startLocalBot(): Promise<void> {
	const bot = await createBot();
	bot.start();

	const cleanup = async () => {
		await bot.stop();
		await WebhookService.getInstance().setWebhook();
		console.log('Webhook configurado com sucesso. Encerrando...');
		Deno.exit();
	};

	Deno.addSignalListener('SIGINT', cleanup);
	Deno.addSignalListener('SIGTERM', cleanup);
}

await startLocalBot();

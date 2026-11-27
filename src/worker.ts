import type { Bot, Context } from 'grammy';
import type { Update } from 'grammy/types';
import type { DecisionModelRunner } from '@/ai/LibrarySearchAssistant.ts';
import { createBot } from '@/bot/createBot.ts';
import { loadConfig } from '@/config/environment.ts';
import { createWebhookApp } from '@/http/createWebhookApp.ts';
import { processQueuedUpdate } from '@/queue.ts';

let bot: Promise<Bot<Context>> | undefined;

/**
 * Create the bot once per isolate. A failed initialization (invalid configuration, Telegram unreachable)
 * is not cached, so the next batch retries it.
 * @param env - Worker bindings
 * @returns The initialized bot
 */
function loadBot(env: Env): Promise<Bot<Context>> {
	bot ??= Promise.resolve()
		.then(() => createBot(loadConfig(env), { ai: env.AI as unknown as DecisionModelRunner }))
		.catch((error) => {
			bot = undefined;
			throw error;
		});
	return bot;
}

/**
 * Cloudflare Workers entrypoint: the webhook enqueues updates and the queue consumer runs the bot,
 * since queue consumers can run for minutes while work left after an HTTP response is cancelled.
 */
export default {
	fetch(request, env, ctx) {
		const app = createWebhookApp({
			loadConfig: () => loadConfig(env),
			enqueueUpdate: async (update) => {
				await env.UPDATES_QUEUE.send(update);
			},
		});
		return app.fetch(request, env, ctx);
	},

	async queue(batch, env) {
		const initializedBot = await loadBot(env);
		for (const message of batch.messages) {
			await processQueuedUpdate(initializedBot, message);
		}
	},
} satisfies ExportedHandler<Env, Update>;

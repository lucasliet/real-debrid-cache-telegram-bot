import type { Bot, Context } from 'grammy';
import type { Update } from 'grammy/types';
import { createBot } from '@/bot/createBot.ts';
import { loadConfig } from '@/config/environment.ts';
import { createWebhookApp } from '@/http/createWebhookApp.ts';
import { processQueuedUpdate } from '@/queue.ts';
import { SingleValueCache } from '@/util/singleValueCache.ts';

const bots = new SingleValueCache<Bot<Context>>();

/**
 * Reuse the bot across invocations of the same isolate, but only while the configuration is the same:
 * an isolate can outlive a change of variables or secrets, and the bot captures them when it is created
 * (notably who is allowed to use it). A failed initialization is not cached, so the next batch retries it.
 * @param env - Worker bindings
 * @returns The initialized bot
 * @throws ConfigurationError when a required variable is missing or malformed
 */
function loadBot(env: Env): Promise<Bot<Context>> {
	const config = loadConfig(env);
	// The explicit call is what the compiler checks: a structural assignment of `env.AI` would accept any `run`.
	return bots.get(JSON.stringify(config), () => createBot(config, { ai: { run: (model, inputs) => env.AI.run(model, inputs) } }));
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

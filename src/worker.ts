import type { Bot, Context } from 'grammy';
import type { Update } from 'grammy/types';
import type { TextGenerationRunner } from '@/ai/LibrarySearchAssistant.ts';
import { createBot } from '@/bot/createBot.ts';
import { loadConfig } from '@/config/environment.ts';
import { createWebhookApp } from '@/http/createWebhookApp.ts';

let bot: Promise<Bot<Context>> | undefined;

/**
 * Create the bot once per isolate. A failed initialization (invalid configuration, Telegram unreachable)
 * is not cached, so the next batch retries it.
 * @param env - Worker bindings
 * @returns The initialized bot
 */
function loadBot(env: Env): Promise<Bot<Context>> {
	bot ??= Promise.resolve()
		.then(() => createBot(loadConfig(env), { ai: env.AI as unknown as TextGenerationRunner }))
		.catch((error) => {
			bot = undefined;
			throw error;
		});
	return bot;
}

/**
 * Handle one queued update and acknowledge it even on failure: a retry would add the torrent again
 * or repeat deletions, and handlers already report errors to the user.
 * @param initializedBot - Bot that processes the update
 * @param message - Queue message carrying the Telegram update
 */
async function processQueuedUpdate(initializedBot: Bot<Context>, message: Message<Update>): Promise<void> {
	try {
		await initializedBot.handleUpdate(message.body);
	} catch (error) {
		console.error(`[QUEUE] Failed to handle update ${message.body.update_id} (attempt ${message.attempts}):`, error);
	}
	message.ack();
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

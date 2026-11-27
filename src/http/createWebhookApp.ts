import type { Update } from 'grammy/types';
import { Hono } from 'hono';
import type { AppConfig } from '@/config/environment.ts';
import { registerWebhook } from '@/telegram/webhook.ts';
import { deriveWebhookSecret, isValidWebhookSecret, WEBHOOK_SECRET_HEADER } from '@/telegram/webhookSecret.ts';

export interface WebhookAppOptions {
	/** Persists the update for asynchronous processing (a Cloudflare Queue in production). */
	enqueueUpdate: (update: Update) => Promise<void>;
	/** Reads the configuration; called per request so a misconfiguration surfaces as a 500, not a crash at startup. */
	loadConfig: () => AppConfig;
	/** Registers the webhook on Telegram; replaceable in tests. */
	registerWebhook?: typeof registerWebhook;
}

/**
 * Build the HTTP app that receives Telegram webhook deliveries and hands them over for asynchronous processing.
 * - `GET /` (re)registers the webhook on Telegram, which is idempotent.
 * - `POST /webhook` rejects requests without the secret header derived from the bot token with 401, since
 *   `from.id` (used by the allowed-user check) is otherwise unauthenticated. A failed enqueue returns 500 so Telegram redelivers.
 * @returns Hono app
 */
export function createWebhookApp(options: WebhookAppOptions): Hono {
	const { enqueueUpdate, loadConfig: load, registerWebhook: register = registerWebhook } = options;
	const app = new Hono();

	app.use('*', async (c, next) => {
		const start = Date.now();
		await next();
		console.log(`[HTTP] ${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status} - ${Date.now() - start}ms`);
	});

	app.get('/', async (c) => {
		await register(load());
		return c.text('Real-Debrid Cache Bot funcionando!');
	});

	app.post('/webhook', async (c) => {
		const expectedSecret = await deriveWebhookSecret(load().botToken);
		if (!isValidWebhookSecret(c.req.header(WEBHOOK_SECRET_HEADER), expectedSecret)) {
			console.warn('[WEBHOOK] Rejected request without a valid secret token');
			return c.json({ ok: false, error: 'unauthorized' }, 401);
		}

		let update: Update;
		try {
			update = await c.req.json();
		} catch {
			return c.json({ ok: false, error: 'invalid body' }, 400);
		}

		try {
			await enqueueUpdate(update);
		} catch (error) {
			console.error(`[WEBHOOK] Failed to enqueue update ${update.update_id}:`, error);
			return c.json({ ok: false, error: 'enqueue failed' }, 500);
		}
		return c.json({ ok: true });
	});

	app.onError((error, c) => {
		// Only the message: API errors carry their request payload, which includes the webhook secret.
		console.error(`[HTTP] Unhandled error: ${error instanceof Error ? error.message : String(error)}`);
		return c.json({ ok: false, error: 'internal error' }, 500);
	});

	return app;
}

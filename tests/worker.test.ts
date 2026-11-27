import type { Update } from 'grammy/types';
import { assert, test } from 'vitest';
import { processQueuedUpdate } from '@/queue.ts';
import { deriveWebhookSecret, WEBHOOK_SECRET_HEADER } from '@/telegram/webhookSecret.ts';
import worker from '@/worker.ts';

const SECRETS = { BOT_TOKEN: '123:worker-test', RD_TOKEN: 'rd', ALLOWED_USER_ID: '1000' };

function setup(secrets: Record<string, string> = SECRETS) {
	const enqueued: Update[] = [];
	const env = {
		...secrets,
		UPDATES_QUEUE: {
			send: (update: Update) => {
				enqueued.push(update);
				return Promise.resolve();
			},
		},
	} as unknown as Env;
	const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
	const fetch = (request: Request) => worker.fetch(request as never, env, ctx);
	return { enqueued, fetch };
}

test('the worker enqueues authenticated webhook deliveries using the configuration from its bindings', async () => {
	const { enqueued, fetch } = setup();
	const headers = { [WEBHOOK_SECRET_HEADER]: await deriveWebhookSecret(SECRETS.BOT_TOKEN) };

	const response = await fetch(new Request('https://bot.example/webhook', { method: 'POST', headers, body: '{"update_id":9}' }));

	assert.strictEqual(response.status, 200);
	assert.deepStrictEqual(enqueued, [{ update_id: 9 }]);
});

test('the worker rejects unauthenticated deliveries', async () => {
	const { enqueued, fetch } = setup();
	const response = await fetch(new Request('https://bot.example/webhook', { method: 'POST', body: '{"update_id":9}' }));

	assert.strictEqual(response.status, 401);
	assert.deepStrictEqual(enqueued, []);
});

test('the worker answers 500 instead of crashing when a secret is missing', async () => {
	const { fetch } = setup({ RD_TOKEN: 'rd', ALLOWED_USER_ID: '1000' });
	const response = await fetch(new Request('https://bot.example/webhook', { method: 'POST', body: '{}' }));

	assert.strictEqual(response.status, 500);
});

function queued(update: Update) {
	const log: string[] = [];
	return { log, message: { body: update, attempts: 1, ack: () => void log.push('ack') } };
}

test('acknowledges a queued update before working on it, so a cut-off run is never redelivered', async () => {
	const { log, message } = queued({ update_id: 5 });

	await processQueuedUpdate({ handleUpdate: () => Promise.resolve(void log.push('handled')) }, message);

	assert.deepStrictEqual(log, ['ack', 'handled']);
});

test('swallows a failing update instead of letting the queue retry it', async () => {
	const { log, message } = queued({ update_id: 6 });

	await processQueuedUpdate({ handleUpdate: () => Promise.reject(new Error('boom')) }, message);

	assert.deepStrictEqual(log, ['ack']);
});

import type { Update } from 'grammy/types';
import { assert, test } from 'vitest';
import { processQueuedUpdate } from '@/queue.ts';
import { deriveWebhookSecret, WEBHOOK_SECRET_HEADER } from '@/telegram/webhookSecret.ts';
import { SingleValueCache } from '@/util/singleValueCache.ts';
import worker from '@/worker.ts';
import { rejects } from './support/rejects.ts';

const SECRETS = { BOT_TOKEN: '123:worker-test', RD_TOKEN: 'rd', ALLOWED_USER_ID: '1000' };

/** The webhook path never calls the AI binding; an empty object satisfies the generated `Env` type. */
const AI_STUB = {} as Ai;

/** Dead stub: the fetch handler only forwards the context, so no span API is exercised. */
const tracing: Tracing = {
	enterSpan: (_name, callback, ...args) => callback({} as Span, ...args),
	startActiveSpan: (_name, callback, ...args) => callback({} as Span, ...args),
	startSpan: () => ({}) as Span,
	getActiveSpan: () => undefined,
	withActiveSpan: (_span, callback, ...args) => callback(...args),
	// Ambient classes have no runtime value in vitest, so only plain objects back the dead stubs.
	Span: {} as typeof Span,
};

/** Dead stub: the webhook path never calls a loopback export binding. */
const EXPORTS_STUB: Cloudflare.Exports = { default: {} as Cloudflare.Exports['default'] };

function setup(secrets: Record<string, string> = SECRETS) {
	const enqueued: Update[] = [];
	const metrics = { backlogCount: 0, backlogBytes: 0 };
	const queue: Queue<Update> = {
		send: (update) => {
			enqueued.push(update);
			return Promise.resolve({ metadata: { metrics } });
		},
		sendBatch: () => Promise.resolve({ metadata: { metrics } }),
		metrics: () => Promise.resolve(metrics),
	};
	const env: Env = { SERVER_URL: 'https://real-debrid-cache-bot.lucasliet.workers.dev/webhook', UPDATES_QUEUE: queue, AI: AI_STUB };
	// Secrets are not bindings: they exist only at runtime and `loadConfig` reads them dynamically.
	Object.assign(env, secrets);
	const ctx: ExecutionContext = {
		waitUntil() {},
		passThroughOnException() {},
		props: {},
		exports: EXPORTS_STUB,
		mapVirtualHost: () => '',
		tracing,
		abort() {},
	};
	const fetch = (request: Request<unknown, IncomingRequestCfProperties<unknown>>) => worker.fetch(request, env, ctx);
	return { enqueued, fetch };
}

test('the worker enqueues authenticated webhook deliveries using the configuration from its bindings', async () => {
	const { enqueued, fetch } = setup();
	const headers = { [WEBHOOK_SECRET_HEADER]: await deriveWebhookSecret(SECRETS.BOT_TOKEN) };

	const request = new Request<unknown, IncomingRequestCfProperties<unknown>>('https://bot.example/webhook', {
		method: 'POST',
		headers,
		body: '{"update_id":9}',
	});
	const response = await fetch(request);

	assert.strictEqual(response.status, 200);
	assert.deepStrictEqual(enqueued, [{ update_id: 9 }]);
});

test('the worker rejects unauthenticated deliveries', async () => {
	const { enqueued, fetch } = setup();
	const request = new Request<unknown, IncomingRequestCfProperties<unknown>>('https://bot.example/webhook', { method: 'POST', body: '{"update_id":9}' });
	const response = await fetch(request);

	assert.strictEqual(response.status, 401);
	assert.deepStrictEqual(enqueued, []);
});

test('the worker answers 500 instead of crashing when a secret is missing', async () => {
	const { fetch } = setup({ RD_TOKEN: 'rd', ALLOWED_USER_ID: '1000' });
	const request = new Request<unknown, IncomingRequestCfProperties<unknown>>('https://bot.example/webhook', { method: 'POST', body: '{}' });
	const response = await fetch(request);

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

test('rebuilds the cached value when its key changes, so a bot never outlives its configuration', async () => {
	const cache = new SingleValueCache<string>();
	const built: string[] = [];
	const build = (name: string) => () => {
		built.push(name);
		return Promise.resolve(name);
	};

	assert.strictEqual(await cache.get('allowed=42', build('first')), 'first');
	assert.strictEqual(await cache.get('allowed=42', build('unused')), 'first');
	assert.strictEqual(await cache.get('allowed=84', build('second')), 'second');
	assert.deepStrictEqual(built, ['first', 'second']);
});

test('does not cache a failed build', async () => {
	const cache = new SingleValueCache<string>();

	await rejects(() => cache.get('k', () => Promise.reject(new Error('telegram unreachable'))), Error, 'telegram unreachable');
	assert.strictEqual(await cache.get('k', () => Promise.resolve('recovered')), 'recovered');
});

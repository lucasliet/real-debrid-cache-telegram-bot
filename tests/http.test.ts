import type { Update } from 'grammy/types';
import { assert, test } from 'vitest';
import { ConfigurationError, loadConfig } from '@/config/environment.ts';
import { createWebhookApp } from '@/http/createWebhookApp.ts';
import { deriveWebhookSecret, isValidWebhookSecret, WEBHOOK_SECRET_HEADER } from '@/telegram/webhookSecret.ts';
import { TEST_CONFIG } from './support/botHarness.ts';

function setup(enqueueUpdate: (update: Update) => Promise<void> = () => Promise.resolve()) {
	const registered: string[] = [];
	const app = createWebhookApp({
		enqueueUpdate,
		loadConfig: () => TEST_CONFIG,
		registerWebhook: (config) => {
			registered.push(config.webhookUrl);
			return Promise.resolve();
		},
	});
	return { app, registered };
}

async function delivery(body: string, secret?: string): Promise<Request> {
	const headers = new Headers({ 'Content-Type': 'application/json' });
	headers.set(WEBHOOK_SECRET_HEADER, secret ?? (await deriveWebhookSecret(TEST_CONFIG.botToken)));
	return new Request('https://bot.example/webhook', { method: 'POST', headers, body });
}

test('enqueues updates delivered with the derived secret', async () => {
	const enqueued: Update[] = [];
	const { app } = setup((update) => {
		enqueued.push(update);
		return Promise.resolve();
	});

	const response = await app.fetch(await delivery('{"update_id":7}'));

	assert.deepStrictEqual(response.status, 200);
	assert.deepStrictEqual(enqueued, [{ update_id: 7 }]);
});

test('rejects deliveries with a wrong or missing secret', async () => {
	const enqueued: Update[] = [];
	const { app } = setup((update) => {
		enqueued.push(update);
		return Promise.resolve();
	});

	const forged = await app.fetch(await delivery('{"update_id":7}', 'forged'));
	const anonymous = await app.fetch(new Request('https://bot.example/webhook', { method: 'POST', body: '{}' }));

	assert.deepStrictEqual([forged.status, anonymous.status], [401, 401]);
	assert.deepStrictEqual(enqueued, []);
});

test('answers 400 to bodies that are not JSON', async () => {
	const response = await setup().app.fetch(await delivery('not json'));
	assert.deepStrictEqual(response.status, 400);
});

test('answers 500 when the update cannot be enqueued, so Telegram redelivers it', async () => {
	const { app } = setup(() => Promise.reject(new Error('queue down')));
	const response = await app.fetch(await delivery('{"update_id":7}'));
	assert.deepStrictEqual(response.status, 500);
});

test('registers the webhook on GET /', async () => {
	const { app, registered } = setup();
	const response = await app.fetch(new Request('https://bot.example/'));

	assert.deepStrictEqual(response.status, 200);
	assert.deepStrictEqual(registered, ['https://bot.example/webhook']);
});

test('does not leak internal error details', async () => {
	const app = createWebhookApp({
		enqueueUpdate: () => Promise.resolve(),
		loadConfig: () => {
			throw new ConfigurationError('Missing required environment variable BOT_TOKEN');
		},
	});
	const response = await app.fetch(new Request('https://bot.example/'));

	assert.deepStrictEqual(response.status, 500);
	assert.deepStrictEqual(await response.json(), { ok: false, error: 'internal error' });
});

test('compares webhook secrets exactly', () => {
	assert.deepStrictEqual(isValidWebhookSecret('abc', 'abc'), true);
	assert.deepStrictEqual(isValidWebhookSecret('abd', 'abc'), false);
	assert.deepStrictEqual(isValidWebhookSecret('ab', 'abc'), false);
	assert.deepStrictEqual(isValidWebhookSecret(undefined, 'abc'), false);
});

test('loads the configuration with defaults for optional variables', () => {
	const config = loadConfig({ BOT_TOKEN: 'b', RD_TOKEN: 'r', ALLOWED_USER_ID: '42', AI: {}, UPDATES_QUEUE: {} });

	assert.deepStrictEqual(config.allowedUserId, 42);
	assert.deepStrictEqual(config.tinfoil.credentials, undefined);
	assert.deepStrictEqual(config.webhookUrl.endsWith('/webhook'), true);
});

test('refuses to start with missing or malformed required variables', () => {
	assert.throws(() => loadConfig({ BOT_TOKEN: 'b', ALLOWED_USER_ID: '42' }), ConfigurationError, 'RD_TOKEN');
	assert.throws(() => loadConfig({ BOT_TOKEN: 'b', RD_TOKEN: 'r', ALLOWED_USER_ID: 'abc' }), ConfigurationError, 'positive integer');
});

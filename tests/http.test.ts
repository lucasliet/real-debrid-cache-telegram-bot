import { assertEquals, assertThrows } from '@std/assert';
import type { Update } from 'grammy/types';
import { ConfigurationError, loadConfig } from '@/config/environment.ts';
import { createWebhookApp } from '@/http/createWebhookApp.ts';
import { deriveWebhookSecret, isValidWebhookSecret, WEBHOOK_SECRET_HEADER } from '@/telegram/webhookSecret.ts';
import { TEST_CONFIG } from './support/botHarness.ts';

function setup(enqueueUpdate: (update: Update) => Promise<void> = () => Promise.resolve()) {
	const registered: string[] = [];
	const app = createWebhookApp({
		enqueueUpdate,
		loadConfig: () => TEST_CONFIG,
		registerWebhook: (config) => (registered.push(config.webhookUrl), Promise.resolve()),
	});
	return { app, registered };
}

async function delivery(body: string, secret?: string): Promise<Request> {
	const headers = new Headers({ 'Content-Type': 'application/json' });
	headers.set(WEBHOOK_SECRET_HEADER, secret ?? await deriveWebhookSecret(TEST_CONFIG.botToken));
	return new Request('https://bot.example/webhook', { method: 'POST', headers, body });
}

Deno.test('enqueues updates delivered with the derived secret', async () => {
	const enqueued: Update[] = [];
	const { app } = setup((update) => (enqueued.push(update), Promise.resolve()));

	const response = await app.fetch(await delivery('{"update_id":7}'));

	assertEquals(response.status, 200);
	assertEquals(enqueued, [{ update_id: 7 }]);
});

Deno.test('rejects deliveries with a wrong or missing secret', async () => {
	const enqueued: Update[] = [];
	const { app } = setup((update) => (enqueued.push(update), Promise.resolve()));

	const forged = await app.fetch(await delivery('{"update_id":7}', 'forged'));
	const anonymous = await app.fetch(new Request('https://bot.example/webhook', { method: 'POST', body: '{}' }));

	assertEquals([forged.status, anonymous.status], [401, 401]);
	assertEquals(enqueued, []);
});

Deno.test('answers 400 to bodies that are not JSON', async () => {
	const response = await setup().app.fetch(await delivery('not json'));
	assertEquals(response.status, 400);
});

Deno.test('answers 500 when the update cannot be enqueued, so Telegram redelivers it', async () => {
	const { app } = setup(() => Promise.reject(new Error('queue down')));
	const response = await app.fetch(await delivery('{"update_id":7}'));
	assertEquals(response.status, 500);
});

Deno.test('registers the webhook on GET /', async () => {
	const { app, registered } = setup();
	const response = await app.fetch(new Request('https://bot.example/'));

	assertEquals(response.status, 200);
	assertEquals(registered, ['https://bot.example/webhook']);
});

Deno.test('does not leak internal error details', async () => {
	const app = createWebhookApp({
		enqueueUpdate: () => Promise.resolve(),
		loadConfig: () => {
			throw new ConfigurationError('Missing required environment variable BOT_TOKEN');
		},
	});
	const response = await app.fetch(new Request('https://bot.example/'));

	assertEquals(response.status, 500);
	assertEquals(await response.json(), { ok: false, error: 'internal error' });
});

Deno.test('compares webhook secrets exactly', () => {
	assertEquals(isValidWebhookSecret('abc', 'abc'), true);
	assertEquals(isValidWebhookSecret('abd', 'abc'), false);
	assertEquals(isValidWebhookSecret('ab', 'abc'), false);
	assertEquals(isValidWebhookSecret(undefined, 'abc'), false);
});

Deno.test('loads the configuration with defaults for optional variables', () => {
	const config = loadConfig({ BOT_TOKEN: 'b', RD_TOKEN: 'r', ALLOWED_USER_ID: '42' });

	assertEquals(config.allowedUserId, 42);
	assertEquals(config.tinfoil.credentials, undefined);
	assertEquals(config.webhookUrl.endsWith('/webhook'), true);
});

Deno.test('refuses to start with missing or malformed required variables', () => {
	assertThrows(() => loadConfig({ BOT_TOKEN: 'b', ALLOWED_USER_ID: '42' }), ConfigurationError, 'RD_TOKEN');
	assertThrows(() => loadConfig({ BOT_TOKEN: 'b', RD_TOKEN: 'r', ALLOWED_USER_ID: 'abc' }), ConfigurationError, 'positive integer');
});

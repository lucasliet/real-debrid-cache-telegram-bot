import { assert, test } from 'vitest';
import { RealDebridClient } from '@/realdebrid/RealDebridClient.ts';
import { RealDebridError } from '@/realdebrid/RealDebridError.ts';
import { FakeRealDebrid } from './support/fakeRealDebrid.ts';
import { rejects } from './support/rejects.ts';

function clientFor(fetchImpl: typeof fetch, sleeps: number[] = []) {
	return new RealDebridClient({
		token: 'secret',
		fetch: fetchImpl,
		minIntervalMs: 0,
		sleep: (ms) => {
			sleeps.push(ms);
			return Promise.resolve();
		},
	});
}

test('sends the bearer token and form-encodes POST parameters', async () => {
	const api = new FakeRealDebrid();
	await clientFor(api.fetch).addMagnet('magnet:?xt=urn:btih:abc&dn=a b');

	const [request] = api.requests;
	assert.deepStrictEqual(request.headers.get('Authorization'), 'Bearer secret');
	assert.deepStrictEqual(request.headers.get('Content-Type'), 'application/x-www-form-urlencoded;charset=UTF-8');
	assert.deepStrictEqual(new URLSearchParams(request.body).get('magnet'), 'magnet:?xt=urn:btih:abc&dn=a b');
});

test('uploads torrent files as a raw PUT body', async () => {
	const api = new FakeRealDebrid();
	const created = await clientFor(api.fetch).addTorrent(new TextEncoder().encode('d8:announce0:e'));

	assert.deepStrictEqual(created.id, 'T1');
	assert.deepStrictEqual(api.requests[0].method, 'PUT');
	assert.deepStrictEqual(api.requests[0].headers.get('Content-Type'), 'application/x-bittorrent');
	assert.deepStrictEqual(api.requests[0].body, 'd8:announce0:e');
});

test('treats the 204 of an empty listing as an empty page', async () => {
	const page = await clientFor(new FakeRealDebrid().fetch).listTorrents(1, 50);
	assert.deepStrictEqual(page, { items: [], total: 0 });
});

test('reports the grand total of a truncated page from X-Total-Count', async () => {
	const api = new FakeRealDebrid();
	for (let index = 0; index < 5; index++) api.seedTorrent({ id: `S${index}`, filename: `seed ${index}` });

	const page = await clientFor(api.fetch).listTorrents(1, 2);
	assert.deepStrictEqual(page.items.length, 2);
	assert.deepStrictEqual(page.total, 5);
});

test('walks every page when listing all torrents', async () => {
	const api = new FakeRealDebrid();
	for (let index = 0; index < 2300; index++) api.seedTorrent({ id: `S${index}`, filename: `seed ${index}` });

	const torrents = await clientFor(api.fetch).listAllTorrents();
	assert.deepStrictEqual(torrents.length, 2300);
	assert.deepStrictEqual(
		api.requestsTo('GET', '/torrents').map((request) => request.query.get('page')),
		['1', '2', '3'],
	);
});

test('keeps walking full pages when the API does not report a total', async () => {
	const api = new FakeRealDebrid();
	api.reportsTotal = false;
	for (let index = 0; index < 2300; index++) api.seedTorrent({ id: `S${index}`, filename: `seed ${index}` });

	assert.strictEqual((await clientFor(api.fetch).listAllTorrents()).length, 2300);
});

test('maps API failures to RealDebridError with a translated message', async () => {
	const error = await rejects(() => clientFor(new FakeRealDebrid().fetch).deleteTorrent('missing'), RealDebridError);
	assert.deepStrictEqual([error.status, error.code, error.message], [404, 7, 'Recurso não encontrado']);
});

test('survives error responses without a JSON body', async () => {
	const error = await rejects(() => clientFor(() => Promise.resolve(new Response('<html>', { status: 502 }))).getUser(), RealDebridError);
	assert.deepStrictEqual(error.message, 'Real-Debrid respondeu HTTP 502');
});

test('retries rate-limited requests with exponential backoff', async () => {
	const sleeps: number[] = [];
	let calls = 0;
	const flaky: typeof fetch = () =>
		Promise.resolve(++calls <= 2 ? Response.json({ error: 'too_many_requests', error_code: 34 }, { status: 429 }) : Response.json({ nb: 0, limit: 25 }));

	assert.deepStrictEqual(await clientFor(flaky, sleeps).getActiveTorrentCount(), { nb: 0, limit: 25 });
	assert.deepStrictEqual(sleeps, [2000, 4000]);
});

test('caps the wait asked by Retry-After', async () => {
	const sleeps: number[] = [];
	let calls = 0;
	const limited: typeof fetch = () =>
		Promise.resolve(
			++calls === 1 ? Response.json({ error_code: 34 }, { status: 429, headers: { 'Retry-After': '600' } }) : Response.json({ nb: 0, limit: 25 }),
		);

	await clientFor(limited, sleeps).getActiveTorrentCount();

	assert.deepStrictEqual(sleeps, [30_000]);
});

test('gives up after the configured rate-limit retries', async () => {
	let calls = 0;
	const limited: typeof fetch = () => {
		calls++;
		return Promise.resolve(Response.json({ error: 'too_many_requests', error_code: 34 }, { status: 429 }));
	};

	const error = await rejects(() => clientFor(limited).getUser(), RealDebridError);
	assert.deepStrictEqual(error.isRateLimited, true);
	assert.deepStrictEqual(calls, 4);
});

test('spaces requests to stay under the rate limit', async () => {
	const sleeps: number[] = [];
	let clock = 0;
	const client = new RealDebridClient({
		token: 't',
		fetch: new FakeRealDebrid().fetch,
		minIntervalMs: 250,
		now: () => clock,
		sleep: (ms) => {
			sleeps.push(ms);
			clock += ms;
			return Promise.resolve();
		},
	});

	await client.getUser();
	await client.getUser();
	clock += 1000;
	await client.getUser();
	assert.deepStrictEqual(sleeps, [250]);
});

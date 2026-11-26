import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert';
import { RealDebridClient } from '@/realdebrid/RealDebridClient.ts';
import { RealDebridError } from '@/realdebrid/RealDebridError.ts';
import { FakeRealDebrid } from './support/fakeRealDebrid.ts';

function clientFor(fetchImpl: typeof fetch, sleeps: number[] = []) {
	return new RealDebridClient({ token: 'secret', fetch: fetchImpl, minIntervalMs: 0, sleep: (ms) => (sleeps.push(ms), Promise.resolve()) });
}

Deno.test('sends the bearer token and form-encodes POST parameters', async () => {
	const api = new FakeRealDebrid();
	await clientFor(api.fetch).addMagnet('magnet:?xt=urn:btih:abc&dn=a b');

	const [request] = api.requests;
	assertEquals(request.headers.get('Authorization'), 'Bearer secret');
	assertEquals(request.headers.get('Content-Type'), 'application/x-www-form-urlencoded;charset=UTF-8');
	assertEquals(new URLSearchParams(request.body).get('magnet'), 'magnet:?xt=urn:btih:abc&dn=a b');
});

Deno.test('uploads torrent files as a raw PUT body', async () => {
	const api = new FakeRealDebrid();
	const created = await clientFor(api.fetch).addTorrent(new TextEncoder().encode('d8:announce0:e').buffer);

	assertEquals(created.id, 'T1');
	assertEquals(api.requests[0].method, 'PUT');
	assertEquals(api.requests[0].headers.get('Content-Type'), 'application/x-bittorrent');
	assertEquals(api.requests[0].body, 'd8:announce0:e');
});

Deno.test('treats the 204 of an empty listing as an empty page', async () => {
	const page = await clientFor(new FakeRealDebrid().fetch).listTorrents(1, 50);
	assertEquals(page, { items: [], total: 0 });
});

Deno.test('reports the grand total of a truncated page from X-Total-Count', async () => {
	const api = new FakeRealDebrid();
	for (let index = 0; index < 5; index++) api.seedTorrent({ id: `S${index}`, filename: `seed ${index}` });

	const page = await clientFor(api.fetch).listTorrents(1, 2);
	assertEquals(page.items.length, 2);
	assertEquals(page.total, 5);
});

Deno.test('walks every page when listing all torrents', async () => {
	const api = new FakeRealDebrid();
	for (let index = 0; index < 2300; index++) api.seedTorrent({ id: `S${index}`, filename: `seed ${index}` });

	const torrents = await clientFor(api.fetch).listAllTorrents();
	assertEquals(torrents.length, 2300);
	assertEquals(api.requestsTo('GET', '/torrents').map((request) => request.query.get('page')), ['1', '2', '3']);
});

Deno.test('maps API failures to RealDebridError with a translated message', async () => {
	const error = await assertRejects(() => clientFor(new FakeRealDebrid().fetch).deleteTorrent('missing'), RealDebridError);
	assertEquals([error.status, error.code, error.message], [404, 7, 'Recurso não encontrado']);
});

Deno.test('survives error responses without a JSON body', async () => {
	const error = await assertRejects(() => clientFor(() => Promise.resolve(new Response('<html>', { status: 502 }))).getUser());
	assertInstanceOf(error, RealDebridError);
	assertEquals(error.message, 'Real-Debrid respondeu HTTP 502');
});

Deno.test('retries rate-limited requests with exponential backoff', async () => {
	const sleeps: number[] = [];
	let calls = 0;
	const flaky: typeof fetch = () =>
		Promise.resolve(++calls <= 2 ? Response.json({ error: 'too_many_requests', error_code: 34 }, { status: 429 }) : Response.json({ nb: 0, limit: 25 }));

	assertEquals(await clientFor(flaky, sleeps).getActiveTorrentCount(), { nb: 0, limit: 25 });
	assertEquals(sleeps, [2000, 4000]);
});

Deno.test('gives up after the configured rate-limit retries', async () => {
	let calls = 0;
	const limited: typeof fetch = () => (calls++, Promise.resolve(Response.json({ error: 'too_many_requests', error_code: 34 }, { status: 429 })));

	const error = await assertRejects(() => clientFor(limited).getUser(), RealDebridError);
	assertEquals(error.isRateLimited, true);
	assertEquals(calls, 4);
});

Deno.test('spaces requests to stay under the rate limit', async () => {
	const sleeps: number[] = [];
	let clock = 0;
	const client = new RealDebridClient({
		token: 't',
		fetch: new FakeRealDebrid().fetch,
		minIntervalMs: 250,
		now: () => clock,
		sleep: (ms) => (sleeps.push(ms), clock += ms, Promise.resolve()),
	});

	await client.getUser();
	await client.getUser();
	clock += 1000;
	await client.getUser();
	assertEquals(sleeps, [250]);
});

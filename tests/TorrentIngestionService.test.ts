import { assertEquals, assertRejects } from '@std/assert';
import { RealDebridClient } from '@/realdebrid/RealDebridClient.ts';
import { type IngestionEvent, TorrentIngestionService } from '@/services/TorrentIngestionService.ts';
import { UserFacingError } from '@/util/UserFacingError.ts';
import { FakeRealDebrid, torrentFile } from './support/fakeRealDebrid.ts';

const MAGNET = { kind: 'magnet', magnet: 'magnet:?xt=urn:btih:abc' } as const;
const noSleep = () => Promise.resolve();

function setup(options: { maxPollAttempts?: number } = {}) {
	const api = new FakeRealDebrid();
	const client = new RealDebridClient({ token: 't', fetch: api.fetch, minIntervalMs: 0, sleep: noSleep });
	return { api, service: new TorrentIngestionService(client, { sleep: noSleep, ...options }) };
}

const selectedPaths = (api: FakeRealDebrid) =>
	[...api.torrents.values()].map((torrent) => torrent.files.filter((file) => file.selected).map((file) => file.path));

Deno.test('adds a ROM-only torrent once per file, each copy with a single file selected', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/Zelda.nsp'), torrentFile(2, '/Mario.XCI'), torrentFile(3, '/dlc/Kirby.nsz')];
	const events: IngestionEvent[] = [];

	const result = await service.ingest(MAGNET, (event) => (events.push(event), Promise.resolve()));

	assertEquals(result.strategy, 'individual');
	assertEquals(selectedPaths(api), [['/Zelda.nsp'], ['/Mario.XCI'], ['/dlc/Kirby.nsz']]);
	assertEquals(events.map((event) => `${event.type} ${event.position}/${event.total}`), [
		'file-started 1/3',
		'file-added 1/3',
		'file-started 2/3',
		'file-added 2/3',
		'file-started 3/3',
		'file-added 3/3',
	]);
});

Deno.test('adds any other torrent once, with every file selected', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/Movie.mkv'), torrentFile(2, '/Zelda.nsp')];

	const result = await service.ingest({ kind: 'file', bytes: new ArrayBuffer(8) });

	assertEquals(result.strategy, 'bundle');
	assertEquals(selectedPaths(api), [['/Movie.mkv', '/Zelda.nsp']]);
	assertEquals(api.requestsTo('POST', '/torrents/selectFiles')[0].body, 'files=all');
});

Deno.test('waits for the magnet conversion before reading the file list', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/Movie.mkv')];
	api.conversionPolls = 3;

	const result = await service.ingest(MAGNET);

	assertEquals(result.strategy, 'bundle');
	assertEquals(api.requestsTo('GET', '/torrents/info').length, 3 + 1 + 1);
});

Deno.test('discards the torrent when its files never show up', async () => {
	const { api, service } = setup({ maxPollAttempts: 2 });
	api.conversionPolls = 99;

	await assertRejects(() => service.ingest(MAGNET), UserFacingError, 'lista de arquivos');
	assertEquals(api.torrents.size, 0);
});

Deno.test('discards the torrent when Real-Debrid rejects it', async () => {
	const { api, service } = setup();
	api.statusOfNextTorrents = 'magnet_error';

	await assertRejects(() => service.ingest(MAGNET), UserFacingError, 'magnet_error');
	assertEquals(api.torrents.size, 0);
});

Deno.test('keeps going when one file fails and leaves no orphan torrent behind', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/A.nsp'), torrentFile(2, '/B.nsp'), torrentFile(3, '/C.nsp')];
	api.refusesSelection.add('T2');

	const result = await service.ingest(MAGNET);

	if (result.strategy !== 'individual') throw new Error('expected the per-file strategy');
	assertEquals(result.added.map((file) => file.path), ['/A.nsp', '/C.nsp']);
	assertEquals(result.failed.map(({ file }) => file.path), ['/B.nsp']);
	assertEquals([...api.torrents.keys()], ['T1', 'T3']);
});

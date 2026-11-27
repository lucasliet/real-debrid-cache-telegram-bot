import { assert, test } from 'vitest';
import { RealDebridClient } from '@/realdebrid/RealDebridClient.ts';
import { RealDebridError } from '@/realdebrid/RealDebridError.ts';
import { type IngestionEvent, PendingTorrentError, TorrentIngestionService } from '@/services/TorrentIngestionService.ts';
import { UserFacingError } from '@/util/UserFacingError.ts';
import { FakeRealDebrid, torrentFile } from './support/fakeRealDebrid.ts';
import { rejects } from './support/rejects.ts';

const MAGNET = { kind: 'magnet', magnet: 'magnet:?xt=urn:btih:abc' } as const;
const noSleep = () => Promise.resolve();

function setup(options: { maxPollAttempts?: number } = {}) {
	const api = new FakeRealDebrid();
	const client = new RealDebridClient({ token: 't', fetch: api.fetch, minIntervalMs: 0, sleep: noSleep });
	return { api, service: new TorrentIngestionService(client, { sleep: noSleep, ...options }) };
}

const selectedPaths = (api: FakeRealDebrid) =>
	[...api.torrents.values()].map((torrent) => torrent.files.filter((file) => file.selected).map((file) => file.path));

test('adds a ROM-only torrent once per file, each copy with a single file selected', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/Zelda.nsp'), torrentFile(2, '/Mario.XCI'), torrentFile(3, '/dlc/Kirby.nsz')];
	const events: IngestionEvent[] = [];

	const result = await service.ingest(MAGNET, (event) => {
		events.push(event);
		return Promise.resolve();
	});

	assert.deepStrictEqual(result.strategy, 'individual');
	assert.deepStrictEqual(selectedPaths(api), [['/Zelda.nsp'], ['/Mario.XCI'], ['/dlc/Kirby.nsz']]);
	assert.deepStrictEqual(
		events.map((event) => `${event.type} ${event.position}/${event.total}`),
		['file-started 1/3', 'file-added 1/3', 'file-started 2/3', 'file-added 2/3', 'file-started 3/3', 'file-added 3/3'],
	);
});

test('adds any other torrent once, with every file selected', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/Movie.mkv'), torrentFile(2, '/Zelda.nsp')];

	const result = await service.ingest({ kind: 'file', bytes: new ArrayBuffer(8) });

	assert.deepStrictEqual(result.strategy, 'bundle');
	assert.deepStrictEqual(selectedPaths(api), [['/Movie.mkv', '/Zelda.nsp']]);
	assert.deepStrictEqual(api.requestsTo('POST', '/torrents/selectFiles')[0].body, 'files=all');
});

test('waits for the magnet conversion before reading the file list', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/Movie.mkv')];
	api.conversionPolls = 3;

	const result = await service.ingest(MAGNET);

	assert.deepStrictEqual(result.strategy, 'bundle');
	assert.deepStrictEqual(api.requestsTo('GET', '/torrents/info').length, 3 + 1 + 1);
});

test('keeps a torrent that is still converting, so a slow magnet is not thrown away', async () => {
	const { api, service } = setup({ maxPollAttempts: 2 });
	api.conversionPolls = 99;

	const error = await rejects(() => service.ingest(MAGNET), PendingTorrentError, '/delete_torrent T1');
	assert.strictEqual(error.torrentId, 'T1');
	assert.deepStrictEqual([...api.torrents.keys()], ['T1']);
});

test('does not claim a discarded extra copy is still in the account', async () => {
	const { api, service } = setup({ maxPollAttempts: 2 });
	api.filesOfNextTorrents = [torrentFile(1, '/A.nsp'), torrentFile(2, '/B.nsp')];

	const result = await service.ingest(MAGNET, (event) => {
		// Only the copies added after the first file get stuck converting.
		if (event.type === 'file-added') api.conversionPolls = 99;
		return Promise.resolve();
	});

	if (result.strategy !== 'individual') throw new Error('expected the per-file strategy');
	assert.deepStrictEqual([...api.torrents.keys()], ['T1']);
	const message = (result.failed[0].error as Error).message;
	assert.include(message, 'reenvie o torrent');
	assert.notInclude(message, 'continua na sua conta');
});

test('discards a bundle whose file selection is refused', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/Movie.mkv')];
	api.refusesSelection.add('T1');

	await rejects(() => service.ingest(MAGNET), RealDebridError);
	assert.deepStrictEqual(api.torrents.size, 0);
});

test('reports a bundle as added even when it cannot be read back after the selection', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/Movie.mkv')];
	api.infoFailsAfterSelection = true;

	const result = await service.ingest(MAGNET);

	assert.strictEqual(result.strategy, 'bundle');
	assert.deepStrictEqual(selectedPaths(api), [['/Movie.mkv']]);
});

test('discards the torrent when Real-Debrid rejects it', async () => {
	const { api, service } = setup();
	api.statusOfNextTorrents = 'magnet_error';

	await rejects(() => service.ingest(MAGNET), UserFacingError, 'magnet_error');
	assert.deepStrictEqual(api.torrents.size, 0);
});

test('keeps going when one file fails and leaves no orphan torrent behind', async () => {
	const { api, service } = setup();
	api.filesOfNextTorrents = [torrentFile(1, '/A.nsp'), torrentFile(2, '/B.nsp'), torrentFile(3, '/C.nsp')];
	api.refusesSelection.add('T2');

	const result = await service.ingest(MAGNET);

	if (result.strategy !== 'individual') throw new Error('expected the per-file strategy');
	assert.deepStrictEqual(
		result.added.map((file) => file.path),
		['/A.nsp', '/C.nsp'],
	);
	assert.deepStrictEqual(
		result.failed.map(({ file }) => file.path),
		['/B.nsp'],
	);
	assert.deepStrictEqual([...api.torrents.keys()], ['T1', 'T3']);
});

test('stops a per-file ingestion when its time budget runs out and reports what was left', async () => {
	const api = new FakeRealDebrid();
	api.filesOfNextTorrents = [torrentFile(1, '/A.nsp'), torrentFile(2, '/B.nsp'), torrentFile(3, '/C.nsp'), torrentFile(4, '/D.nsp')];
	let clock = 0;
	const client = new RealDebridClient({ token: 't', fetch: api.fetch, minIntervalMs: 0, sleep: noSleep });
	const service = new TorrentIngestionService(client, { sleep: noSleep, now: () => clock, timeBudgetMs: 10 * 60_000 });

	const result = await service.ingest(MAGNET, (event) => {
		// Each file added costs six minutes, so the budget is spent after the second one.
		if (event.type === 'file-added') clock += 6 * 60_000;
		return Promise.resolve();
	});

	if (result.strategy !== 'individual') throw new Error('expected the per-file strategy');
	assert.deepStrictEqual(
		result.added.map((file) => file.path),
		['/A.nsp', '/B.nsp'],
	);
	assert.deepStrictEqual(
		result.skipped.map((file) => file.path),
		['/C.nsp', '/D.nsp'],
	);
	assert.deepStrictEqual([...api.torrents.keys()], ['T1', 'T2']);
});

test('stops waiting for a slow copy when the budget runs out, without leaving it behind', async () => {
	const api = new FakeRealDebrid();
	api.filesOfNextTorrents = [torrentFile(1, '/A.nsp'), torrentFile(2, '/B.nsp')];
	let clock = 0;
	const client = new RealDebridClient({ token: 't', fetch: api.fetch, minIntervalMs: 0, sleep: noSleep });
	const service = new TorrentIngestionService(client, {
		now: () => clock,
		timeBudgetMs: 60_000,
		// Every poll of the stuck copy costs 25 seconds: the budget, not the 30 attempts, must end the wait.
		sleep: () => {
			clock += 25_000;
			return Promise.resolve();
		},
	});

	const result = await service.ingest(MAGNET, (event) => {
		if (event.type === 'file-added') api.conversionPolls = 99;
		return Promise.resolve();
	});

	if (result.strategy !== 'individual') throw new Error('expected the per-file strategy');
	assert.deepStrictEqual(
		result.failed.map(({ file }) => file.path),
		['/B.nsp'],
	);
	assert.deepStrictEqual([...api.torrents.keys()], ['T1']);
	assert.isBelow(api.requestsTo('GET', '/torrents/info/T2').length, 6);
});

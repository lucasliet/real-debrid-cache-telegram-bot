import { assert, test } from 'vitest';
import { packBlocks } from '@/bot/messaging.ts';
import { escapeHtml, formatBytes } from '@/bot/views/html.ts';
import { RealDebridClient } from '@/realdebrid/RealDebridClient.ts';
import { LibraryService, normalizeForSearch } from '@/services/LibraryService.ts';
import { fileExtension, fileName } from '@/util/files.ts';
import { FakeRealDebrid } from './support/fakeRealDebrid.ts';

test('packs blocks into as few messages as fit the limit', () => {
	assert.deepStrictEqual(packBlocks(['aaaa', 'bbbb', 'cccc'], 10), ['aaaa\n\nbbbb', 'cccc']);
	assert.deepStrictEqual(packBlocks([], 10), []);
});

test('splits an oversized block between its lines, slicing only a line longer than the limit', () => {
	assert.deepStrictEqual(packBlocks(['<b>aa</b>\n<b>bb</b>\n<b>cc</b>'], 20), ['<b>aa</b>\n<b>bb</b>', '<b>cc</b>']);
	assert.deepStrictEqual(packBlocks(['a'.repeat(25), 'b'], 10), ['a'.repeat(10), 'a'.repeat(10), 'aaaaa\n\nb']);
});

test('escapes HTML', () => {
	assert.deepStrictEqual(escapeHtml('<a href="x">T&J</a>'), '&lt;a href="x"&gt;T&amp;J&lt;/a&gt;');
});

test('formats sizes with the most readable unit', () => {
	assert.deepStrictEqual([formatBytes(0), formatBytes(512), formatBytes(1536), formatBytes(5 * 1024 ** 3)], ['desconhecido', '512 B', '1.50 KB', '5.00 GB']);
});

test('normalizes names for accent- and separator-insensitive search', () => {
	assert.deepStrictEqual(normalizeForSearch('  Pokémon.Scarlet_-_Violet  '), 'pokemon scarlet violet');
});

test('extracts file names and extensions from torrent paths', () => {
	assert.deepStrictEqual([fileName('/dir/Game.v1.NSP'), fileExtension('/dir/Game.v1.NSP')], ['Game.v1.NSP', 'nsp']);
	assert.deepStrictEqual([fileExtension('/dir.d/README'), fileExtension('/.hidden')], ['', '']);
});

test('stops a bulk operation when its time budget runs out and says so', async () => {
	const api = new FakeRealDebrid();
	for (let index = 0; index < 5; index++) api.seedTorrent({ id: `Z${index}`, filename: `Zelda ${index}` });
	let clock = 0;
	const client = new RealDebridClient({ token: 't', fetch: api.fetch, minIntervalMs: 0, sleep: () => Promise.resolve() });
	// Every look at the clock costs a minute, so the budget allows three torrents.
	const library = new LibraryService(client, { now: () => clock++ * 60_000, bulkTimeBudgetMs: 4 * 60_000 });

	const result = await library.deleteTorrentsByName('zelda');

	assert.deepStrictEqual([result.interrupted, result.deleted.length, api.torrents.size], [true, 3, 2]);
});

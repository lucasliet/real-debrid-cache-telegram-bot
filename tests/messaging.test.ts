import { assert, test } from 'vitest';
import { packBlocks } from '@/bot/messaging.ts';
import { commandLink, escapeHtml, formatBytes } from '@/bot/views/html.ts';
import { normalizeForSearch } from '@/services/LibraryService.ts';
import { fileExtension, fileName } from '@/util/files.ts';

test('packs blocks into as few messages as fit the limit', () => {
	assert.deepStrictEqual(packBlocks(['aaaa', 'bbbb', 'cccc'], 10), ['aaaa\n\nbbbb', 'cccc']);
	assert.deepStrictEqual(packBlocks([], 10), []);
});

test('hard-splits only blocks longer than the limit', () => {
	assert.deepStrictEqual(packBlocks(['a'.repeat(25), 'b'], 10), ['a'.repeat(10), 'a'.repeat(10), 'aaaaa\n\nb']);
});

test('escapes HTML and encodes command links', () => {
	assert.deepStrictEqual(escapeHtml('<a href="x">T&J</a>'), '&lt;a href="x"&gt;T&amp;J&lt;/a&gt;');
	assert.deepStrictEqual(commandLink('Go', '/stream A&B'), '<a href="tg://msg?text=%2Fstream%20A%26B">   Go   </a>');
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

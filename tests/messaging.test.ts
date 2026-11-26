import { assertEquals } from '@std/assert';
import { packBlocks } from '@/bot/messaging.ts';
import { commandLink, escapeHtml, formatBytes } from '@/bot/views/html.ts';
import { normalizeForSearch } from '@/services/LibraryService.ts';
import { fileExtension, fileName } from '@/util/files.ts';

Deno.test('packs blocks into as few messages as fit the limit', () => {
	assertEquals(packBlocks(['aaaa', 'bbbb', 'cccc'], 10), ['aaaa\n\nbbbb', 'cccc']);
	assertEquals(packBlocks([], 10), []);
});

Deno.test('hard-splits only blocks longer than the limit', () => {
	assertEquals(packBlocks(['a'.repeat(25), 'b'], 10), ['a'.repeat(10), 'a'.repeat(10), 'aaaaa\n\nb']);
});

Deno.test('escapes HTML and encodes command links', () => {
	assertEquals(escapeHtml('<a href="x">T&J</a>'), '&lt;a href="x"&gt;T&amp;J&lt;/a&gt;');
	assertEquals(commandLink('Go', '/stream A&B'), '<a href="tg://msg?text=%2Fstream%20A%26B">   Go   </a>');
});

Deno.test('formats sizes with the most readable unit', () => {
	assertEquals([formatBytes(0), formatBytes(512), formatBytes(1536), formatBytes(5 * 1024 ** 3)], ['desconhecido', '512 B', '1.50 KB', '5.00 GB']);
});

Deno.test('normalizes names for accent- and separator-insensitive search', () => {
	assertEquals(normalizeForSearch('  Pokémon.Scarlet_-_Violet  '), 'pokemon scarlet violet');
});

Deno.test('extracts file names and extensions from torrent paths', () => {
	assertEquals([fileName('/dir/Game.v1.NSP'), fileExtension('/dir/Game.v1.NSP')], ['Game.v1.NSP', 'nsp']);
	assertEquals([fileExtension('/dir.d/README'), fileExtension('/.hidden')], ['', '']);
});

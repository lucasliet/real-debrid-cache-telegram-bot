import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import { COMMANDS } from '@/bot/commands.ts';
import { startBot } from './support/botHarness.ts';
import { torrentFile } from './support/fakeRealDebrid.ts';

Deno.test('ignores commands from anyone but the owner', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Zelda' });

	await bot.sendText('/delete_torrent A', 666);

	assertEquals(bot.texts(), ['Desculpe, você não tem permissão para usar este bot.']);
	assertEquals(bot.realDebrid.requests.length, 0);
});

Deno.test('help lists every registered command', async () => {
	const bot = await startBot();
	await bot.sendText('/ajuda');

	const [help] = bot.texts();
	for (const { command } of COMMANDS) assertStringIncludes(help, `/${command}`);
});

Deno.test('lists torrents as valid HTML even when names carry markup characters', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Tom_&_Jerry <1080p> [x265]' });
	bot.realDebrid.seedTorrent({ id: 'B', filename: 'Still.Going', status: 'downloading', progress: 40, speed: 2 * 1024 * 1024, seeders: 7 });

	await bot.sendText('/status_torrent');

	const [listing] = bot.texts();
	assertStringIncludes(listing, 'Tom_&amp;_Jerry &lt;1080p&gt; [x265]');
	assertStringIncludes(listing, 'tg://msg?text=%2Fdownload%20A');
	assertStringIncludes(listing, '2.00 MB/s');
	assertEquals(listing.includes('%2Fdownload%20B'), false, 'unfinished torrents must not offer a download action');
	assertEquals(bot.telegramCalls[0].payload.parse_mode, 'HTML');
});

Deno.test('truncates long listings, reporting the total and splitting messages between entries', async () => {
	const bot = await startBot();
	for (let index = 0; index < 120; index++) bot.realDebrid.seedTorrent({ id: `ID${index}`, filename: `Torrent number ${index}` });

	await bot.sendText('/status_torrent');

	const messages = bot.texts();
	assertStringIncludes(messages[0], 'Mostrando 50 de 120');
	assertEquals(messages.length > 1, true);
	for (const message of messages) {
		assertEquals(message.length <= 4096, true);
		assertEquals(message.split('<a ').length, message.split('</a>').length, 'no entry may be cut in half');
	}
});

Deno.test('searches torrents and downloads by normalized name', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'The.Legend_of-Zélda.nsp' });
	bot.realDebrid.seedTorrent({ id: 'B', filename: 'Mario Kart' });
	bot.realDebrid.seedDownload({ id: 'D1', filename: 'legend of zelda ost.flac', streamable: 1 });

	await bot.sendText('legend of zelda');

	const [torrents, downloads] = bot.texts();
	assertStringIncludes(torrents, 'Torrents encontrados (1)');
	assertStringIncludes(torrents, 'Zélda');
	assertStringIncludes(downloads, 'legend of zelda ost.flac');
	assertStringIncludes(downloads, '%2Fstream%20D1');
});

Deno.test('tells the user when a search finds nothing', async () => {
	const bot = await startBot();
	await bot.sendText('<nothing>');
	assertEquals(bot.texts(), ['❌ Nenhum resultado para "&lt;nothing&gt;".']);
});

Deno.test('adds a magnet found anywhere in the message and reports progress on a single message', async () => {
	const bot = await startBot();
	bot.realDebrid.filesOfNextTorrents = [torrentFile(1, '/Zelda.nsp'), torrentFile(2, '/Mario.nsp')];

	await bot.sendText('olha esse: magnet:?xt=urn:btih:abc&dn=switch obrigado');

	assertEquals(new URLSearchParams(bot.realDebrid.requestsTo('POST', '/torrents/addMagnet')[0].body).get('magnet'), 'magnet:?xt=urn:btih:abc&dn=switch');
	assertEquals(bot.realDebrid.torrents.size, 2);
	const edits = bot.telegramCalls.filter((call) => call.method === 'editMessageText');
	assertEquals(new Set(edits.map((call) => call.payload.message_id)).size, 1);
	assertStringIncludes(bot.texts().at(-1)!, 'Todos os 2 arquivo(s) foram adicionados');
});

Deno.test('downloads a .torrent file from Telegram once and adds it', async () => {
	const bot = await startBot({ externalFetch: () => Promise.resolve(new Response('torrent-bytes')) });
	bot.realDebrid.filesOfNextTorrents = [torrentFile(1, '/A.nsp'), torrentFile(2, '/B.nsp'), torrentFile(3, '/C.nsp')];

	await bot.sendDocument('Games.TORRENT');

	assertEquals(bot.externalRequests.map((request) => request.url), ['https://api.telegram.org/file/bot123:test-token/documents/file.torrent']);
	assertEquals(bot.realDebrid.requestsTo('PUT', '/torrents/addTorrent').map((request) => request.body), Array(3).fill('torrent-bytes'));
});

Deno.test('refuses documents that are not .torrent files', async () => {
	const bot = await startBot();
	await bot.sendDocument('photo.png');

	assertMatch(bot.texts()[0], /apenas arquivos \.torrent/);
	assertEquals(bot.realDebrid.requests.length, 0);
});

Deno.test('reports Real-Debrid failures in plain language', async () => {
	const bot = await startBot();
	await bot.sendText('/delete_torrent missing');
	assertEquals(bot.texts(), ['❌ Recurso não encontrado']);
});

Deno.test('asks for the argument when a command comes without one', async () => {
	const bot = await startBot();
	await bot.sendText('/download');
	assertEquals(bot.texts(), ['❌ Faltou o argumento. Exemplo: /download 12345']);
});

Deno.test('points unknown commands to the help instead of searching for them', async () => {
	const bot = await startBot();
	await bot.sendText('/download_torrent 1');

	assertMatch(bot.texts()[0], /Comando desconhecido/);
	assertEquals(bot.realDebrid.requests.length, 0);
});

Deno.test('unrestricts every link of a finished torrent', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Show', links: ['https://real-debrid.com/d/1', 'https://real-debrid.com/d/2'] });

	await bot.sendText('/download A');

	assertEquals(bot.realDebrid.requestsTo('POST', '/unrestrict/link').length, 2);
	assertStringIncludes(bot.texts()[0], 'https://dl.example/');
});

Deno.test('shows only the streaming formats that have links', async () => {
	const bot = await startBot();
	await bot.sendText('/stream DL1');

	const [message] = bot.texts();
	assertStringIncludes(message, 'HLS (Apple)');
	assertStringIncludes(message, 'https://stream.example/full.mp4');
	assertEquals(message.includes('DASH'), false);
});

Deno.test('summarizes the account', async () => {
	const bot = await startBot();
	await bot.sendText('/conta');

	const [summary] = bot.texts();
	assertStringIncludes(summary, '10 dia(s) restante(s)');
	assertStringIncludes(summary, 'Torrents ativos:</b> 1/25');
});

Deno.test('bulk-deletes by name and reports what could not be deleted', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Zelda.BOTW' });
	bot.realDebrid.seedTorrent({ id: 'B', filename: 'Zelda TOTK' });
	bot.realDebrid.seedTorrent({ id: 'C', filename: 'Mario' });
	bot.realDebrid.refusesDeletion.add('B');

	await bot.sendText('/clean_by zelda');

	assertEquals([...bot.realDebrid.torrents.keys()], ['B', 'C']);
	assertStringIncludes(bot.texts()[0], '1 torrent(s) com "zelda" no nome deletado(s)');
	assertStringIncludes(bot.texts()[0], 'Zelda TOTK (<code>B</code>): Permissão negada');
});

Deno.test('deletes only torrents that contain Switch ROMs', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Game', files: [torrentFile(1, '/readme.txt'), torrentFile(2, '/Game.XCZ')] });
	bot.realDebrid.seedTorrent({ id: 'B', filename: 'Movie', files: [torrentFile(1, '/Movie.mkv')] });

	await bot.sendText('/clean_nsw');

	assertEquals([...bot.realDebrid.torrents.keys()], ['B']);
});

Deno.test('refreshes Tinfoil with basic credentials in the header', async () => {
	const bot = await startBot();
	await bot.sendText('/update_tinfoil');

	assertEquals(bot.externalRequests[0].url, 'https://tinfoil.example/update');
	assertEquals(bot.externalRequests[0].headers.get('Authorization'), `Basic ${btoa('user:pass')}`);
	assertStringIncludes(bot.texts()[0], 'concluída');
});

Deno.test('explains that Tinfoil is not configured instead of calling it', async () => {
	const bot = await startBot({ config: { tinfoil: { updateUrl: 'https://tinfoil.example/update' } } });
	await bot.sendText('/update_tinfoil');

	assertEquals(bot.externalRequests.length, 0);
	assertMatch(bot.texts()[0], /TINFOIL_USER_PASS/);
});

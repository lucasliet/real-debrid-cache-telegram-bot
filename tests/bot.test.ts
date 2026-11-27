import { assert, test } from 'vitest';
import { COMMANDS } from '@/bot/commands.ts';
import { startBot } from './support/botHarness.ts';
import { torrentFile } from './support/fakeRealDebrid.ts';

test('ignores commands from anyone but the owner', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Zelda' });

	await bot.sendText('/delete_torrent A', 666);

	assert.deepStrictEqual(bot.texts(), ['Desculpe, você não tem permissão para usar este bot.']);
	assert.deepStrictEqual(bot.realDebrid.requests.length, 0);
});

test('help lists every registered command', async () => {
	const bot = await startBot();
	await bot.sendText('/ajuda');

	const [help] = bot.texts();
	for (const { command } of COMMANDS) assert.include(help, `/${command}`);
});

test('lists torrents as valid HTML even when names carry markup characters', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Tom_&_Jerry <1080p> [x265]' });
	bot.realDebrid.seedTorrent({ id: 'B', filename: 'Still.Going', status: 'downloading', progress: 40, speed: 2 * 1024 * 1024, seeders: 7 });

	await bot.sendText('/status_torrent');

	const [listing] = bot.texts();
	assert.include(listing, 'Tom_&amp;_Jerry &lt;1080p&gt; [x265]');
	assert.include(listing, 'tg://msg?text=%2Fdownload%20A');
	assert.include(listing, '2.00 MB/s');
	assert.deepStrictEqual(listing.includes('%2Fdownload%20B'), false, 'unfinished torrents must not offer a download action');
	assert.deepStrictEqual(bot.telegramCalls[0].payload.parse_mode, 'HTML');
});

test('truncates long listings, reporting the total and splitting messages between entries', async () => {
	const bot = await startBot();
	for (let index = 0; index < 120; index++) bot.realDebrid.seedTorrent({ id: `ID${index}`, filename: `Torrent number ${index}` });

	await bot.sendText('/status_torrent');

	const messages = bot.texts();
	assert.include(messages[0], 'Mostrando 50 de 120');
	assert.deepStrictEqual(messages.length > 1, true);
	for (const message of messages) {
		assert.deepStrictEqual(message.length <= 4096, true);
		assert.deepStrictEqual(message.split('<a ').length, message.split('</a>').length, 'no entry may be cut in half');
	}
});

test('searches torrents and downloads by normalized name', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'The.Legend_of-Zélda.nsp' });
	bot.realDebrid.seedTorrent({ id: 'B', filename: 'Mario Kart' });
	bot.realDebrid.seedDownload({ id: 'D1', filename: 'legend of zelda ost.flac', streamable: 1 });

	await bot.sendText('legend of zelda');

	const [torrents, downloads] = bot.texts();
	assert.include(torrents, 'Torrents encontrados (1)');
	assert.include(torrents, 'Zélda');
	assert.include(downloads, 'legend of zelda ost.flac');
	assert.include(downloads, '%2Fstream%20D1');
});

test('tells the user when a search finds nothing', async () => {
	const bot = await startBot();
	await bot.sendText('<nothing>');
	assert.deepStrictEqual(bot.texts(), ['❌ Nenhum resultado para "&lt;nothing&gt;".']);
});

test('adds a magnet found anywhere in the message and reports progress on a single message', async () => {
	const bot = await startBot();
	bot.realDebrid.filesOfNextTorrents = [torrentFile(1, '/Zelda.nsp'), torrentFile(2, '/Mario.nsp')];

	await bot.sendText('olha esse: magnet:?xt=urn:btih:abc&dn=switch obrigado');

	assert.deepStrictEqual(
		new URLSearchParams(bot.realDebrid.requestsTo('POST', '/torrents/addMagnet')[0].body).get('magnet'),
		'magnet:?xt=urn:btih:abc&dn=switch',
	);
	assert.deepStrictEqual(bot.realDebrid.torrents.size, 2);
	const edits = bot.telegramCalls.filter((call) => call.method === 'editMessageText');
	assert.deepStrictEqual(new Set(edits.map((call) => call.payload.message_id)).size, 1);
	assert.include(bot.texts().at(-1) ?? '', 'Todos os 2 arquivo(s) foram adicionados');
});

test('downloads a .torrent file from Telegram once and adds it', async () => {
	const bot = await startBot({ externalFetch: () => Promise.resolve(new Response('torrent-bytes')) });
	bot.realDebrid.filesOfNextTorrents = [torrentFile(1, '/A.nsp'), torrentFile(2, '/B.nsp'), torrentFile(3, '/C.nsp')];

	await bot.sendDocument('Games.TORRENT');

	assert.deepStrictEqual(
		bot.externalRequests.map((request) => request.url),
		['https://api.telegram.org/file/bot123:test-token/documents/file.torrent'],
	);
	assert.deepStrictEqual(
		bot.realDebrid.requestsTo('PUT', '/torrents/addTorrent').map((request) => request.body),
		Array(3).fill('torrent-bytes'),
	);
});

test('refuses documents that are not .torrent files', async () => {
	const bot = await startBot();
	await bot.sendDocument('photo.png');

	assert.match(bot.texts()[0], /apenas arquivos \.torrent/);
	assert.deepStrictEqual(bot.realDebrid.requests.length, 0);
});

test('reports Real-Debrid failures in plain language', async () => {
	const bot = await startBot();
	await bot.sendText('/delete_torrent missing');
	assert.deepStrictEqual(bot.texts(), ['❌ Recurso não encontrado']);
});

test('asks for the argument when a command comes without one', async () => {
	const bot = await startBot();
	await bot.sendText('/download');
	assert.deepStrictEqual(bot.texts(), ['❌ Faltou o argumento. Exemplo: /download 12345']);
});

test('points unknown commands to the help instead of searching for them', async () => {
	const bot = await startBot();
	await bot.sendText('/download_torrent 1');

	assert.match(bot.texts()[0], /Comando desconhecido/);
	assert.deepStrictEqual(bot.realDebrid.requests.length, 0);
});

test('unrestricts every link of a finished torrent', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Show', links: ['https://real-debrid.com/d/1', 'https://real-debrid.com/d/2'] });

	await bot.sendText('/download A');

	assert.deepStrictEqual(bot.realDebrid.requestsTo('POST', '/unrestrict/link').length, 2);
	assert.include(bot.texts()[0], 'https://dl.example/');
});

test('shows only the streaming formats that have links', async () => {
	const bot = await startBot();
	await bot.sendText('/stream DL1');

	const [message] = bot.texts();
	assert.include(message, 'HLS (Apple)');
	assert.include(message, 'https://stream.example/full.mp4');
	assert.deepStrictEqual(message.includes('DASH'), false);
});

test('summarizes the account', async () => {
	const bot = await startBot();
	await bot.sendText('/conta');

	const [summary] = bot.texts();
	assert.include(summary, '10 dia(s) restante(s)');
	assert.include(summary, 'Torrents ativos:</b> 1/25');
});

test('bulk-deletes by name and reports what could not be deleted', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Zelda.BOTW' });
	bot.realDebrid.seedTorrent({ id: 'B', filename: 'Zelda TOTK' });
	bot.realDebrid.seedTorrent({ id: 'C', filename: 'Mario' });
	bot.realDebrid.refusesDeletion.add('B');

	await bot.sendText('/clean_by zelda');

	assert.deepStrictEqual([...bot.realDebrid.torrents.keys()], ['B', 'C']);
	assert.include(bot.texts()[0], '1 torrent(s) com "zelda" no nome deletado(s)');
	assert.include(bot.texts()[0], 'Zelda TOTK (<code>B</code>): Permissão negada');
});

test('refuses a bulk deletion whose term normalizes to nothing or to almost nothing', async () => {
	for (const term of ['.', '-', '- _', '\u0301', 'ab']) {
		const bot = await startBot();
		bot.realDebrid.seedTorrent({ id: 'A', filename: 'Zelda.BOTW' });
		bot.realDebrid.seedTorrent({ id: 'B', filename: 'ab-cd' });

		await bot.sendText(`/clean_by ${term}`);

		assert.deepStrictEqual([...bot.realDebrid.torrents.keys()], ['A', 'B'], `"${term}" must not delete anything`);
		assert.match(bot.texts()[0], /Termo muito genérico/);
		assert.deepStrictEqual(bot.realDebrid.requestsTo('DELETE', '/').length, 0);
	}
});

test('a search made only of separators finds nothing instead of everything', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Zelda.BOTW' });

	await bot.sendText('...');

	assert.deepStrictEqual(bot.texts(), ['❌ Nenhum resultado para "...".']);
});

test('summarizes hundreds of bulk-delete failures in a single deliverable message', async () => {
	const bot = await startBot();
	for (let index = 0; index < 120; index++) {
		bot.realDebrid.seedTorrent({ id: `ID${index}`, filename: `Zelda <${index}> & ${'x'.repeat(150)}` });
		bot.realDebrid.refusesDeletion.add(`ID${index}`);
	}

	await bot.sendText('/clean_by zelda');

	assert.strictEqual(bot.texts().length, 1);
	assert.include(bot.texts()[0], '… e mais 105.');
});

test('reports a large per-file ingestion with many failures without calling it a failed torrent', async () => {
	const bot = await startBot();
	bot.realDebrid.filesOfNextTorrents = Array.from({ length: 80 }, (_, index) => torrentFile(index + 1, `/Game <${index}> ${'y'.repeat(60)}.nsp`));
	for (let index = 2; index <= 80; index++) bot.realDebrid.refusesSelection.add(`T${index}`);

	await bot.sendText('magnet:?xt=urn:btih:abc');

	const texts = bot.texts();
	assert.include(texts.at(-1) ?? '', '1 de 80 arquivo(s) adicionados');
	assert.include(texts.at(-1) ?? '', '… e mais 64.');
	assert.include(texts.at(-2) ?? '', 'Processamento concluído');
	assert.strictEqual(
		texts.some((text) => text.includes('Não foi possível')),
		false,
	);
	const edits = bot.telegramCalls.filter((call) => call.method === 'editMessageText');
	assert.isBelow(edits.length, 80, 'progress edits must be paced, not one per event');
});

test('tells the user a bundle failed and leaves no torrent behind', async () => {
	const bot = await startBot();
	bot.realDebrid.filesOfNextTorrents = [torrentFile(1, '/Movie.mkv')];
	bot.realDebrid.refusesSelection.add('T1');

	await bot.sendText('magnet:?xt=urn:btih:abc');

	assert.strictEqual(bot.realDebrid.torrents.size, 0);
	assert.deepStrictEqual(bot.texts().slice(-2), ['❌ Não foi possível concluir a adição do torrent.', '❌ Valor de parâmetro inválido']);
});

test('finalizes the status message of a bundle', async () => {
	const bot = await startBot();
	bot.realDebrid.filesOfNextTorrents = [torrentFile(1, '/Movie.mkv')];

	await bot.sendText('magnet:?xt=urn:btih:abc');

	assert.deepStrictEqual(bot.texts().slice(0, 2), ['🔎 Analisando o torrent…', '✅ Processamento concluído.']);
	assert.include(bot.texts()[2], 'Torrent adicionado');
});

test('accepts commands addressed to the bot by name', async () => {
	const bot = await startBot();
	await bot.sendText('/ajuda@test_bot');
	assert.include(bot.texts()[0], 'Instruções de uso');
});

test('deletes only torrents that contain Switch ROMs', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Game', files: [torrentFile(1, '/readme.txt'), torrentFile(2, '/Game.XCZ')] });
	bot.realDebrid.seedTorrent({ id: 'B', filename: 'Movie', files: [torrentFile(1, '/Movie.mkv')] });

	await bot.sendText('/clean_nsw');

	assert.deepStrictEqual([...bot.realDebrid.torrents.keys()], ['B']);
});

test('refreshes Tinfoil with basic credentials in the header', async () => {
	const bot = await startBot();
	await bot.sendText('/update_tinfoil');

	assert.deepStrictEqual(bot.externalRequests[0].url, 'https://tinfoil.example/update');
	assert.deepStrictEqual(bot.externalRequests[0].headers.get('Authorization'), `Basic ${btoa('user:pass')}`);
	assert.include(bot.texts()[0], 'concluída');
});

test('explains that Tinfoil is not configured instead of calling it', async () => {
	const bot = await startBot({ config: { tinfoil: { updateUrl: 'https://tinfoil.example/update' } } });
	await bot.sendText('/update_tinfoil');

	assert.deepStrictEqual(bot.externalRequests.length, 0);
	assert.match(bot.texts()[0], /TINFOIL_USER_PASS/);
});

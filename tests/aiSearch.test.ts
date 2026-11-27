import { assert, test } from 'vitest';
import { LibrarySearchAssistant, MAX_CANDIDATES, type TextGenerationRunner } from '@/ai/LibrarySearchAssistant.ts';
import { startBot } from './support/botHarness.ts';
import { rejects } from './support/rejects.ts';

/** Workers AI stand-in that records what it was asked and answers with the scripted response. */
function fakeAi(respond: (inputs: Record<string, unknown>) => unknown) {
	const calls: { model: string; inputs: Record<string, unknown> }[] = [];
	const ai: TextGenerationRunner = {
		run: (model, inputs) => {
			calls.push({ model, inputs });
			return Promise.resolve().then(() => respond(inputs));
		},
	};
	return { ai, calls, prompt: () => (calls[0].inputs.messages as { content: string }[])[1].content };
}

test('asks for JSON output and offers the candidates as numbered data', async () => {
	const { ai, calls, prompt } = fakeAi(() => ({ response: { matches: [1] } }));

	const positions = await new LibrarySearchAssistant(ai, '@cf/test/model').suggest('filme do nolan', ['Barbie.2023', 'Oppenheimer.2023\n1080p']);

	assert.deepStrictEqual(positions, [1]);
	assert.strictEqual(calls[0].model, '@cf/test/model');
	assert.deepStrictEqual((calls[0].inputs.response_format as { type: string }).type, 'json_schema');
	assert.include(prompt(), 'Request: filme do nolan');
	assert.include(prompt(), '0: Barbie.2023\n1: Oppenheimer.2023 1080p');
});

test('accepts the answer as a JSON string too', async () => {
	const { ai } = fakeAi(() => ({ response: '{"matches":[0]}' }));
	assert.deepStrictEqual(await new LibrarySearchAssistant(ai, 'm').suggest('x', ['a']), [0]);
});

test('discards positions the model made up, repeated or beyond the limit', async () => {
	const { ai } = fakeAi(() => ({ response: { matches: [2, 2, 99, -1, 1.5, '0', ...Array.from({ length: 30 }, (_, index) => index)] } }));
	const names = Array.from({ length: 40 }, (_, index) => `name ${index}`);

	assert.deepStrictEqual(await new LibrarySearchAssistant(ai, 'm').suggest('x', names), [2, 0, 1, 3, 4, 5, 6, 7, 8, 9]);
});

test('never offers more candidates than the cap and skips the model for an empty library', async () => {
	const { ai, calls, prompt } = fakeAi(() => ({ response: { matches: [] } }));
	const assistant = new LibrarySearchAssistant(ai, 'm');

	assert.deepStrictEqual(await assistant.suggest('x', []), []);
	assert.strictEqual(calls.length, 0);

	await assistant.suggest(
		'x',
		Array.from({ length: MAX_CANDIDATES + 50 }, (_, index) => `name ${index}`),
	);
	assert.include(prompt(), `${MAX_CANDIDATES - 1}: name`);
	assert.notInclude(prompt(), `${MAX_CANDIDATES}: name`);
});

test('rejects answers outside the expected format', async () => {
	const { ai } = fakeAi(() => ({ response: 'sorry, I cannot help' }));
	await rejects(() => new LibrarySearchAssistant(ai, 'm').suggest('x', ['a']), Error);
});

test('suggests entries through the AI only when the literal search finds nothing', async () => {
	// The answer is derived from the numbered list the model receives, so the numbering and the
	// mapping back to torrents and downloads are verified together.
	const { ai, calls } = fakeAi((inputs) => {
		const prompt = (inputs.messages as { content: string }[])[1].content;
		const matches = [...prompt.matchAll(/^(\d+): .*Oppenheimer/gm)].map(([, position]) => Number(position));
		return { response: { matches: matches.reverse() } };
	});
	const bot = await startBot({ ai });
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Oppenheimer.2023.2160p.UHD.BluRay.x265' });
	bot.realDebrid.seedTorrent({ id: 'B', filename: 'Barbie.2023.1080p' });
	bot.realDebrid.seedDownload({ id: 'D1', filename: 'Oppenheimer.OST.flac' });

	await bot.sendText('barbie');
	assert.strictEqual(calls.length, 0, 'a literal match must not spend an AI call');

	await bot.sendText('aquele filme do nolan sobre a bomba');

	const [, notice, torrents, downloads] = bot.texts();
	assert.include(notice, 'sugestões da IA');
	assert.include(torrents, 'Oppenheimer.2023.2160p');
	assert.notInclude(torrents, 'Barbie');
	assert.include(downloads, 'Oppenheimer.OST.flac');
});

test('falls back to "no results" when the AI fails or finds nothing', async () => {
	for (const respond of [() => ({ response: { matches: [] } }), () => Promise.reject(new Error('model unavailable'))]) {
		const bot = await startBot({ ai: fakeAi(respond).ai });
		bot.realDebrid.seedTorrent({ id: 'A', filename: 'Barbie.2023' });

		await bot.sendText('duna');

		assert.deepStrictEqual(bot.texts(), ['❌ Nenhum resultado para "duna".']);
	}
});

test('maps suggestions correctly when torrents alone fill the candidate list', async () => {
	const { ai, prompt } = fakeAi(() => ({ response: { matches: [MAX_CANDIDATES - 1] } }));
	const bot = await startBot({ ai });
	for (let index = 0; index < MAX_CANDIDATES + 5; index++) bot.realDebrid.seedTorrent({ id: `T${index}`, filename: `Torrent.${index}` });
	bot.realDebrid.seedDownload({ id: 'D1', filename: 'Download.left.out' });

	await bot.sendText('uma descrição qualquer');

	assert.notInclude(prompt(), 'Download.left.out');
	assert.include(bot.texts()[1], `Torrent.${MAX_CANDIDATES - 1}`);
});

test('does not spend an AI call on greetings or pasted links', async () => {
	const { ai, calls } = fakeAi(() => ({ response: { matches: [0] } }));
	const bot = await startBot({ ai });
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Barbie.2023' });

	await bot.sendText('oi');
	await bot.sendText('https://hoster.example/arquivo-qualquer');

	assert.strictEqual(calls.length, 0);
});

test('works without an AI binding', async () => {
	const bot = await startBot();
	bot.realDebrid.seedTorrent({ id: 'A', filename: 'Barbie.2023' });

	await bot.sendText('duna');

	assert.deepStrictEqual(bot.texts(), ['❌ Nenhum resultado para "duna".']);
});

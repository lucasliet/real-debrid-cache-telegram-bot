import { assert, test } from 'vitest';
import { type DecisionInputs, type DecisionModelRunner, LibrarySearchAssistant, MAX_CANDIDATES } from '@/ai/LibrarySearchAssistant.ts';
import { loadConfig } from '@/config/environment.ts';
import { startBot } from './support/botHarness.ts';
import { rejects } from './support/rejects.ts';

interface Call {
	model: string;
	inputs: DecisionInputs;
}

/**
 * Decision model stand-in: answers every yes/no question with the probability `judge` gives to the entry
 * named in its instructions, so tests exercise the numbering sent to the model and the mapping back together.
 */
function fakeDecisionModel(judge: (entry: string, state: string) => number) {
	const calls: Call[] = [];
	const ai: DecisionModelRunner = {
		run: (model, inputs) => {
			const call: Call = { model, inputs };
			calls.push(call);
			const answers = Object.fromEntries(
				Object.entries(call.inputs.questions).map(([id, question]) => {
					const noul = judge(question.instructions, call.inputs.state);
					return [id, { type: 'noul', noul, confidence: noul }];
				}),
			);
			return Promise.resolve({ model: 'clef', answers, usage: { total_input_tokens: 1, total_output_tokens: 0 } });
		},
	};
	return { ai, calls };
}

const assistantFor = (ai: DecisionModelRunner, minProbability = 0.5) => new LibrarySearchAssistant(ai, { model: '@cf/cloudflare/clef', minProbability });

test('asks one yes/no question per entry, following the decision model API', async () => {
	const { ai, calls } = fakeDecisionModel((entry) => (entry.includes('Oppenheimer') ? 0.93 : 0.02));

	const positions = await assistantFor(ai).suggest('filme do nolan', ['Barbie.2023', 'Oppenheimer.2023\n1080p']);

	assert.deepStrictEqual(positions, [1]);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].model, '@cf/cloudflare/clef');
	assert.strictEqual(calls[0].inputs.model, 'clef');
	assert.include(calls[0].inputs.state, 'Request: filme do nolan');
	assert.include(calls[0].inputs.state, 'answer whether the request refers to that entry');
	assert.deepStrictEqual(calls[0].inputs.questions, {
		e0: { type: 'noul', instructions: 'Barbie.2023' },
		e1: { type: 'noul', instructions: 'Oppenheimer.2023 1080p' },
	});
});

test('suggests every entry at or above the threshold, most probable first, capped at ten', async () => {
	const { ai } = fakeDecisionModel((entry) => Number(entry.split(' ')[1]) / 100);
	const names = Array.from({ length: 30 }, (_, index) => `p ${40 + index * 2}`);

	const positions = await assistantFor(ai).suggest('x', names);

	assert.deepStrictEqual(positions, [29, 28, 27, 26, 25, 24, 23, 22, 21, 20]);
	assert.deepStrictEqual(await assistantFor(ai, 0.97).suggest('x', names), [29]);
	assert.deepStrictEqual(await assistantFor(ai, 0.99).suggest('x', names), []);
});

test('splits the candidates into requests of 64 questions and never exceeds the cap', async () => {
	const { ai, calls } = fakeDecisionModel((entry) => (entry === `name ${MAX_CANDIDATES - 1}` ? 0.9 : 0));
	const names = Array.from({ length: MAX_CANDIDATES + 50 }, (_, index) => `name ${index}`);

	const positions = await assistantFor(ai).suggest('x', names);

	assert.deepStrictEqual(positions, [MAX_CANDIDATES - 1]);
	assert.deepStrictEqual(
		calls.map((call) => Object.keys(call.inputs.questions).length),
		[64, 64, 64],
	);
	const asked = calls.flatMap((call) => Object.values(call.inputs.questions).map((question) => question.instructions));
	assert.strictEqual(
		asked.some((instructions) => instructions.endsWith(`name ${MAX_CANDIDATES}`)),
		false,
	);
});

test('skips the model for an empty library', async () => {
	const { ai, calls } = fakeDecisionModel(() => 1);
	assert.deepStrictEqual(await assistantFor(ai).suggest('x', []), []);
	assert.strictEqual(calls.length, 0);
});

test('keeps the answers of the requests that succeeded when another one fails', async () => {
	const { ai: working } = fakeDecisionModel((entry) => (entry === 'name 70' ? 0.8 : 0));
	let requests = 0;
	const flaky: DecisionModelRunner = {
		run: (model, inputs) => (++requests === 1 ? Promise.reject(new Error('3040: out of capacity')) : working.run(model, inputs)),
	};
	const names = Array.from({ length: 100 }, (_, index) => `name ${index}`);

	assert.deepStrictEqual(await assistantFor(flaky).suggest('x', names), [70]);
});

test('rejects when no request succeeds or the answer has an unexpected shape', async () => {
	const down: DecisionModelRunner = { run: () => Promise.reject(new Error('model unavailable')) };
	const garbled: DecisionModelRunner = { run: () => Promise.resolve({ response: 'sorry' }) };
	// The runtime binding may answer with null regardless of the declared record type.
	const nullish: DecisionModelRunner = { run: () => Promise.resolve(null as never) };

	await rejects(() => assistantFor(down).suggest('x', ['a']), Error, 'model unavailable');
	await rejects(() => assistantFor(garbled).suggest('x', ['a']), Error, 'answers');
	await rejects(() => assistantFor(nullish).suggest('x', ['a']), Error, 'answers');
});

test('ignores answers that are missing or not a probability', async () => {
	const partial: DecisionModelRunner = { run: () => Promise.resolve({ answers: { e0: { noul: 'yes' }, e2: { noul: 0.9 } } }) };
	assert.deepStrictEqual(await assistantFor(partial).suggest('x', ['a', 'b', 'c']), [2]);
});

test('suggests entries through the AI only when the literal search finds nothing', async () => {
	const { ai, calls } = fakeDecisionModel((entry, state) => (state.includes('nolan') && entry.includes('Oppenheimer') ? 0.9 : 0.01));
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

test('maps suggestions correctly when torrents alone fill the candidate list', async () => {
	const { ai, calls } = fakeDecisionModel((entry) => (entry === `Torrent.${MAX_CANDIDATES - 1}` ? 0.9 : 0));
	const bot = await startBot({ ai });
	for (let index = 0; index < MAX_CANDIDATES + 5; index++) bot.realDebrid.seedTorrent({ id: `T${index}`, filename: `Torrent.${index}` });
	bot.realDebrid.seedDownload({ id: 'D1', filename: 'Download.left.out' });

	await bot.sendText('uma descrição qualquer');

	assert.notInclude(JSON.stringify(calls), 'Download.left.out');
	assert.include(bot.texts()[1], `Torrent.${MAX_CANDIDATES - 1}`);
	assert.strictEqual(bot.texts().length, 2);
});

test('falls back to "no results" when the AI fails or finds nothing', async () => {
	const unavailable: DecisionModelRunner = { run: () => Promise.reject(new Error('model unavailable')) };
	for (const ai of [fakeDecisionModel(() => 0.1).ai, unavailable]) {
		const bot = await startBot({ ai });
		bot.realDebrid.seedTorrent({ id: 'A', filename: 'Barbie.2023' });

		await bot.sendText('duna');

		assert.deepStrictEqual(bot.texts(), ['❌ Nenhum resultado para "duna".']);
	}
});

test('does not spend an AI call on greetings or pasted links', async () => {
	const { ai, calls } = fakeDecisionModel(() => 1);
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

test('never sends half an emoji when shortening a name', async () => {
	const { ai, calls } = fakeDecisionModel(() => 0);
	await assistantFor(ai).suggest('x', [`${'a'.repeat(79)}🎮 tail`]);

	const [instructions] = Object.values(calls[0].inputs.questions).map((question) => question.instructions);
	assert.strictEqual(instructions, `${'a'.repeat(79)}🎮`);
	assert.doesNotThrow(() => encodeURIComponent(instructions), 'a lone surrogate would make this throw');
});

test('reads the model and the threshold from the configuration', () => {
	const required = { BOT_TOKEN: 'b', RD_TOKEN: 'r', ALLOWED_USER_ID: '42' };

	assert.deepStrictEqual(loadConfig(required).aiSearch, { model: '@cf/cloudflare/clef', minProbability: 0.5 });
	assert.deepStrictEqual(loadConfig({ ...required, AI_SEARCH_MODEL: '@cf/cloudflare/clef-flash', AI_SEARCH_MIN_PROBABILITY: '0,7' }).aiSearch, {
		model: '@cf/cloudflare/clef-flash',
		minProbability: 0.7,
	});
});

test('falls back to the defaults, without failing, when the optional AI settings are invalid', () => {
	const required = { BOT_TOKEN: 'b', RD_TOKEN: 'r', ALLOWED_USER_ID: '42' };

	for (const invalid of ['70', '0', 'abc']) {
		assert.strictEqual(loadConfig({ ...required, AI_SEARCH_MIN_PROBABILITY: invalid }).aiSearch.minProbability, 0.5);
	}
	assert.strictEqual(loadConfig({ ...required, AI_SEARCH_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }).aiSearch.model, '@cf/cloudflare/clef');
});

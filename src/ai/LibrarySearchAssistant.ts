/** The part of the Workers AI binding this module needs, so tests can stand in for it. */
export interface DecisionModelRunner {
	run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/** Questions a decision model accepts per request. */
const QUESTIONS_PER_REQUEST = 64;

/** Entries offered to the model per search (three requests); newer entries come first and the rest is left out. */
export const MAX_CANDIDATES = 3 * QUESTIONS_PER_REQUEST;

/** Suggestions returned at most. */
const MAX_SUGGESTIONS = 10;

/** Longest name sent to the model; release names carry their meaningful part at the start. */
const MAX_NAME_LENGTH = 80;

const GUIDANCE = [
	'A user is searching their personal media library.',
	'Entries are release names: words separated by dots or underscores, followed by year, resolution, codec and release group.',
	'The request may be in any language and may describe the content instead of naming it',
	'(a translated or abbreviated title, a franchise, a director, a typo).',
].join(' ');

export interface LibrarySearchAssistantOptions {
	/** Workers AI model id of a decision model following the System One API, e.g. `@cf/cloudflare/clef`. */
	model: string;
	/** Probability from which an entry is suggested. */
	minProbability: number;
}

/**
 * Uses a Workers AI decision model to find library entries a literal search cannot reach,
 * such as "aquele filme do Nolan sobre a bomba" for `Oppenheimer.2023.2160p.UHD.BluRay.x265`.
 *
 * A decision model answers typed questions with probabilities instead of generating text, so each candidate
 * becomes one yes/no question: "does the request refer to this entry?". There is no free-form output to parse,
 * several entries can match at once, and "nothing matches" is simply every probability below the threshold.
 */
export class LibrarySearchAssistant {
	private readonly modelSelector: string;

	/**
	 * @param ai - Workers AI binding
	 * @param options - Model and suggestion threshold
	 */
	constructor(
		private readonly ai: DecisionModelRunner,
		private readonly options: LibrarySearchAssistantOptions,
	) {
		// The request body repeats the model as its bare name: "@cf/cloudflare/clef" -> "clef".
		this.modelSelector = options.model.slice(options.model.lastIndexOf('/') + 1);
	}

	/**
	 * Pick the names the request most likely refers to.
	 * @param query - What the user typed
	 * @param names - Candidate names; only the first `MAX_CANDIDATES` are considered
	 * @returns Positions in `names` of the suggested entries, most probable first
	 * @throws When no request to the model succeeds
	 */
	async suggest(query: string, names: readonly string[]): Promise<number[]> {
		const candidates = names.slice(0, MAX_CANDIDATES);
		if (candidates.length === 0) return [];

		const batches: Promise<Map<number, number>>[] = [];
		for (let start = 0; start < candidates.length; start += QUESTIONS_PER_REQUEST) {
			batches.push(this.evaluate(query, candidates.slice(start, start + QUESTIONS_PER_REQUEST), start));
		}

		const outcomes = await Promise.allSettled(batches);
		const answered = outcomes.filter((outcome) => outcome.status === 'fulfilled');
		// A failed batch only narrows the search; with none answered there is nothing to suggest from.
		if (answered.length === 0) throw (outcomes[0] as PromiseRejectedResult).reason;
		if (answered.length < outcomes.length) console.warn(`[AI] ${outcomes.length - answered.length} of ${outcomes.length} requests failed`);

		const ranked = answered
			.flatMap((outcome) => [...outcome.value])
			.filter(([, probability]) => probability >= this.options.minProbability)
			.sort(([, a], [, b]) => b - a)
			.slice(0, MAX_SUGGESTIONS);

		// Logged without the query or the names, to tune the threshold from real usage.
		console.log(`[AI] ${ranked.length} of ${candidates.length} entries suggested (top probability ${ranked[0]?.[1].toFixed(2) ?? 'n/a'})`);
		return ranked.map(([position]) => position);
	}

	/**
	 * Ask one request's worth of questions.
	 * @param offset - Position of the first name of this batch in the candidate list
	 * @returns Probability that the request refers to each entry, by position
	 */
	private async evaluate(query: string, names: readonly string[], offset: number): Promise<Map<number, number>> {
		const questions = Object.fromEntries(
			names.map((name, index) => [questionId(offset + index), { type: 'noul', instructions: `Does the request refer to this entry? ${describe(name)}` }]),
		);

		const output = await this.ai.run(this.options.model, {
			model: this.modelSelector,
			state: `${GUIDANCE}\n\nRequest: ${query}`,
			questions,
		});

		const answers = (output as { answers?: Record<string, { noul?: unknown }> } | null)?.answers;
		if (!answers || typeof answers !== 'object') throw new Error('Workers AI answered without "answers"');

		const probabilities = new Map<number, number>();
		for (const index of names.keys()) {
			const probability = answers[questionId(offset + index)]?.noul;
			if (typeof probability === 'number' && Number.isFinite(probability)) probabilities.set(offset + index, probability);
		}
		return probabilities;
	}
}

function questionId(position: number): string {
	return `e${position}`;
}

function describe(name: string): string {
	return name.replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
}

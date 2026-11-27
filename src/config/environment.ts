const DEFAULT_SERVER_URL = 'https://real-debrid-cache-bot.lucasliet.workers.dev/webhook';
const DEFAULT_TINFOIL_UPDATE_URL = 'https://foil.lucasliet.com.br/update';

/** Decision model used by Workers AI to suggest library entries; `@cf/cloudflare/clef-flash` is a cheaper, smaller alternative. */
const DEFAULT_AI_SEARCH_MODEL = '@cf/cloudflare/clef';
const DEFAULT_AI_SEARCH_MIN_PROBABILITY = 0.5;

/**
 * Runtime configuration, read from the Worker's `env` (vars and secrets) in production
 * and from `process.env` (`.env` file) when running locally.
 */
export interface AppConfig {
	/** Telegram bot token issued by @BotFather. */
	readonly botToken: string;
	/** Real-Debrid private API token. */
	readonly realDebridToken: string;
	/** Only this Telegram user may talk to the bot. */
	readonly allowedUserId: number;
	/** Public URL Telegram delivers updates to. */
	readonly webhookUrl: string;
	/** Tinfoil shop refresh endpoint and its `user:pass` credentials (optional integration). */
	readonly tinfoil: { readonly updateUrl: string; readonly credentials?: string };
	/** Workers AI decision model behind the search suggestions, and the probability from which an entry is suggested. */
	readonly aiSearch: { readonly model: string; readonly minProbability: number };
}

/** Thrown when a required environment variable is missing or malformed. */
export class ConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigurationError';
	}
}

/** Variables as exposed by the runtime; bindings that are not strings (queues, AI) are ignored. */
export type EnvironmentSource = object;

function optional(env: EnvironmentSource, name: string): string | undefined {
	const value = (env as Record<string, unknown>)[name];
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function required(env: EnvironmentSource, name: string): string {
	const value = optional(env, name);
	if (!value) throw new ConfigurationError(`Missing required environment variable ${name}`);
	return value;
}

/** Decision models the search assistant can talk to (they share the request and response format). */
const SUPPORTED_AI_SEARCH_MODELS = /^@cf\/cloudflare\/clef(-[a-z]+)?$/;

/**
 * Settings of the optional AI search. An invalid value falls back to the default with a warning
 * instead of failing: a tuning knob of an optional feature must not take the whole bot down.
 */
function aiSearchSettings(env: EnvironmentSource): AppConfig['aiSearch'] {
	let model = optional(env, 'AI_SEARCH_MODEL') ?? DEFAULT_AI_SEARCH_MODEL;
	if (!SUPPORTED_AI_SEARCH_MODELS.test(model)) {
		console.warn(`[CONFIG] AI_SEARCH_MODEL "${model}" is not a Clef decision model; using ${DEFAULT_AI_SEARCH_MODEL}`);
		model = DEFAULT_AI_SEARCH_MODEL;
	}

	const rawProbability = optional(env, 'AI_SEARCH_MIN_PROBABILITY');
	let minProbability = rawProbability === undefined ? DEFAULT_AI_SEARCH_MIN_PROBABILITY : Number(rawProbability.replace(',', '.'));
	if (!(minProbability > 0 && minProbability <= 1)) {
		console.warn(`[CONFIG] AI_SEARCH_MIN_PROBABILITY "${rawProbability}" is not between 0 and 1; using ${DEFAULT_AI_SEARCH_MIN_PROBABILITY}`);
		minProbability = DEFAULT_AI_SEARCH_MIN_PROBABILITY;
	}

	return { model, minProbability };
}

/**
 * Read and validate the configuration.
 * @param env - Source of variables: the Worker's `env` or `process.env`
 * @returns Validated configuration
 * @throws ConfigurationError when a required variable is missing or malformed
 */
export function loadConfig(env: EnvironmentSource): AppConfig {
	const allowedUserId = Number(required(env, 'ALLOWED_USER_ID'));
	if (!Number.isSafeInteger(allowedUserId) || allowedUserId <= 0) {
		throw new ConfigurationError('ALLOWED_USER_ID must be a positive integer');
	}

	return {
		botToken: required(env, 'BOT_TOKEN'),
		realDebridToken: required(env, 'RD_TOKEN'),
		allowedUserId,
		webhookUrl: optional(env, 'SERVER_URL') ?? DEFAULT_SERVER_URL,
		tinfoil: {
			updateUrl: optional(env, 'TINFOIL_UPDATE_URL') ?? DEFAULT_TINFOIL_UPDATE_URL,
			credentials: optional(env, 'TINFOIL_USER_PASS'),
		},
		aiSearch: aiSearchSettings(env),
	};
}

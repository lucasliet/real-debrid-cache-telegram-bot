const DEFAULT_SERVER_URL = 'https://real-debrid-cache-bot.lucasliet.workers.dev/webhook';
const DEFAULT_TINFOIL_UPDATE_URL = 'https://foil.lucasliet.com.br/update';

/** Model used by Workers AI to suggest library entries; any text model with JSON mode works. */
const DEFAULT_AI_SEARCH_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

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
	/** Workers AI model behind the search suggestions. */
	readonly aiSearchModel: string;
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
		aiSearchModel: optional(env, 'AI_SEARCH_MODEL') ?? DEFAULT_AI_SEARCH_MODEL,
	};
}

import process from 'node:process';

const DEFAULT_SERVER_URL = 'https://real-debrid-cache-bot.lucasliet.workers.dev/webhook';
const DEFAULT_TINFOIL_UPDATE_URL = 'https://foil.lucasliet.com.br/update';

/**
 * Runtime configuration, read from environment variables
 * (`.env` locally, `vars`/secrets exposed through `process.env` on Cloudflare Workers).
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
}

/** Thrown when a required environment variable is missing or malformed. */
export class ConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigurationError';
	}
}

function required(env: Record<string, string | undefined>, name: string): string {
	const value = env[name]?.trim();
	if (!value) throw new ConfigurationError(`Missing required environment variable ${name}`);
	return value;
}

/**
 * Read and validate the configuration. Must be called inside a request/queue handler on Workers,
 * since bindings are not available at module scope.
 * @param env - Source of variables (defaults to `process.env`)
 * @returns Validated configuration
 * @throws ConfigurationError when a required variable is missing or malformed
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
	const allowedUserId = Number(required(env, 'ALLOWED_USER_ID'));
	if (!Number.isSafeInteger(allowedUserId) || allowedUserId <= 0) {
		throw new ConfigurationError('ALLOWED_USER_ID must be a positive integer');
	}

	return {
		botToken: required(env, 'BOT_TOKEN'),
		realDebridToken: required(env, 'RD_TOKEN'),
		allowedUserId,
		webhookUrl: env.SERVER_URL?.trim() || DEFAULT_SERVER_URL,
		tinfoil: {
			updateUrl: env.TINFOIL_UPDATE_URL?.trim() || DEFAULT_TINFOIL_UPDATE_URL,
			credentials: env.TINFOIL_USER_PASS?.trim() || undefined,
		},
	};
}

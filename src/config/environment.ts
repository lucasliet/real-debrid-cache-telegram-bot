import process from 'node:process';

export class Environment {
	private static instance: Environment;

	private constructor() {}

	static getInstance(): Environment {
		if (!Environment.instance) {
			Environment.instance = new Environment();
		}
		return Environment.instance;
	}

	get BOT_TOKEN(): string {
		return process.env.BOT_TOKEN || '';
	}

	get RD_TOKEN(): string {
		return process.env.RD_TOKEN || '';
	}

	get ALLOWED_USER_ID(): number {
		return Number(process.env.ALLOWED_USER_ID || 0);
	}

	get TINFOIL_USER_PASS(): string {
		return process.env.TINFOIL_USER_PASS || '';
	}

	get SERVER_URL(): string {
		return process.env.SERVER_URL || 'https://real-debrid-cache-bot.lucasliet.workers.dev/webhook';
	}
}

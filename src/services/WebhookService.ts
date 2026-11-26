import { Environment } from '@/config/environment.ts';
import { deriveWebhookSecret } from '@/util/WebhookSecret.ts';

export class WebhookService {
	private static instance: WebhookService;
	private readonly botToken: string;
	private readonly webhookUrl: string;

	private constructor() {
		const env = Environment.getInstance();
		this.botToken = env.BOT_TOKEN;
		this.webhookUrl = env.SERVER_URL;
	}

	static getInstance(): WebhookService {
		if (!WebhookService.instance) {
			WebhookService.instance = new WebhookService();
		}
		return WebhookService.instance;
	}

	/**
	 * Point the Telegram webhook to this worker, with a `secret_token` derived from the bot token
	 * that Telegram echoes on every delivery so forged updates can be rejected.
	 */
	async setWebhook(): Promise<void> {
		console.log(`Configurando webhook para: ${this.webhookUrl}`);
		await fetch(`https://api.telegram.org/bot${this.botToken}/setWebhook`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: this.webhookUrl,
				secret_token: await deriveWebhookSecret(this.botToken),
			}),
		});
	}
}

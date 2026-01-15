import { Environment } from '@/config/environment.ts';

export class WebhookService {
	private static instance: WebhookService;
	private readonly botToken: string;
	private readonly webhookUrl: string;

	private constructor() {
		this.botToken = Environment.getInstance().BOT_TOKEN;
		this.webhookUrl = 'https://real-debrid-cache-bot.deno.dev/webhook';
	}

	static getInstance(): WebhookService {
		if (!WebhookService.instance) {
			WebhookService.instance = new WebhookService();
		}
		return WebhookService.instance;
	}

	async setWebhook(): Promise<void> {
		await fetch(`https://api.telegram.org/bot${this.botToken}/setWebhook`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url: this.webhookUrl,
			}),
		});
		console.log(`Configurando webhook para: ${this.webhookUrl}`);
	}

	setupCronJob(): void {
		// Deno.cron('Configure Telegram bot webhook', '0 0 * * *', () => {
		// 	this.setWebhook();
		// });
	}
}

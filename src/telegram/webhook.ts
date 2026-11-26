import { Api } from 'grammy';
import { commandMenu } from '@/bot/commands.ts';
import type { AppConfig } from '@/config/environment.ts';
import { deriveWebhookSecret } from '@/telegram/webhookSecret.ts';

/**
 * Point the Telegram webhook to this deployment and publish the command menu.
 * The `secret_token` is derived from the bot token and echoed by Telegram on every delivery,
 * so forged updates can be rejected.
 * @param config - Application configuration
 * @param api - Bot API client (injectable for tests)
 */
export async function registerWebhook(config: AppConfig, api: Api = new Api(config.botToken)): Promise<void> {
	await api.setWebhook(config.webhookUrl, {
		secret_token: await deriveWebhookSecret(config.botToken),
		allowed_updates: ['message'],
	});
	await api.setMyCommands(commandMenu());
	console.log(`[WEBHOOK] Registered ${config.webhookUrl}`);
}

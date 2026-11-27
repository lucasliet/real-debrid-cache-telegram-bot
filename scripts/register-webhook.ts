import process from 'node:process';
import { loadConfig } from '../src/config/environment.ts';
import { registerWebhook } from '../src/telegram/webhook.ts';

// Points the Telegram webhook to SERVER_URL and publishes the command menu.
// Run it once after the first deploy, or whenever the URL or the commands change: `npm run webhook`.
await registerWebhook(loadConfig(process.env));

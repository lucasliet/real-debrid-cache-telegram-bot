import type { BotFullInfo, Update } from 'grammy/types';
import type { TextGenerationRunner } from '@/ai/LibrarySearchAssistant.ts';
import { createBot } from '@/bot/createBot.ts';
import type { AppConfig } from '@/config/environment.ts';
import { FakeRealDebrid } from './fakeRealDebrid.ts';

export const OWNER_ID = 1000;

export const TEST_CONFIG: AppConfig = {
	botToken: '123:test-token',
	realDebridToken: 'rd-token',
	allowedUserId: OWNER_ID,
	webhookUrl: 'https://bot.example/webhook',
	tinfoil: { updateUrl: 'https://tinfoil.example/update', credentials: 'user:pass' },
	aiSearchModel: '@cf/test/model',
};

export interface TelegramCall {
	method: string;
	payload: Record<string, unknown>;
}

/**
 * Run the real bot against an in-memory Real-Debrid and a recorded Telegram API,
 * so tests exercise the whole path from an update to the messages the user sees.
 */
export async function startBot(overrides: { config?: Partial<AppConfig>; externalFetch?: typeof fetch; ai?: TextGenerationRunner } = {}) {
	const realDebrid = new FakeRealDebrid();
	const telegramCalls: TelegramCall[] = [];
	const externalRequests: Request[] = [];
	let updateId = 0;

	const outboundFetch: typeof fetch = (input, init) => {
		const request = new Request(input, init);
		if (new URL(request.url).hostname === 'api.real-debrid.com') return realDebrid.fetch(input, init);
		externalRequests.push(request);
		return (overrides.externalFetch ?? (() => Promise.resolve(new Response('ok'))))(input, init);
	};

	const bot = await createBot(
		{ ...TEST_CONFIG, ...overrides.config },
		{
			fetch: outboundFetch,
			ai: overrides.ai,
			sleep: () => Promise.resolve(),
			botInfo: {
				id: 1,
				is_bot: true,
				first_name: 'Test',
				username: 'test_bot',
				can_join_groups: false,
				can_read_all_group_messages: false,
				supports_inline_queries: false,
				can_connect_to_business: false,
				has_main_web_app: false,
				has_topics_enabled: false,
				allows_users_to_create_topics: false,
			} as BotFullInfo,
		},
	);

	bot.api.config.use((_previous, method, payload) => {
		telegramCalls.push({ method, payload: payload as Record<string, unknown> });
		const result =
			method === 'getFile'
				? { file_id: 'F1', file_unique_id: 'U1', file_path: 'documents/file.torrent' }
				: { message_id: telegramCalls.length, date: 0, chat: { id: OWNER_ID, type: 'private' } };
		return Promise.resolve({ ok: true, result } as never);
	});

	const message = (fields: Record<string, unknown>, fromId = OWNER_ID): Update =>
		({
			update_id: ++updateId,
			message: { message_id: updateId, date: 0, chat: { id: fromId, type: 'private' }, from: { id: fromId, is_bot: false, first_name: 'User' }, ...fields },
		}) as Update;

	return {
		realDebrid,
		telegramCalls,
		externalRequests,
		/** Deliver a text message; a leading command is tagged with the entity Telegram would attach. */
		sendText(text: string, fromId = OWNER_ID): Promise<void> {
			const command = text.match(/^\/\w+/)?.[0];
			const entities = command ? [{ type: 'bot_command', offset: 0, length: command.length }] : undefined;
			return bot.handleUpdate(message({ text, entities }, fromId));
		},
		sendDocument(fileName: string, fileSize = 1024): Promise<void> {
			return bot.handleUpdate(message({ document: { file_id: 'F1', file_unique_id: 'U1', file_name: fileName, file_size: fileSize } }));
		},
		/** Texts of every message sent or edited, in order. */
		texts(): string[] {
			return telegramCalls.filter((call) => call.method === 'sendMessage' || call.method === 'editMessageText').map((call) => String(call.payload.text));
		},
	};
}

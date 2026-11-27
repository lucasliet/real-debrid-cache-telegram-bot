import type { Update } from 'grammy/types';

/** What the consumer needs from the bot. */
export interface UpdateHandler {
	handleUpdate(update: Update): Promise<void>;
}

/** The part of a Cloudflare Queue message the consumer uses. */
export interface QueuedUpdate {
	readonly body: Update;
	readonly attempts: number;
	ack(): void;
}

/**
 * Handle one queued update at most once. The message is acknowledged before the work starts because the work
 * is not idempotent: a redelivery (after an error, or after the invocation is cut off by the consumer's
 * wall-clock limit) would add the torrents again or repeat deletions. Handlers report their own errors to the user.
 * @param handler - Bot that processes the update
 * @param message - Queue message carrying the Telegram update
 */
export async function processQueuedUpdate(handler: UpdateHandler, message: QueuedUpdate): Promise<void> {
	message.ack();
	try {
		await handler.handleUpdate(message.body);
	} catch (error) {
		console.error(`[QUEUE] Failed to handle update ${message.body.update_id} (attempt ${message.attempts}):`, error);
	}
}

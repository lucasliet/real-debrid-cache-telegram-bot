import { Context } from 'grammy';
const MARKDOWN_ERROR_MESSAGE = 'Error on markdown parse_mode, message:';

declare module 'grammy' {
	interface Context {
		replyInChunks(output: string): Promise<void>;
	}
}

/**
 * Split a large response into multiple message chunks
 * Edit a message with updated content, respecting rate limits
 * Avoid hitting Telegram API rate limit https://core.telegram.org/bots/faq#broadcasting-to-users 
*/
Context.prototype.replyInChunks = async function (
	this: Context,
	output: string,
): Promise<void> {
	if (output.length > 4096) {
		const outputChunks = output.match(/[\s\S]{1,4093}/g)!;

		for (let index = 0; index < outputChunks.length; index++) {
			const chunk = outputChunks[index];
			const isLastChunk = index === outputChunks.length - 1;
			const chunkOutput = `${chunk}${isLastChunk ? '' : '...'}`;

			await this.reply(chunkOutput, { parse_mode: 'Markdown' })
				.catch(() => {
					console.warn(MARKDOWN_ERROR_MESSAGE, chunkOutput);
					this.reply(chunkOutput);
				});

			if (!isLastChunk) {
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
		}
		return;
	}
	await this.reply(output, { parse_mode: 'Markdown' })
		.catch(() => {
			console.warn(MARKDOWN_ERROR_MESSAGE, output);
			this.reply(output);
		});
}
import { Context } from 'grammy';
const MARKDOWN_ERROR_MESSAGE = 'Error on markdown parse_mode, message:';

declare module 'grammy' {
	interface Context {
		replyInChunks(output: string): void;
	}
}

/**
 * Split a large response into multiple message chunks
 */
Context.prototype.replyInChunks = function (
	this: Context,
	output: string,
): void {
	if (output.length > 4096) {
		const outputChunks = output.match(/[\s\S]{1,4093}/g)!;

		outputChunks.forEach((chunk, index) => {
			const isLastChunk = index === outputChunks.length - 1;
			const chunkOutput = `${chunk}${isLastChunk ? '' : '...'}`;

			this.reply(chunkOutput, { parse_mode: 'Markdown' })
				.catch(() => {
					console.warn(MARKDOWN_ERROR_MESSAGE, chunkOutput);
					this.reply(chunkOutput);
				});
		});
		return;
	}
  this.reply(output, { parse_mode: 'Markdown' })
		.catch(() => {
			console.warn(MARKDOWN_ERROR_MESSAGE, output);
			this.reply(output);
		});
}
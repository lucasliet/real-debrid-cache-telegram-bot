import { MyContext } from '@/types/grammy.d.ts';

export class MessageService {
	async updateProcessingMessage(
		ctx: MyContext,
		messageId: number,
		chatId: number,
		totalFiles: number,
		currentIndex: number,
		recentUpdates: string[],
		processing?: string,
	): Promise<void> {
		const statusMsg = `Processando ${totalFiles} arquivo(s) individualmente...\n\n` +
			`Progresso: ${currentIndex}/${totalFiles}\n` +
			`Últimas atualizações:\n${recentUpdates.join('\n')}` +
			(processing ? `\n${processing}` : '');

		await ctx.api.editMessageText(chatId, messageId, statusMsg);
	}
}

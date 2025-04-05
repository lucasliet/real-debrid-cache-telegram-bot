import { MyContext } from '@/types/grammy.d.ts';
import { RealDebridService } from '@/services/RealDebridService.ts';
import { MessageService } from '@/services/MessageService.ts';
import { TelegramService } from '@/services/TelegramService.ts';
import { allowedExtensions } from '@/config/constants.ts';
import { TorrentFile } from '@/types/realdebrid.d.ts';

export class TorrentHandler {
	private readonly realDebrid: RealDebridService;
	private readonly messageService: MessageService;
	private readonly telegramService: TelegramService;

	constructor() {
		this.realDebrid = RealDebridService.getInstance();
		this.messageService = new MessageService();
		this.telegramService = TelegramService.getInstance();
	}

	async handleTorrentFile(ctx: MyContext): Promise<void> {
		try {
			const document = ctx.message?.document;
			if (!document?.file_name?.endsWith('.torrent')) {
				await ctx.reply('Por favor, envie um arquivo .torrent válido.');
				return;
			}
			console.log(
				`Arquivo recebido: ${document.file_name}, tipo: ${document.mime_type}, tamanho: ${document.file_size} bytes`,
			);

			const fileData = await ctx.api.getFile(document.file_id);
			const fileUrl = this.telegramService.getFileUrl(fileData);

			await ctx.reply(`Analisando o arquivo torrent: ${document.file_name}...`);

			try {
				// 1. Adicionar uma vez para obter a lista de arquivos
				console.log(
					'Adicionando torrent inicialmente para obter lista de arquivos...',
				);
				const initialTorrentResult = await this.realDebrid
					.addTorrentFileWithStream(fileUrl); // Passar o nome original aqui
				await ctx.reply('Aguardando análise inicial...');
				await new Promise((resolve) => setTimeout(resolve, 1000));
				const initialTorrentInfo = await this.realDebrid.getTorrentInfo(
					initialTorrentResult.id,
				);

				if (
					!initialTorrentInfo || !initialTorrentInfo.files ||
					initialTorrentInfo.files.length === 0
				) {
					throw new Error(
						'Não foi possível obter a lista de arquivos do torrent inicial.',
					);
				}

				// 2. Chamar a função de processamento comum
				this.processFilesIndividually(
					ctx,
					initialTorrentResult.id,
					initialTorrentInfo.files,
					'torrent',
					fileUrl, // Passar a URL original do arquivo
				);
			} catch (error) {
				const errorMessage = error instanceof Error
					? error.message
					: 'Erro desconhecido';
				console.error('Erro no processamento do torrent:', errorMessage);
				await ctx.reply(`Erro ao processar o torrent: ${errorMessage}`);
			}
		} catch (error) {
			const errorMessage = error instanceof Error
				? error.message
				: 'Erro desconhecido';
			console.error('Erro geral no handler de documentos:', errorMessage);
			await ctx.reply(`Erro inesperado: ${errorMessage}`);
		}
	}

	async handleMagnetLink(ctx: MyContext, magnetUrl: string): Promise<void> {
		await ctx.reply(`Analisando o link magnet...`);
		try {
			// 1. Adicionar uma vez para obter a lista de arquivos
			console.log(
				'Adicionando magnet inicialmente para obter lista de arquivos...',
			);
			const initialMagnetResult = await this.realDebrid.addMagnetLink(
				magnetUrl,
			);
			await ctx.reply('Aguardando análise inicial...');
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const initialTorrentInfo = await this.realDebrid.getTorrentInfo(
				initialMagnetResult.id,
			);

			if (
				!initialTorrentInfo || !initialTorrentInfo.files ||
				initialTorrentInfo.files.length === 0
			) {
				throw new Error(
					'Não foi possível obter a lista de arquivos do magnet inicial.',
				);
			}

			// 2. Chamar a função de processamento comum
			this.processFilesIndividually(
				ctx,
				initialMagnetResult.id,
				initialTorrentInfo.files,
				'magnet',
				magnetUrl, // Passar o link magnet original
			);
		} catch (error) {
			const errorMessage = error instanceof Error
				? error.message
				: 'Erro desconhecido';
			console.error('Erro no processamento do link magnet:', errorMessage);
			await ctx.reply(`Erro ao processar o link magnet: ${errorMessage}`);
		}
	}

	async handleDownload(ctx: MyContext, torrentId: string): Promise<void> {
		try {
			const links = await this.realDebrid.getTorrentLinks(torrentId);
			if (links.length === 0) {
				await ctx.reply(
					'❌ Nenhum link de download encontrado para este torrent',
				);
				return;
			}

			const unrestricted = await Promise.all(
				links.map((link) => this.realDebrid.unrestrictLink(link)),
			);

			let message = '📥 Links de download:\n\n';
			unrestricted.forEach((file, index) => {
				message += `${index + 1}. ${file.filename}\n${file.download}\n\n`;
			});

			ctx.replyInChunks(message);
		} catch (error) {
			await ctx.reply(
				`❌ Erro ao obter links: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
		}
	}

	private async processFilesIndividually(
		ctx: MyContext,
		initialTorrentId: string,
		unfilteredFilesToProcess: TorrentFile[],
		sourceType: 'torrent' | 'magnet',
		originalSource: string,
	): Promise<void> {
		const filesToProcess = unfilteredFilesToProcess.filter((file) => {
			const fileExtension = file.path.split('.').pop()?.toLowerCase();
			return fileExtension && allowedExtensions.includes(fileExtension);
		});

		if (filesToProcess.length < unfilteredFilesToProcess.length) {
			console.log(
				'Não foi encontrado roms do switch, redirecionando para processamento completo',
			);
			await this.processTorrentComplete(
				ctx,
				initialTorrentId,
				unfilteredFilesToProcess,
				sourceType,
			);
			return;
		}

		const totalFiles = filesToProcess.length;
		let successCount = 0;
		const initialMessage = await ctx.reply(
			`Processando ${totalFiles} arquivo(s) individualmente...`,
		);
		const recentUpdates: string[] = [];

		console.log(
			`Iniciando processamento individual para ${sourceType}. Total: ${totalFiles}`,
		);

		for (let i = 0; i < totalFiles; i++) {
			const file = filesToProcess[i];
			const fileIndex = i + 1;
			const processingMessage =
				`➡️ Processando arquivo ${fileIndex}/${totalFiles}: ${file.path}`;

			await this.messageService.updateProcessingMessage(
				ctx,
				initialMessage.message_id,
				initialMessage.chat.id,
				totalFiles,
				fileIndex,
				recentUpdates,
				processingMessage,
			);

			console.log(
				`Processando arquivo ${fileIndex}/${totalFiles} (ID: ${file.id}) de ${sourceType}`,
			);

			try {
				let torrentIdToUse: string;

				if (i === 0) {
					torrentIdToUse = initialTorrentId;
					console.log(
						`Usando ID inicial ${torrentIdToUse} para o primeiro arquivo.`,
					);
				} else {
					console.log(
						`Re-adicionando ${sourceType} para o arquivo ${fileIndex}...`,
					);

					const currentResult = sourceType === 'torrent'
						? await this.realDebrid.addTorrentFileWithStream(originalSource)
						: await this.realDebrid.addMagnetLink(originalSource);

					torrentIdToUse = currentResult.id;
					console.log(
						`${sourceType} re-adicionado. Novo ID de torrent: ${torrentIdToUse}`,
					);
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
				console.log(
					`Selecionando arquivo ID ${file.id} do torrent ID ${torrentIdToUse}`,
				);
				await this.realDebrid.selectTorrentFiles(torrentIdToUse, [
					file.id.toString(),
				]);

				console.log(`Seleção bem-sucedida para arquivo ${fileIndex}`);
				// Atualizar array de atualizações recentes
				const updateMsg = `✅ Arquivo ${fileIndex}/${totalFiles}: ${
					file.path.split('/').pop() || file.path
				} adicionado com sucesso!`;
				recentUpdates.push(updateMsg);
				if (recentUpdates.length > 2) recentUpdates.shift();

				await this.messageService.updateProcessingMessage(
					ctx,
					initialMessage.message_id,
					initialMessage.chat.id,
					totalFiles,
					fileIndex,
					recentUpdates,
				);

				successCount++;

				if (i < totalFiles - 1) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			} catch (processError) {
				const errorMsg = processError instanceof Error
					? processError.message
					: 'Erro desconhecido';
				console.error(
					`Erro ao processar arquivo ${fileIndex} (${file.path}) de ${sourceType}:`,
					errorMsg,
				);

				recentUpdates.push(
					`⚠️ Falha no arquivo ${fileIndex}/${totalFiles}: ${file.path}`,
				);
				if (recentUpdates.length > 2) recentUpdates.shift();

				await this.messageService.updateProcessingMessage(
					ctx,
					initialMessage.message_id,
					initialMessage.chat.id,
					totalFiles,
					fileIndex,
					recentUpdates,
				);
			}
		}

		// Mensagem final
		const finalMsg = successCount === totalFiles
			? `✅ Todos os ${totalFiles} arquivos do ${sourceType} foram adicionados com sucesso!\n\n`
			: `⚠️ Concluído. ${successCount} de ${totalFiles} arquivos do ${sourceType} foram adicionados.\n\n`;

		await ctx.api.editMessageText(
			initialMessage.chat.id,
			initialMessage.message_id,
			finalMsg + `Últimas atualizações:\n${recentUpdates.join('\n')}`,
		);
	}

	private async processTorrentComplete(
		ctx: MyContext,
		torrentId: string,
		files: TorrentFile[],
		sourceType: 'torrent' | 'magnet',
	): Promise<void> {
		try {
			const totalFiles = files.length;
			await ctx.reply(`Processando ${totalFiles} arquivo(s) em conjunto...`);

			const fileIds = files.map((file) => file.id.toString());
			await this.realDebrid.selectTorrentFiles(torrentId, fileIds);

			const updateMsg = await ctx.reply(
				'✅ Todos os arquivos foram selecionados para download e estão sendo processados.\n\nUse /incomplete para verificar o progresso.',
			);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const torrentInfo = await this.realDebrid.getTorrentInfo(torrentId);
			await ctx.api.editMessageText(
				updateMsg.chat.id,
				updateMsg.message_id,
				`📥 Torrent adicionado com sucesso!\n\n` +
					`🆔 ID: \`${torrentId}\`\n` +
					`📂 Nome: ${torrentInfo.filename}\n` +
					`📊 Status: ${torrentInfo.status}\n` +
					`📈 Progresso: ${torrentInfo.progress}%\n\n` +
					`Digite parte do nome do arquivo ou /incomplete para verificar o progresso.\n` +
					`Use \`/download_torrent ${torrentId}\` para baixar quando completo.`,
			);
		} catch (error) {
			const errorMessage = error instanceof Error
				? error.message
				: 'Erro desconhecido';
			console.error(`Erro ao processar torrent completo:`, errorMessage);
			await ctx.reply(`❌ Erro ao processar o ${sourceType}: ${errorMessage}`);
		}
	}

	async handleSearchText(ctx: MyContext, text: string): Promise<void> {
		try {
			const searchResults = await this.realDebrid.searchByFileName(text);
			let message = '';

			if (searchResults.torrents.length > 0) {
				message = '📥 **Torrents encontrados:**\n\n';
				message += searchResults.torrents.map((t) =>
					`**🆔 ID:** \`${t.id}\`\n**📂 Nome:** ${t.filename}\n**📊 Status:** ${t.status}\n**📈 Progresso:** ${t.progress}%\n──────────────\n[   🗑️ Deletar   ](tg://msg?text=/delete_torrent ${t.id}) [   ⬇️ Baixar   ](tg://msg?text=/download ${t.id})\n──────────────`
				).join('\n\n');
			}

			if (searchResults.downloads.length > 0) {
				message = '📦 **Downloads encontrados:**\n\n';
				message += searchResults.downloads.map((d) => {
					let downloadInfo =
						`**🆔 ID:** \`${d.id}\`\n**📂 Nome:** ${d.filename}\n**💾 Tamanho:** ${
							(d.filesize / 1024 / 1024).toFixed(2)
						}MB\n──────────────\n`;
					downloadInfo +=
						`[   🗑️ Deletar   ](tg://msg?text=/delete_download ${d.id}) [   ⬇️ Baixar   ](${d.download})`;

					if (d.streamable === 1) {
						downloadInfo +=
							`\n──────────────\n[   🎥 Stream   ](tg://msg?text=/stream ${d.id})`;
					}

					downloadInfo += '\n──────────────';
					return downloadInfo;
				}).join('\n\n');
			}

			if (!message) {
				message = '❌ Nenhum resultado encontrado para sua busca.';
			}

			ctx.replyInChunks(message);
		} catch (error) {
			console.error('Erro ao processar busca por texto:', error);
			ctx.reply(
				'❌ Ocorreu um erro ao processar sua solicitação. Tente novamente mais tarde.',
			);
		}
	}

	async handleStream(ctx: MyContext, id: string): Promise<void> {
		try {
			const streamInfo = await this.realDebrid.getStreamingInfo(id);
			let message = '🎥 **Links de Streaming:**\n\n';

			if (Object.keys(streamInfo.apple).length > 0) {
				message += '📱 **HLS (Apple):**\n';
				Object.entries(streamInfo.apple).forEach(([quality, url]) => {
					message += `${quality}: ${url}\n`;
				});
				message += '\n';
			}

			if (Object.keys(streamInfo.dash).length > 0) {
				message += '🎮 **DASH:**\n';
				Object.entries(streamInfo.dash).forEach(([quality, url]) => {
					message += `${quality}: ${url}\n`;
				});
				message += '\n';
			}

			if (Object.keys(streamInfo.liveMP4).length > 0) {
				message += '📹 **MP4:**\n';
				Object.entries(streamInfo.liveMP4).forEach(([quality, url]) => {
					message += `${quality}: ${url}\n`;
				});
				message += '\n';
			}

			if (Object.keys(streamInfo.h264WebM).length > 0) {
				message += '🎬 **WebM:**\n';
				Object.entries(streamInfo.h264WebM).forEach(([quality, url]) => {
					message += `${quality}: ${url}\n`;
				});
			}

			ctx.replyInChunks(message);
		} catch (error) {
			await ctx.reply(
				`❌ Erro ao obter informações de streaming: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
		}
	}
}

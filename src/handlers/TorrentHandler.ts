import { MyContext } from "@/types/grammy.d.ts";
import { RealDebridService } from "@/services/RealDebridService.ts";
import { MessageService } from "@/services/MessageService.ts";
import { TelegramService } from "@/services/TelegramService.ts";
import { allowedExtensions } from "@/config/constants.ts";
import { TorrentFile, UnrestrictSchema } from '@/types/realdebrid.d.ts';

export class TorrentHandler {
  private readonly realDebrid: RealDebridService;
  private readonly messageService: MessageService;
  private readonly telegramService: TelegramService;

  constructor() {
    this.realDebrid = RealDebridService.getInstance();
    this.messageService = MessageService.getInstance();
    this.telegramService = TelegramService.getInstance();
  }

  async handleTorrentFile(ctx: MyContext): Promise<void> {
    try {
      const document = ctx.message?.document;
      if (!this.isValidTorrentFile(document)) {
        await ctx.reply(this.messageService.ERROR_MESSAGES.INVALID_TORRENT);
        return;
      }

      const fileUrl = await this.getTorrentFileUrl(ctx, document);
      await this.processTorrentSource(ctx, fileUrl, 'torrent');
    } catch (error) {
      await this.handleError(ctx, "Erro geral no handler de documentos", error);
    }
  }

  async handleMagnetLink(ctx: MyContext, magnetUrl: string): Promise<void> {
    try {
      await ctx.reply(this.messageService.MESSAGES.ANALYZING_MAGNET);
      await this.processTorrentSource(ctx, magnetUrl, 'magnet');
    } catch (error) {
      await this.handleError(ctx, "Erro no processamento do link magnet", error);
    }
  }

  async handleDownload(ctx: MyContext, torrentId: string): Promise<void> {
    try {
      const links = await this.realDebrid.getTorrentLinks(torrentId);
      if (links.length === 0) {
        await ctx.reply("❌ Nenhum link de download encontrado para este torrent");
        return;
      }

      const unrestricted = await Promise.all(
        links.map(link => this.realDebrid.unrestrictLink(link))
      );

      const message = this.formatDownloadLinks(unrestricted);
      ctx.replyInChunks(message);
    } catch (error) {
      await this.handleError(ctx, "Erro ao obter links", error);
    }
  }

  private async processTorrentSource(
    ctx: MyContext, 
    source: string, 
    sourceType: 'torrent' | 'magnet'
  ): Promise<void> {
    try {
      const initialResult = await this.addInitialTorrent(source, sourceType);
      await ctx.reply(this.messageService.MESSAGES.WAITING_INITIAL_ANALYSIS);
      
      const torrentInfo = await this.waitAndGetTorrentInfo(initialResult.id);
      
      if (!this.isValidTorrentInfo(torrentInfo)) {
        throw new Error(`Não foi possível obter a lista de arquivos do ${sourceType} inicial.`);
      }

      await this.processFilesIndividually(
        ctx,
        initialResult.id,
        torrentInfo.files,
        sourceType,
        source
      );
    } catch (error) {
      await this.handleError(ctx, `Erro no processamento do ${sourceType}`, error);
    }
  }

  private async addInitialTorrent(source: string, sourceType: 'torrent' | 'magnet') {
    return sourceType === 'torrent'
      ? await this.realDebrid.addTorrentFileWithStream(source)
      : await this.realDebrid.addMagnetLink(source);
  }

  private async waitAndGetTorrentInfo(torrentId: string) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return await this.realDebrid.getTorrentInfo(torrentId);
  }

  private formatDownloadLinks(unrestricted: UnrestrictSchema[]): string {
    return this.messageService.formatDownloadLinks(unrestricted);
  }

  private async handleError(ctx: MyContext, prefix: string, error: unknown): Promise<void> {
    console.error(`${prefix}:`, error);
    await ctx.reply(this.messageService.formatError(prefix, error));
  }

  private isValidTorrentFile(document: unknown): document is { file_name: string } {
    return !!document && typeof (document as any).file_name === 'string' 
           && (document as any).file_name.endsWith(".torrent");
  }

  private async getTorrentFileUrl(ctx: MyContext, document: any) {
    const fileData = await ctx.api.getFile(document.file_id);
    return this.telegramService.getFileUrl(fileData);
  }

  private isValidTorrentInfo(info: unknown): info is { files: TorrentFile[] } {
    return !!info && Array.isArray((info as any).files) && (info as any).files.length > 0;
  }

  private async processFilesIndividually(
    ctx: MyContext,
    initialTorrentId: string,
    unfilteredFilesToProcess: TorrentFile[],
    sourceType: 'torrent' | 'magnet',
    originalSource: string
  ): Promise<void> {
    const filesToProcess = unfilteredFilesToProcess.filter((file) => {
      const fileExtension = file.path.split('.').pop()?.toLowerCase();
      return fileExtension && allowedExtensions.includes(fileExtension);
    });

    if (filesToProcess.length < unfilteredFilesToProcess.length) {
      console.log('Não foi encontrado roms do switch, redirecionando para processamento completo');
      await this.processTorrentComplete(
        ctx,
        initialTorrentId,
        unfilteredFilesToProcess,
        sourceType
      );
      return;
    }
    
    const totalFiles = filesToProcess.length;
    let successCount = 0;
    const initialMessage = await ctx.reply(`Processando ${totalFiles} arquivo(s) individualmente...`);
    const recentUpdates: string[] = [];

    console.log(`Iniciando processamento individual para ${sourceType}. Total: ${totalFiles}`);

    for (let i = 0; i < totalFiles; i++) {
      const file = filesToProcess[i];
      const fileIndex = i + 1;
      const processingMessage = `➡️ Processando arquivo ${fileIndex}/${totalFiles}: ${file.path}`;
      
      await this.messageService.updateProcessingMessage(
        ctx,
        initialMessage.message_id,
        initialMessage.chat.id,
        totalFiles,
        fileIndex,
        recentUpdates,
        processingMessage
      );

      console.log(`Processando arquivo ${fileIndex}/${totalFiles} (ID: ${file.id}) de ${sourceType}`);

      try {
        let torrentIdToUse: string;

        if (i === 0) {
          torrentIdToUse = initialTorrentId;
          console.log(`Usando ID inicial ${torrentIdToUse} para o primeiro arquivo.`);
        } else {
          console.log(`Re-adicionando ${sourceType} para o arquivo ${fileIndex}...`);

          const currentResult = sourceType === 'torrent' 
            ? await this.realDebrid.addTorrentFileWithStream(originalSource)
            : await this.realDebrid.addMagnetLink(originalSource);

          torrentIdToUse = currentResult.id;
          console.log(`${sourceType} re-adicionado. Novo ID de torrent: ${torrentIdToUse}`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        console.log(`Selecionando arquivo ID ${file.id} do torrent ID ${torrentIdToUse}`);
        await this.realDebrid.selectTorrentFiles(torrentIdToUse, [file.id.toString()]);
        
        console.log(`Seleção bem-sucedida para arquivo ${fileIndex}`);
        // Atualizar array de atualizações recentes
        const updateMsg = `✅ Arquivo ${fileIndex}/${totalFiles}: ${file.path.split('/').pop() || file.path} adicionado com sucesso!`;
        recentUpdates.push(updateMsg);
        if (recentUpdates.length > 2) recentUpdates.shift();

        await this.messageService.updateProcessingMessage(
          ctx,
          initialMessage.message_id,
          initialMessage.chat.id,
          totalFiles,
          fileIndex,
          recentUpdates
        );

        successCount++;

        if (i < totalFiles - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

      } catch (processError) {
        const errorMsg = processError instanceof Error ? processError.message : "Erro desconhecido";
        console.error(`Erro ao processar arquivo ${fileIndex} (${file.path}) de ${sourceType}:`, errorMsg);
        
        recentUpdates.push(`⚠️ Falha no arquivo ${fileIndex}/${totalFiles}: ${file.path}`);
        if (recentUpdates.length > 2) recentUpdates.shift();

        await this.messageService.updateProcessingMessage(
          ctx,
          initialMessage.message_id,
          initialMessage.chat.id,
          totalFiles,
          fileIndex,
          recentUpdates
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
      finalMsg + `Últimas atualizações:\n${recentUpdates.join('\n')}`
    );
  }

  private async processTorrentComplete(
    ctx: MyContext,
    torrentId: string,
    files: TorrentFile[],
    sourceType: 'torrent' | 'magnet'
  ): Promise<void> {
    try {
      const totalFiles = files.length;
      await ctx.reply(`Processando ${totalFiles} arquivo(s) em conjunto...`);

      const fileIds = files.map(file => file.id.toString());
      await this.realDebrid.selectTorrentFiles(torrentId, fileIds);

      const updateMsg = await ctx.reply('✅ Todos os arquivos foram selecionados para download e estão sendo processados.\n\nUse /incomplete para verificar o progresso.');
      
      await new Promise((resolve) => setTimeout(resolve, 5000));
      
      const torrentInfo = await this.realDebrid.getTorrentInfo(torrentId);
      await ctx.api.editMessageText(
        updateMsg.chat.id,
        updateMsg.message_id,
        `📥 Torrent adicionado com sucesso!\n\n` +
        `🆔 ID: \`${torrentId}\`\n` +
        `📊 Status: ${torrentInfo.status}\n` +
        `📈 Progresso: ${torrentInfo.progress}%\n\n` +
        `Use /status_torrent ou /incomplete para verificar o progresso.\n` +
        `Use /download ${torrentId} para baixar quando completo.`
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      console.error(`Erro ao processar torrent completo:`, errorMessage);
      await ctx.reply(`❌ Erro ao processar o ${sourceType}: ${errorMessage}`);
    }
  }
}
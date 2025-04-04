import { MyContext } from "@/types/grammy.d.ts";
import { RealDebridService } from "@/services/RealDebridService.ts";
import { MessageService } from "@/services/MessageService.ts";
import { TelegramService } from "@/services/TelegramService.ts";
import { allowedExtensions } from "@/config/constants.ts";
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
      if (!document?.file_name?.endsWith(".torrent")) {
        await ctx.reply("Por favor, envie um arquivo .torrent válido.");
        return;
      }
      console.log(`Arquivo recebido: ${document.file_name}, tipo: ${document.mime_type}, tamanho: ${document.file_size} bytes`);
      
      const fileData = await ctx.api.getFile(document.file_id);
      const fileUrl = this.telegramService.getFileUrl(fileData);

      await ctx.reply(`Analisando o arquivo torrent: ${document.file_name}...`);

      try {
        // 1. Adicionar uma vez para obter a lista de arquivos
        console.log("Adicionando torrent inicialmente para obter lista de arquivos...");
        const initialTorrentResult = await this.realDebrid.addTorrentFileWithStream(fileUrl); // Passar o nome original aqui
        await ctx.reply("Aguardando análise inicial...");
        await new Promise((resolve) => setTimeout(resolve, 5000)); 
        const initialTorrentInfo = await this.realDebrid.getTorrentInfo(initialTorrentResult.id);

        if (!initialTorrentInfo || !initialTorrentInfo.files || initialTorrentInfo.files.length === 0) {
          throw new Error("Não foi possível obter a lista de arquivos do torrent inicial.");
        }

        // 2. Chamar a função de processamento comum
        this.processFilesIndividually(
            ctx,
            initialTorrentResult.id,
            initialTorrentInfo.files,
            'torrent',
            fileUrl // Passar a URL original do arquivo
        );

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
        console.error("Erro no processamento do torrent:", errorMessage);
        await ctx.reply(`Erro ao processar o torrent: ${errorMessage}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      console.error("Erro geral no handler de documentos:", errorMessage);
      await ctx.reply(`Erro inesperado: ${errorMessage}`);
    }
  }

  async handleMagnetLink(ctx: MyContext, magnetUrl: string): Promise<void> {
    await ctx.reply(`Analisando o link magnet...`);
    try {
      // 1. Adicionar uma vez para obter a lista de arquivos
      console.log("Adicionando magnet inicialmente para obter lista de arquivos...");
      const initialMagnetResult = await this.realDebrid.addMagnetLink(magnetUrl);
      await ctx.reply("Aguardando análise inicial...");
      await new Promise((resolve) => setTimeout(resolve, 5000)); 
      const initialTorrentInfo = await this.realDebrid.getTorrentInfo(initialMagnetResult.id);

      if (!initialTorrentInfo || !initialTorrentInfo.files || initialTorrentInfo.files.length === 0) {
        throw new Error("Não foi possível obter a lista de arquivos do magnet inicial.");
      }

      // 2. Chamar a função de processamento comum
      this.processFilesIndividually(
        ctx, 
        initialMagnetResult.id, 
        initialTorrentInfo.files, 
        'magnet', 
        magnetUrl // Passar o link magnet original
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      console.error("Erro no processamento do link magnet:", errorMessage);
      await ctx.reply(`Erro ao processar o link magnet: ${errorMessage}`);
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

      let message = "📥 Links de download:\n\n";
      unrestricted.forEach((file, index) => {
        message += `${index + 1}. ${file.filename}\n${file.download}\n\n`;
      });

      ctx.replyInChunks(message);
    } catch (error) {
      await ctx.reply(`❌ Erro ao obter links: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
}
import { MyContext } from "@/types/grammy.d.ts";
import type { TorrentSchema, UnrestrictSchema } from "@/types/realdebrid.d.ts";

export class MessageService {
  private static instance: MessageService;

  public static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  readonly MESSAGES = {
    INVALID_TORRENT: "Por favor, envie um arquivo .torrent válido.",
    NO_PERMISSION: "Desculpe, você não tem permissão para usar este bot.",
    HEALTH_CHECK: "Real-Debrid Cache Bot funcionando!",
    NO_DOWNLOAD_LINKS: "❌ Nenhum link de download encontrado para este torrent",
    TINFOIL_UPDATE_SUCCESS: "✅ Atualização do Tinfoil concluída com sucesso!",
    ANALYZING_MAGNET: "Analisando o link magnet...",
    WAITING_INITIAL_ANALYSIS: "Aguardando análise inicial...",
    FILES_SELECTED: "✅ Todos os arquivos foram selecionados para download e estão sendo processados.\n\nUse /incomplete para verificar o progresso."
  };

  formatError(prefix: string, error: unknown): string {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    return `❌ ${prefix}: ${errorMessage}`;
  }

  formatDeleteSuccess(type: 'torrent' | 'download', id: string): string {
    return `${type === 'torrent' ? 'Torrent' : 'Download'} ${id} deletado com sucesso!`;
  }

  async updateProcessingMessage(
    ctx: MyContext,
    messageId: number,
    chatId: number,
    totalFiles: number,
    currentIndex: number,
    recentUpdates: string[],
    processing?: string
  ): Promise<void> {
    const statusMsg = `Processando ${totalFiles} arquivo(s) individualmente...\n\n` +
      `Progresso: ${currentIndex}/${totalFiles}\n` +
      `Últimas atualizações:\n${recentUpdates.join('\n')}` +
      (processing ? `\n${processing}` : '');

    await ctx.api.editMessageText(chatId, messageId, statusMsg);
  }

  formatTorrentList(torrents: TorrentSchema[]): string {
    if (torrents.length === 0) return "";
    return torrents.map(t => this.formatTorrentItem(t)).join("\n\n");
  }

  formatDownloadList(downloads: UnrestrictSchema[]): string {
    if (downloads.length === 0) return "";
    return downloads.map(d => this.formatDownloadItem(d)).join("\n\n");
  }

  formatSearchResults(torrents: TorrentSchema[], downloads: UnrestrictSchema[]): string {
    let message = '';

    if (torrents.length > 0) {
      message += '📥 **Torrents encontrados:**\n\n' + this.formatTorrentList(torrents);
    }

    if (downloads.length > 0) {
      if (message) message += '\n\n';
      message += '📦 **Downloads encontrados:**\n\n' + this.formatDownloadList(downloads);
    }

    return message || '❌ Nenhum resultado encontrado para sua busca.';
  }

  formatDownloadLinks(unrestricted: UnrestrictSchema[]): string {
    return "📥 Links de download:\n\n" + 
           unrestricted.map((file, index) => 
             `${index + 1}. ${file.filename}\n${file.download}\n`
           ).join("\n");
  }

  formatProcessingStatus(totalFiles: number, currentFile?: string): string {
    return `Processando ${totalFiles} arquivo(s)${currentFile ? `: ${currentFile}` : ''}...`;
  }

  formatTorrentAddedSuccess(torrentId: string, status: string, progress: number): string {
    return `📥 Torrent adicionado com sucesso!\n\n` +
           `🆔 ID: \`${torrentId}\`\n` +
           `📊 Status: ${status}\n` +
           `📈 Progresso: ${progress}%\n\n` +
           `Use /status_torrent ou /incomplete para verificar o progresso.\n` +
           `Use /download ${torrentId} para baixar quando completo.`;
  }

  formatProcessingComplete(totalFiles: number, successCount: number, sourceType: string, updates: string[]): string {
    const isComplete = successCount === totalFiles;
    const status = isComplete
      ? `✅ Todos os ${totalFiles} arquivos do ${sourceType} foram adicionados com sucesso!\n\n`
      : `⚠️ Concluído. ${successCount} de ${totalFiles} arquivos do ${sourceType} foram adicionados.\n\n`;
    
    return status + `Últimas atualizações:\n${updates.join('\n')}`;
  }

  private formatTorrentItem(t: TorrentSchema): string {
    return `**🆔 ID:** \`${t.id}\`\n` +
           `**📂 Nome:** ${t.filename}\n` +
           `**📊 Status:** ${t.status}\n` +
           `**📈 Progresso:** ${t.progress}%\n` +
           `──────────────\n` +
           `[   🗑️ Deletar   ](tg://msg?text=/delete_torrent ${t.id}) ` +
           `[   ⬇️ Baixar   ](tg://msg?text=/download ${t.id})\n` +
           `──────────────`;
  }

  private formatDownloadItem(d: UnrestrictSchema): string {
    return `**🆔 ID:** \`${d.id}\`\n` +
           `**📂 Nome:** ${d.filename}\n` +
           `**💾 Tamanho:** ${(d.filesize / 1024 / 1024).toFixed(2)}MB\n` +
           `──────────────\n` +
           `[   🗑️ Deletar   ](tg://msg?text=/delete_download ${d.id}) ` +
           `[   ⬇️ Baixar   ](${d.download})\n` +
           `──────────────`;
  }
}

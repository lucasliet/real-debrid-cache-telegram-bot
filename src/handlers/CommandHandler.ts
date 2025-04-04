import { MyContext } from "@/types/grammy.d.ts";
import { RealDebridService } from "@/services/RealDebridService.ts";
import { MessageService } from "@/services/MessageService.ts";
import { HelpService } from "@/services/HelpService.ts";
import { TorrentHandler } from "./TorrentHandler.ts";

export class CommandHandler {
  private static instance: CommandHandler;
  private readonly realDebrid: RealDebridService;
  private readonly messageService: MessageService;
  private readonly helpService: HelpService;
  private readonly torrentHandler: TorrentHandler;

  private constructor() {
    this.realDebrid = RealDebridService.getInstance();
    this.messageService = MessageService.getInstance();
    this.helpService = HelpService.getInstance();
    this.torrentHandler = new TorrentHandler();
  }

  public static getInstance(): CommandHandler {
    if (!CommandHandler.instance) {
      CommandHandler.instance = new CommandHandler();
    }
    return CommandHandler.instance;
  }

  async handleStatusTorrent(ctx: MyContext): Promise<void> {
    try {
      const torrents = await this.realDebrid.listTorrents();
      const message = this.messageService.formatTorrentList(torrents);
      ctx.replyInChunks(message || "❌ Nenhum torrent encontrado");
    } catch (error) {
      await this.handleError(ctx, "Erro ao listar torrents", error);
    }
  }

  async handleStatusDownload(ctx: MyContext): Promise<void> {
    try {
      const downloads = await this.realDebrid.listDownloads();
      const message = this.messageService.formatDownloadList(downloads);
      ctx.replyInChunks(message || "❌ Nenhum download encontrado");
    } catch (error) {
      await this.handleError(ctx, "Erro ao listar downloads", error);
    }
  }

  async handleDeleteTorrent(ctx: MyContext): Promise<void> {
    const id = this.extractId(ctx, "delete_torrent");
    if (!id) return;

    try {
      await this.realDebrid.deleteTorrent(id);
      await ctx.reply(`Torrent ${id} deletado com sucesso!`);
    } catch (error) {
      await this.handleError(ctx, "Erro ao deletar torrent", error);
    }
  }

  async handleStart(ctx: MyContext): Promise<void> {
    await this.helpService.sendWelcome(ctx);
  }

  async handleHelp(ctx: MyContext): Promise<void> {
    await this.helpService.sendHelp(ctx);
  }

  async handleUpdateTinfoil(ctx: MyContext): Promise<void> {
    try {
      const response = await fetch(`http://${Environment.getInstance().TINFOIL_USER_PASS}@foil.lucasliet.com.br/update`);
      if (response.ok) {
        await ctx.reply(this.messageService.MESSAGES.TINFOIL_UPDATE_SUCCESS);
      } else {
        await ctx.reply(this.messageService.formatError("Erro ao atualizar Tinfoil", response.statusText));
      }
    } catch (error) {
      await this.handleError(ctx, "Erro ao atualizar Tinfoil", error);
    }
  }

  async handleDownload(ctx: MyContext): Promise<void> {
    const id = this.extractId(ctx, "download");
    if (!id) return;
    await this.torrentHandler.handleDownload(ctx, id);
  }

  async handleIncomplete(ctx: MyContext): Promise<void> {
    try {
      const torrents = await this.realDebrid.listTorrents();
      const incompleteTorrents = torrents.filter(t => t.status !== 'downloaded');
      const message = this.messageService.formatTorrentList(incompleteTorrents);
      ctx.replyInChunks(message || "❌ Nenhum torrent incompleto encontrado");
    } catch (error) {
      await this.handleError(ctx, "Erro ao listar torrents", error);
    }
  }

  async handleDeleteDownload(ctx: MyContext): Promise<void> {
    const id = this.extractId(ctx, "delete_download");
    if (!id) return;

    try {
      await this.realDebrid.deleteDownload(id);
      await ctx.reply(`Download ${id} deletado com sucesso!`);
    } catch (error) {
      await this.handleError(ctx, "Erro ao deletar download", error);
    }
  }

  async handleDocument(ctx: MyContext): Promise<void> {
    if (!ctx.message?.document?.file_name?.endsWith(".torrent")) {
      await this.helpService.sendInvalidFileHelp(ctx);
      return;
    }
    await this.torrentHandler.handleTorrentFile(ctx);
  }

  async handleText(ctx: MyContext): Promise<void> {
    if (ctx.message?.text?.startsWith("magnet:")) {
      await this.torrentHandler.handleMagnetLink(ctx, ctx.message.text);
      return;
    }
    
    const searchResults = await this.realDebrid.searchByFileName(ctx.message!.text);
    const message = this.messageService.formatSearchResults(
      searchResults.torrents, 
      searchResults.downloads
    );
    await ctx.replyInChunks(message);
  }

  private extractId(ctx: MyContext, command: string): string | undefined {
    const id = ctx.message?.text?.split(" ")[1];
    if (!id) {
      ctx.reply(`Por favor, forneça o ID. Exemplo: /${command} 12345`);
      return;
    }
    return id;
  }

  private async handleError(ctx: MyContext, prefix: string, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error(`${prefix}:`, errorMessage);
    await ctx.reply(`❌ ${prefix}: ${errorMessage}`);
  }
}

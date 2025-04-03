import { Environment } from "@/config/environment.ts";

export class TelegramService {
  private static instance: TelegramService;
  private readonly botToken: string;

  private constructor() {
    this.botToken = Environment.getInstance().BOT_TOKEN;
  }

  static getInstance(): TelegramService {
    if (!TelegramService.instance) {
      TelegramService.instance = new TelegramService();
    }
    return TelegramService.instance;
  }

  getFileUrl(fileData: { file_path?: string }): string {
    if (!fileData.file_path) {
      throw new Error("Caminho do arquivo não disponível");
    }
    return `https://api.telegram.org/file/bot${this.botToken}/${fileData.file_path}`;
  }
}

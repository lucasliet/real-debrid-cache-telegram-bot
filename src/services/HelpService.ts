import { MyContext } from "@/types/grammy.d.ts";
import { allowedExtensions } from "@/config/constants.ts";

export class HelpService {
  private static instance: HelpService;

  private constructor() {}

  static getInstance(): HelpService {
    if (!HelpService.instance) {
      HelpService.instance = new HelpService();
    }
    return HelpService.instance;
  }

  async sendWelcome(ctx: MyContext): Promise<void> {
    await ctx.reply(
      `Bem-vindo ao Real-Debrid Cache Bot! 🚀\n\n` +
      `Este bot ajuda você a enviar arquivos para o Real-Debrid evitando arquivos RAR.\n\n` +
      `Extensões suportadas: ${allowedExtensions.join(', ')}\n\n` +
      `📌 Como usar:\n` +
      `• Envie um arquivo .torrent\n` +
      `• Ou envie um link magnet\n\n` +
      `Use /ajuda para mais informações.`,
      { parse_mode: "Markdown" }
    );
  }

  async sendHelp(ctx: MyContext): Promise<void> {
    await ctx.reply(
      `📖 *Instruções de Uso*\n\n` +
      `1. Envie um arquivo .torrent ou link magnet\n` +
      `2. O bot irá:\n` +
      `   • Analisar o conteúdo\n` +
      `   • Processar cada arquivo individualmente\n` +
      `   • Mostrar o progresso em tempo real\n\n` +
      `🔍 Extensões suportadas: ${allowedExtensions.join(', ')}\n\n` +
      `⚠️ Importante: Apenas arquivos com essas extensões serão processados.`,
      { parse_mode: "Markdown" }
    );
  }

  async sendInvalidFileHelp(ctx: MyContext): Promise<void> {
    await ctx.reply(
      "❌ Por favor, envie apenas arquivos .torrent\n\n" +
      "Você também pode enviar links magnet diretamente.\n" +
      "Use /ajuda para mais informações."
    );
  }

  async sendInvalidMessageHelp(ctx: MyContext): Promise<void> {
    await ctx.reply(
      "❌ Mensagem não reconhecida.\n\n" +
      "Por favor, envie:\n" +
      "• Um arquivo .torrent\n" +
      "• Ou um link magnet\n\n" +
      "Use /ajuda para mais informações."
    );
  }
}

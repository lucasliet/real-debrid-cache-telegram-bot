import {
  Bot,
  Context,
  session,
  SessionFlavor,
	webhookCallback,
} from "https://deno.land/x/grammy@v1.21.1/mod.ts";
import {
  FileApiFlavor,
  hydrateFiles,
} from "https://deno.land/x/grammy_files@v1.0.4/mod.ts";
import { Application } from 'https://deno.land/x/oak@v12.6.1/mod.ts';
import { oakCors } from 'https://deno.land/x/cors@v1.2.2/mod.ts';
import { load } from "https://deno.land/std@0.212.0/dotenv/mod.ts";

// Carregar variáveis de ambiente (tentar carregar de .env em ambiente local, usar Deno.env em produção)
let env: Record<string, string> = {};
try {
  env = await load();
} catch (_e) {
  // No Deno Deploy, não há arquivo .env, então ignoramos o erro
  console.log(
    "Executando sem arquivo .env, usando variáveis de ambiente do sistema",
  );
}

const BOT_TOKEN = env["BOT_TOKEN"] || Deno.env.get("BOT_TOKEN") || "7814432698:AAEWh0x8JnL5vM-2LgWfzGp6mCo0gs3rLek";
const RD_TOKEN = env["RD_TOKEN"] || Deno.env.get("RD_TOKEN") || "L7GULH4F7XUDCPNVN24O7AEHV2Z7ADHATXG3CGF7N5HZJ3S522AQ";

const allowedExtensions = ['nsp', 'nsz', 'xci', 'xcz'];

// Interface da sessão
interface SessionData {
  uploads: {
    id: string;
    filename: string;
    status: string;
  }[];
}

// Tipo de contexto
// @ts-ignore - Ignorando erro de tipo no FileApiFlavor
type MyContext = Context & SessionFlavor<SessionData> & FileApiFlavor<Context>;

// Criação do bot
const bot = new Bot<MyContext>(BOT_TOKEN);
const APP = new Application();
APP.use(oakCors());

// Middleware para processar arquivos
// @ts-ignore - Ignorando incompatibilidade entre versões do Grammy e Grammy Files
bot.api.config.use(hydrateFiles(bot.token));

// Configuração da sessão
bot.use(session({
  initial(): SessionData {
    return { uploads: [] };
  },
}));

// Funções de utilidade para a API Real-Debrid
const REAL_DEBRID_API = "https://api.real-debrid.com/rest/1.0";

/**
 * Obtém a URL de um arquivo do Telegram
 */
function getTelegramFileUrl(fileData: { file_path?: string }): string {
  if (!fileData.file_path) {
    throw new Error("Caminho do arquivo não disponível");
  }
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.file_path}`;
}

/**
 * Adiciona um arquivo torrent ao Real-Debrid
 */
async function addTorrentFileWithStream(
  fileUrl: string,
  filename: string,
): Promise<ResourceSchema> {
  try {
    console.log(`Baixando arquivo de: ${fileUrl}`);
    
    // Baixar o arquivo completamente
    const fileResponse = await fetch(fileUrl, {
      headers: {
        'Accept': '*/*',
        'User-Agent': 'RealDebridTelegramBot/1.0'
      }
    });
    
    if (!fileResponse.ok) {
      throw new Error(`Erro ao baixar o arquivo do Telegram: ${fileResponse.status} ${fileResponse.statusText}`);
    }
    
    // Obter o arquivo como array de bytes
    const fileBuffer = await fileResponse.arrayBuffer();
    console.log(`Arquivo baixado com sucesso, tamanho: ${fileBuffer.byteLength} bytes, Nome: ${filename}`);
    
    // Verificar se o arquivo não está vazio
    if (fileBuffer.byteLength === 0) {
      throw new Error("Arquivo torrent vazio");
    }
    
    // Enviar para o Real-Debrid como dados brutos
    console.log(`Enviando requisição PUT para ${REAL_DEBRID_API}/torrents/addTorrent com dados brutos`);
    const response = await fetch(
      `${REAL_DEBRID_API}/torrents/addTorrent`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${RD_TOKEN}`,
          "Content-Type": "application/x-bittorrent", // Indicar o tipo de conteúdo
        },
        body: fileBuffer, // Enviar o ArrayBuffer diretamente
      },
    );
    
    console.log(`Resposta recebida, status: ${response.status}`);
    
    // Se a resposta não for bem-sucedida, obter detalhes do erro
    if (!response.ok) {
      const clonedResponse = response.clone();
      let errorMessage = `Erro ao adicionar torrent: ${response.status} ${response.statusText}`;
      try {
        const errorDetails = await response.json();
        console.error("Detalhes do erro JSON:", errorDetails);
        errorMessage = `Erro ao adicionar torrent: ${errorDetails.error || response.statusText} (Código: ${errorDetails.error_code})`;
      } catch (_jsonError) {
        try {
          const textError = await clonedResponse.text();
          console.error("Resposta de erro (texto):", textError);
          // Atualiza a mensagem de erro se o texto fornecer mais detalhes
          if (textError) errorMessage = `Erro ao adicionar torrent: ${response.status} ${response.statusText} - ${textError}`;
        } catch (_textParseError) {
          console.error("Não foi possível ler resposta de erro como texto");
        }
      }
      throw new Error(errorMessage);
    }
    
    // Tentar parsear a resposta JSON bem-sucedida
    try {
      return await response.json();
    } catch (e) {
      console.error("Erro ao parsear resposta JSON bem-sucedida:", e);
      const textResponse = await response.clone().text(); // Clonar novamente para ler o texto
      console.log("Resposta bem-sucedida como texto:", textResponse);
      throw new Error("Falha ao parsear resposta da API Real-Debrid após sucesso (status 2xx)");
    }

  } catch (error) {
    console.error("Erro no processamento do torrent (addTorrentFileWithStream):", error);
    // Re-lançar o erro para que o handler superior possa capturá-lo e informar o usuário
    throw error; 
  }
}

/**
 * Adiciona um link magnet ao Real-Debrid
 */
async function addMagnetLink(magnetUrl: string): Promise<ResourceSchema> {
  const formData = new FormData();
  formData.append("magnet", magnetUrl);

  const response = await fetch(
    `${REAL_DEBRID_API}/torrents/addMagnet`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RD_TOKEN}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Erro ao adicionar magnet: ${error.error}`);
  }

  return await response.json();
}

/**
 * Obtém informações do torrent
 */
async function getTorrentInfo(id: string): Promise<TorrentSchema> {
  const response = await fetch(
    `${REAL_DEBRID_API}/torrents/info/${id}`,
    {
      headers: {
        "Authorization": `Bearer ${RD_TOKEN}`,
      },
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Erro ao obter informações do torrent: ${error.error}`);
  }

  return await response.json();
}

/**
 * Seleciona arquivos específicos do torrent
 */
async function selectTorrentFiles(id: string, fileIds: string[]): Promise<boolean> {
  const formData = new FormData();
  formData.append("files", fileIds.join(","));

  const response = await fetch(
    `${REAL_DEBRID_API}/torrents/selectFiles/${id}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RD_TOKEN}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Erro ao selecionar arquivos: ${error.error}`);
  }

  return response.ok;
}

/**
 * Atualiza a mensagem de status do processamento
 */
async function updateProcessingMessage(
  ctx: MyContext,
  messageId: number,
  chatId: number,
  totalFiles: number,
  currentIndex: number,
  recentUpdates: string[],
  processing?: string
) {
  const statusMsg = `Processando ${totalFiles} arquivo(s) individualmente...\n\n` +
    `Progresso: ${currentIndex}/${totalFiles}\n` +
    `Últimas atualizações:\n${recentUpdates.join('\n')}` +
    (processing ? `\n${processing}` : '');

  await ctx.api.editMessageText(chatId, messageId, statusMsg);
}

/**
 * Processa arquivos de um torrent/magnet individualmente
 */
async function processFilesIndividually(
  ctx: MyContext,
  initialTorrentId: string,
  unfilteredFilesToProcess: TorrentFile[],
  sourceType: 'torrent' | 'magnet',
  originalSource: string
) {
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
    
    await updateProcessingMessage(
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
          ? await addTorrentFileWithStream(originalSource, `file_${fileIndex}.torrent`)
          : await addMagnetLink(originalSource);

        torrentIdToUse = currentResult.id;
        console.log(`${sourceType} re-adicionado. Novo ID de torrent: ${torrentIdToUse}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      console.log(`Selecionando arquivo ID ${file.id} do torrent ID ${torrentIdToUse}`);
      await selectTorrentFiles(torrentIdToUse, [file.id.toString()]);
      
      console.log(`Seleção bem-sucedida para arquivo ${fileIndex}`);
      // Atualizar array de atualizações recentes
      const updateMsg = `✅ Arquivo ${fileIndex}/${totalFiles}: ${file.path}`;
      recentUpdates.push(updateMsg);
      if (recentUpdates.length > 2) recentUpdates.shift();

      await updateProcessingMessage(
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

      await updateProcessingMessage(
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

// Handler para arquivos .torrent
bot.on("message:document", async (ctx) => {
  try {
    const document = ctx.message.document;
    if (!document.file_name?.endsWith(".torrent")) {
      await ctx.reply("Por favor, envie um arquivo .torrent válido.");
      return;
    }
    console.log(`Arquivo recebido: ${document.file_name}, tipo: ${document.mime_type}, tamanho: ${document.file_size} bytes`);
    
    const fileData = await ctx.api.getFile(document.file_id);
    const fileUrl = getTelegramFileUrl(fileData);

    await ctx.reply(`Analisando o arquivo torrent: ${document.file_name}...`);

    try {
      // 1. Adicionar uma vez para obter a lista de arquivos
      console.log("Adicionando torrent inicialmente para obter lista de arquivos...");
      const initialTorrentResult = await addTorrentFileWithStream(fileUrl, document.file_name); // Passar o nome original aqui
      await ctx.reply("Aguardando análise inicial...");
      await new Promise((resolve) => setTimeout(resolve, 5000)); 
      const initialTorrentInfo = await getTorrentInfo(initialTorrentResult.id);

      if (!initialTorrentInfo || !initialTorrentInfo.files || initialTorrentInfo.files.length === 0) {
        throw new Error("Não foi possível obter a lista de arquivos do torrent inicial.");
      }

      // 2. Chamar a função de processamento comum
      processFilesIndividually(
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
});

// Handler para links magnet
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  
  if (text.startsWith("magnet:")) {
    await ctx.reply(`Analisando o link magnet...`);
    try {
      // 1. Adicionar uma vez para obter a lista de arquivos
      console.log("Adicionando magnet inicialmente para obter lista de arquivos...");
      const initialMagnetResult = await addMagnetLink(text);
      await ctx.reply("Aguardando análise inicial...");
      await new Promise((resolve) => setTimeout(resolve, 5000)); 
      const initialTorrentInfo = await getTorrentInfo(initialMagnetResult.id);

      if (!initialTorrentInfo || !initialTorrentInfo.files || initialTorrentInfo.files.length === 0) {
        throw new Error("Não foi possível obter a lista de arquivos do magnet inicial.");
      }

      // 2. Chamar a função de processamento comum
      processFilesIndividually(
        ctx, 
        initialMagnetResult.id, 
        initialTorrentInfo.files, 
        'magnet', 
        text // Passar o link magnet original
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      console.error("Erro no processamento do link magnet:", errorMessage);
      await ctx.reply(`Erro ao processar o link magnet: ${errorMessage}`);
    }
  } else if (text === "/start") {
     await ctx.reply(
      "Bem-vindo ao bot de upload para Real-Debrid!\n\nEnvie um arquivo .torrent ou um link magnet para processamento.",
    );
  }
  // Ignorar outras mensagens de texto
});

// Comando de ajuda
bot.command("ajuda", async (ctx) => {
  await ctx.reply(
    "📌 *Bot Real-Debrid*\n\n" +
      "Este bot permite enviar torrents para o Real-Debrid:\n\n" +
      "• Envie um arquivo *.torrent*\n" +
      "• Ou envie uma mensagem com um link *magnet*\n\n" +
      "O bot processará cada arquivo individualmente para evitar a criação de arquivos .rar no WebDAV do Real-Debrid.",
    { parse_mode: "Markdown" },
  );
});

// Handler de erros
bot.catch((err) => {
  console.error("Erro não tratado no bot:", err);
});

APP.use(async (ctx, next) => {
  try {
    if (ctx.request.url.pathname !== '/webhook') {
      ctx.response.status = 200;
      ctx.response.body = 'Real-Debrid Cache Bot funcionando!';
      setWebhook();
      return;
    }
    await next();
  } catch (err) {
    ctx.response.status = 500;
    ctx.response.body = {
      message: err instanceof Error ? err.message : 'Unknown error occurred',
    };
  }
});

// Inicializar webhooks (para Deno Deploy)
if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
  // @ts-ignore - Ignorando erro de tipo no Deno
  Deno.cron('Configure Telegram bot webhook', '0 0 * * *', () => {
    setWebhook();
  });
  APP.use(webhookCallback(bot, 'oak'));
  APP.listen();
} else {
  // Em ambiente de desenvolvimento, usar long polling
  console.log("Bot iniciando em modo de polling...");
  bot.start();
}

function setWebhook() {
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: 'https://llm-telegram-bot.deno.dev/webhook',
    }),
  });
  console.log(
    `Configurando webhook para: https://real-debrid-cache-bot.deno.dev/webhook`,
  );
}

# Bot Real-Debrid para Telegram

Bot para Telegram que permite enviar arquivos .torrent e links magnet para o Real-Debrid, processando cada arquivo individualmente para evitar a criação de arquivos .rar no WebDAV.

## Funcionalidades

- Processamento de arquivos .torrent enviados no chat
- Processamento de links magnet enviados como mensagens
- Suporte a torrents com múltiplos arquivos (cada arquivo é adicionado individualmente)
- Comandos de ajuda e informações

## Requisitos

- [Deno](https://deno.land/) (versão 1.32.0 ou superior)
- Token de bot do Telegram (obtenha através do [@BotFather](https://t.me/BotFather))
- Token de API do Real-Debrid (obtenha em sua [conta Real-Debrid](https://real-debrid.com/apitoken))
- Conta no [Deno Deploy](https://deno.com/deploy) para deploy em produção

## Configuração

1. Clone este repositório:
   ```bash
   git clone https://github.com/seu-usuario/real-debrid-telegram-bot.git
   cd real-debrid-telegram-bot
   ```

2. Para desenvolvimento local, crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:
   ```
   BOT_TOKEN=seu_token_do_bot_telegram
   RD_TOKEN=seu_token_da_api_real_debrid
   ```

## Como obter o token do Real-Debrid

1. Acesse sua conta Real-Debrid em [real-debrid.com](https://real-debrid.com/)
2. Vá para a página [Minha Conta > API](https://real-debrid.com/apitoken)
3. Copie o token fornecido

## Como executar em ambiente local

Usando Deno task:

```bash
deno task start
```

Ou manualmente:

```bash
deno run --allow-net --allow-read --allow-env --allow-import main.ts
```

## Deploy no Deno Deploy

Para fazer o deploy deste bot no Deno Deploy, siga estas etapas:

1. Crie uma conta no [Deno Deploy](https://deno.com/deploy) caso ainda não tenha

2. Crie um novo projeto e conecte-o ao seu repositório GitHub ou faça upload dos arquivos diretamente

3. Configure as seguintes variáveis de ambiente no painel do Deno Deploy:
   - `BOT_TOKEN` - Token do seu bot Telegram
   - `RD_TOKEN` - Token de API do Real-Debrid
   - `WEBHOOK_URL` - URL completa do seu projeto Deno Deploy (ex: https://seu-projeto.deno.dev)

4. Defina o arquivo de entrada como `main.ts`

5. Depois do deploy, configure o webhook do seu bot Telegram acessando a seguinte URL:
   ```
   https://api.telegram.org/bot{SEU_BOT_TOKEN}/setWebhook?url={URL_DENO_DEPLOY}/webhook/{SEU_BOT_TOKEN}
   ```

O bot agora deve estar funcionando e respondendo às mensagens através do webhook.

## Como usar o bot

1. Inicie uma conversa com o bot no Telegram
2. Envie um arquivo .torrent ou um link magnet
3. O bot processará o arquivo/link e adicionará ao Real-Debrid
4. Se o torrent contiver múltiplos arquivos, o bot adicionará cada um individualmente

## Comandos disponíveis

- `/start` - Inicia o bot
- `/ajuda` - Exibe informações de ajuda

## Licença

MIT 
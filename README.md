# Real-Debrid Cache Telegram Bot

Bot do Telegram para enviar torrents individualmente para o Real-Debrid, evitando a criação de arquivos RAR no WebDAV.

## Funcionalidades

- Processa arquivos .torrent e links magnet
- Seleciona apenas arquivos com extensões específicas (nsp, nsz, xci, xcz)
- Processa cada arquivo individualmente para evitar arquivos RAR
- Fornece atualizações em tempo real do progresso
- Suporta webhooks para deploy contínuo

## Configuração

### Pré-requisitos
- [Deno](https://deno.land/) instalado
- Conta no [Real-Debrid](https://real-debrid.com/)
- Bot do Telegram (obtenha um token através do [@BotFather](https://t.me/botfather))

### Variáveis de Ambiente
Crie um arquivo `.env` na raiz do projeto:

```env
BOT_TOKEN=seu_token_do_telegram
RD_TOKEN=seu_token_do_real_debrid
ALLOWED_USER_ID=seu_id_do_telegram
TINFOIL_USER_PASS=usuario:senha
```

## Executando o Projeto

### Desenvolvimento Local
```bash
deno task dev
```

### Deploy (Cloudflare Workers)
O bot roda no [Cloudflare Workers](https://developers.cloudflare.com/workers/) (entrada `worker.ts`, bundle gerado com `deno bundle`). O webhook só enfileira
os updates numa [Cloudflare Queue](https://developers.cloudflare.com/queues/) e o consumer da fila executa o bot, já que o processamento dos torrents passa
do tempo de resposta do webhook.

```bash
npx wrangler@4.143.1 login
npx wrangler@4.143.1 queues create real-debrid-cache-bot-updates
npx wrangler@4.143.1 secret put BOT_TOKEN   # repita para RD_TOKEN, ALLOWED_USER_ID e TINFOIL_USER_PASS
deno task deploy
```

- `SERVER_URL` já vem definido em `vars` no `wrangler.jsonc` (`https://real-debrid-cache-bot.lucasliet.workers.dev/webhook`); um `GET /` no worker reaplica o
  webhook no Telegram.
- `static/` é publicado como static assets (ex.: `/robots.txt`).
- Push na `main` faz o deploy pelo GitHub Actions, usando os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` do repositório.

## Como Usar

1. Inicie uma conversa com seu bot no Telegram
2. Envie um arquivo .torrent ou um link magnet
3. O bot irá:
   - Analisar o arquivo/link
   - Listar os arquivos encontrados
   - Processar cada arquivo individualmente
   - Fornecer atualizações do progresso

## Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add: nova funcionalidade'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.
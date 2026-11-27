# Real-Debrid Cache Telegram Bot

Bot do Telegram, de uso pessoal, para gerenciar uma conta [Real-Debrid](https://real-debrid.com/): adiciona torrents e magnets, consulta e limpa a
biblioteca e gera links diretos e de streaming.

O diferencial é o tratamento de ROMs de Nintendo Switch: quando um torrent contém apenas arquivos `nsp`, `nsz`, `xci` ou `xcz`, o bot o adiciona **uma vez
por arquivo**, cada cópia com um único arquivo selecionado. Assim o Real-Debrid não empacota a seleção em RAR e cada jogo fica acessível individualmente
(por exemplo, para uma loja [Tinfoil](https://tinfoil.io/)).

## Funcionalidades

- Adiciona arquivos `.torrent` e links magnet (o magnet pode estar em qualquer parte da mensagem)
- Aguarda a conversão do magnet em vez de assumir um tempo fixo, e remove do Real-Debrid os torrents que falharem no meio do processo
- Progresso em tempo real numa única mensagem, com resumo das falhas por arquivo
- Busca por nome em torrents e downloads, ignorando acentos, maiúsculas e separadores (`.`, `_`, `-`)
- Quando a busca literal não encontra nada, o [Workers AI](https://developers.cloudflare.com/workers-ai/) sugere itens da biblioteca a partir da descrição
  (ex.: "aquele filme do Nolan sobre a bomba")
- Links diretos (`/download`, `/unrestrict`) e de streaming (`/stream`)
- Limpeza em massa por nome ou de todos os jogos de Switch
- Resumo da conta: plano, validade e torrents ativos
- Acesso restrito a um único usuário; o webhook só aceita entregas assinadas pelo Telegram

## Comandos

| Comando | Descrição |
| --- | --- |
| `/ajuda` | Mostra as instruções de uso |
| `/conta` | Mostra plano, validade e torrents ativos da conta |
| `/status_torrent` | Lista os 50 torrents mais recentes |
| `/status_download` | Lista os 50 downloads mais recentes |
| `/incomplete` | Lista os torrents que ainda não terminaram |
| `/download <id>` | Gera os links diretos de um torrent baixado |
| `/stream <id>` | Mostra os links de streaming de um download |
| `/unrestrict <link>` | Gera o link direto de um link de hoster |
| `/delete_torrent <id>` | Remove um torrent |
| `/delete_download <id>` | Remove um download |
| `/clean_by <termo>` | Remove todos os torrents com o termo no nome |
| `/clean_nsw` | Remove todos os torrents de jogos de Nintendo Switch |
| `/update_tinfoil` | Atualiza o índice da loja Tinfoil |

Qualquer outro texto é tratado como busca. O menu de comandos do Telegram é publicado junto com o registro do webhook, a partir da mesma lista
(`src/bot/commands.ts`) que gera o `/ajuda`.

## Arquitetura

```
Telegram ──POST /webhook──▶ Worker (fetch) ──▶ Cloudflare Queue ──▶ Worker (queue) ──▶ Bot ──▶ Real-Debrid
                                                                                        └──▶ Workers AI
```

O webhook apenas valida o segredo e enfileira o update; quem executa o bot é o consumer da fila. O processamento de um torrent leva de segundos a minutos,
muito além do que cabe na resposta de um webhook, e o trabalho deixado para depois da resposta HTTP é cancelado no Workers.

```
src/worker.ts                Entrada no Cloudflare Workers (fetch + queue)
src/main.ts                  Entrada local em Node.js (long polling)
src/ai/                      Sugestões de busca com Workers AI
src/config/                  Configuração validada e constantes
src/realdebrid/              Cliente HTTP da API: autenticação, paginação, rate limit, erros e tipos
src/services/                Regras de negócio, sem dependência do Telegram
  TorrentIngestionService    Estratégia de adição (um torrent por ROM ou torrent completo)
  LibraryService             Busca, links e limpeza em massa
  TinfoilService             Atualização da loja Tinfoil
src/bot/                     Camada do Telegram
  createBot.ts               Composition root: monta as dependências e registra os handlers
  middleware.ts              Tratamento central de erros e controle de acesso
  handlers/                  Comandos e mensagens
  views/                     Formatação das mensagens (HTML), funções puras
src/http/                    App HTTP do webhook (Hono)
src/telegram/                Registro do webhook, segredo e download de arquivos
tests/                       Testes executados no runtime do Workers, com Real-Debrid, Telegram e IA simulados
```

O projeto é TypeScript nativo do Workers: o Wrangler empacota `src/worker.ts` diretamente, os tipos dos bindings são gerados por `wrangler types` e os testes
rodam com Vitest dentro do `workerd`, o mesmo runtime de produção.

As dependências apontam para dentro: `bot` → `services` → `realdebrid`. Toda E/S externa (`fetch`, `sleep`, o binding de IA) é injetada, o que permite
testar o fluxo completo — do update recebido às mensagens enviadas — sem rede e sem esperas reais.

### Busca com Workers AI

A busca continua literal e determinística. Só quando ela não encontra nada o bot envia ao modelo a consulta e os nomes dos 300 itens mais recentes da
biblioteca, pedindo em JSON os números dos itens que correspondem. A resposta é tratada como entrada não confiável: só posições válidas são aceitas, no
máximo 10, e o resultado é apresentado como sugestão. Se o modelo falhar, a resposta é a mesma de uma busca sem resultados.

- A IA nunca participa de operações destrutivas: `/clean_by` e `/clean_nsw` usam apenas correspondência literal
- Os nomes dos arquivos são enviados ao Workers AI, na sua própria conta Cloudflare
- O modelo padrão é `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, configurável por `AI_SEARCH_MODEL`; o uso é cobrado conforme o plano do Workers AI
- Rodando localmente em long polling não há binding de IA e a busca funciona sem as sugestões

### Integração com a API do Real-Debrid

Implementada conforme a [documentação pública](https://api.real-debrid.com/) da API REST v1.0:

- **Paginação**: listagens usam `page`/`limit` e o cabeçalho `X-Total-Count`; buscas e limpezas percorrem todas as páginas, não só os 100 primeiros itens
- **Listagem vazia**: a API responde `204` sem corpo, tratado como lista vazia
- **Rate limit**: a API aceita 250 requisições por minuto e as recusadas também contam; o cliente espaça as chamadas (250 ms) e repete as que voltarem
  `429` com backoff exponencial
- **Erros**: o `error_code` numérico é traduzido para mensagens em português
- **Parâmetros**: enviados como `application/x-www-form-urlencoded`; arquivos `.torrent` vão como corpo bruto do `PUT /torrents/addTorrent`
- O endpoint `/torrents/instantAvailability` foi desativado pelo Real-Debrid e não é usado

## Configuração

### Pré-requisitos

- [Node.js](https://nodejs.org/) 22 ou superior
- Conta no [Real-Debrid](https://real-debrid.com/) e seu [token de API](https://real-debrid.com/apitoken)
- Bot do Telegram, criado com o [@BotFather](https://t.me/botfather)

### Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `BOT_TOKEN` | sim | Token do bot do Telegram |
| `RD_TOKEN` | sim | Token privado da API do Real-Debrid |
| `ALLOWED_USER_ID` | sim | ID numérico do único usuário autorizado |
| `SERVER_URL` | não | URL pública do webhook (definida em `wrangler.jsonc`) |
| `TINFOIL_USER_PASS` | não | Credenciais `usuario:senha` da loja Tinfoil; sem elas `/update_tinfoil` fica desativado |
| `TINFOIL_UPDATE_URL` | não | Endpoint de atualização da loja Tinfoil |
| `AI_SEARCH_MODEL` | não | Modelo do Workers AI usado nas sugestões de busca |

O bot se recusa a iniciar se uma variável obrigatória estiver ausente ou inválida.

## Desenvolvimento

```bash
npm install
```

```bash
npm run dev        # roda o bot localmente em long polling (Node.js)
```

```bash
npm run verify     # lint, tipos, testes e bundle — o mesmo que o CI executa
```

```bash
npm run dev:worker # roda o Worker no workerd local (wrangler dev), lendo os secrets de .dev.vars
```

Rodar localmente remove o webhook de produção enquanto o processo está ativo; ao encerrar (Ctrl+C) ele é registrado de novo.

Para instalar o hook de pre-commit (formatação e correções de lint com o Biome):

```bash
sh .hooks/install.sh
```

## Deploy (Cloudflare Workers)

O Wrangler empacota e publica `src/worker.ts`; os bindings (fila, Workers AI, assets) estão em `wrangler.jsonc`.

```bash
npx wrangler login
```

```bash
npx wrangler queues create real-debrid-cache-bot-updates
```

```bash
npx wrangler secret put BOT_TOKEN   # repita para RD_TOKEN, ALLOWED_USER_ID e TINFOIL_USER_PASS
```

```bash
npm run deploy
```

O deploy falha se `BOT_TOKEN`, `RD_TOKEN` ou `ALLOWED_USER_ID` não estiverem cadastrados como secrets.

Depois do primeiro deploy, acesse `https://real-debrid-cache-bot.<sua-conta>.workers.dev/` uma vez: o `GET /` registra o webhook e o menu de comandos no
Telegram (a operação é idempotente).

- `SERVER_URL` vem de `vars` em `wrangler.jsonc`; ajuste para o domínio do seu Worker
- `static/` é publicado como static assets (ex.: `/robots.txt`)
- Push na `main` executa a verificação e o deploy pelo GitHub Actions, usando os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`

## Licença

Distribuído sob a licença MIT.

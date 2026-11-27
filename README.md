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
- Listagens e resultados de busca paginados numa única mensagem, com botões de navegação (⏮ ◀️ ▶️ ⏭)
- Cada item da lista tem sua linha de botões (Baixar, Stream, Deletar), numerada como o item; Deletar pede confirmação
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
| `/status_torrent` | Lista todos os torrents, 10 por página |
| `/status_download` | Lista todos os downloads, 10 por página |
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

A busca continua literal e determinística. Só quando ela não encontra nada o bot consulta o [Clef](https://developers.cloudflare.com/workers-ai/models/clef/),
um modelo de decisão: em vez de gerar texto, ele responde perguntas tipadas com probabilidades. Cada um dos 192 itens mais recentes da biblioteca vira uma
pergunta sim/não ("a consulta se refere a este item?"), em até 3 requisições de 64 perguntas, e são sugeridos os itens com probabilidade igual ou acima do
limiar, no máximo 10, do mais provável para o menos.

- Não há texto livre para interpretar: vários itens podem corresponder ao mesmo tempo e "nada corresponde" é simplesmente nenhuma probabilidade acima do limiar
- A IA nunca participa de operações destrutivas: `/clean_by` e `/clean_nsw` usam apenas correspondência literal
- Os nomes dos arquivos são enviados ao Workers AI, na sua própria conta Cloudflare
- O limiar padrão é `0.5` (`AI_SEARCH_MIN_PROBABILITY`); cada busca registra no log quantos itens foram sugeridos e a maior probabilidade, para calibrá-lo
- O modelo é configurável por `AI_SEARCH_MODEL` entre os da família Clef (`@cf/cloudflare/clef`, `@cf/cloudflare/clef-flash`); o uso consome a cota diária
  de 10.000 neurons do Workers AI, compartilhada por toda a conta
- Consultas muito curtas ou que são só um link não são enviadas ao modelo
- Se o modelo falhar, a resposta é a mesma de uma busca sem resultados
- Rodando localmente em long polling não há binding de IA e a busca funciona sem as sugestões

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
| `SERVER_URL` | não | URL pública do webhook; no Worker vem de `wrangler.jsonc`, localmente precisa estar no `.env` com o mesmo valor |
| `TINFOIL_USER_PASS` | não | Credenciais `usuario:senha` da loja Tinfoil; sem elas `/update_tinfoil` fica desativado |
| `TINFOIL_UPDATE_URL` | não | Endpoint de atualização da loja Tinfoil |
| `AI_SEARCH_MODEL` | não | Modelo de decisão do Workers AI usado nas sugestões de busca (padrão `@cf/cloudflare/clef`) |
| `AI_SEARCH_MIN_PROBABILITY` | não | Probabilidade mínima, de 0 a 1, para um item ser sugerido (padrão `0.5`) |

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

Rodar localmente remove o webhook de produção enquanto o processo está ativo; ao encerrar (Ctrl+C, ou se o polling falhar) ele é registrado de novo.

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

Sem `BOT_TOKEN`, `RD_TOKEN` ou `ALLOWED_USER_ID` cadastrados como secrets o Worker responde 500 ao webhook.

Depois do primeiro deploy, acesse `https://real-debrid-cache-bot.<sua-conta>.workers.dev/` uma vez: o `GET /` registra o webhook e o menu de comandos no
Telegram (a operação é idempotente). É também assim que os updates voltam para o deploy depois de rodar o bot localmente. O mesmo registro pode ser
feito pela linha de comando, com `npm run webhook`.

- `SERVER_URL` vem de `vars` em `wrangler.jsonc`; ajuste para o domínio do seu Worker **e defina o mesmo valor no `.env`**. `npm run dev` (ao encerrar)
  e `npm run webhook` leem só o `.env`: sem `SERVER_URL` nele, registrariam o webhook no endereço padrão do projeto, não no seu Worker
- `static/` é publicado como static assets (ex.: `/robots.txt`)
- No plano gratuito do Workers cada execução faz no máximo 50 subrequests: adicionar um pacote com mais de ~10 ROMs ou rodar `/clean_nsw` numa biblioteca
  com mais de ~40 torrents excede esse limite e é interrompido no meio. O plano pago (10.000 por execução) comporta todos os comandos
- `/clean_by` e `/clean_nsw` param após 12 minutos e informam o que já foi feito; basta rodar de novo para continuar. A adição de um pacote de ROMs
  também para aos 12 minutos e lista os arquivos que não foram processados
- Os updates são processados um por vez, porque o limite de requisições do Real-Debrid é controlado por execução
- Cada update é processado no máximo uma vez: a mensagem da fila é confirmada antes do processamento, porque repetir adicionaria os torrents de novo
- Push na `main` executa a verificação e o deploy pelo GitHub Actions, usando os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`

## Licença

Distribuído sob a licença MIT.

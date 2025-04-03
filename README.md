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
```

## Executando o Projeto

### Desenvolvimento Local
```bash
deno task dev
```

### Deploy (Deno Deploy)
1. Fork este repositório
2. Configure as variáveis de ambiente no Deno Deploy
3. Conecte seu repositório ao Deno Deploy

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
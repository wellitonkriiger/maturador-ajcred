# maturador-ajcred

Projeto com `npm workspaces`:

- `backend`: API, Socket.IO e runtime do WhatsApp
- `frontend`: painel React/Vite
- `root`: ponto oficial de instalacao e execucao

## Estrutura oficial

- `package.json` na raiz, no `backend` e no `frontend`: necessario
  - a raiz orquestra os workspaces
  - cada pacote precisa do proprio manifest para declarar dependencias e scripts
- `node_modules` na raiz: oficial
- `node_modules` dentro de `backend` e `frontend`: redundante no fluxo atual
- `.gitignore` somente na raiz: suficiente

## Comandos oficiais

Instalacao:

```bash
npm install
```

Desenvolvimento:

```bash
npm run dev
```

Producao integrada:

```bash
npm run build
npm start
```

## Como funciona

- `npm run dev`
  - sobe o backend em `3001`
  - sobe o frontend Vite em `500`
  - o frontend usa proxy para `/api`, `/health` e `/socket.io`
- `npm start`
  - sobe apenas o backend em `3001`
  - serve o frontend ja buildado pela mesma porta
  - nao precisa `live-server`

## VM Linux

Dependencias minimas:

```bash
sudo apt update
sudo apt install -y chromium
```

Se necessario, fixe o executavel em `backend/.env`:

```env
WHATSAPP_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
```

Deploy padrao:

```bash
npm install
npm run build
npm start
```

## Runtime do WhatsApp

O backend faz tres papeis distintos:

- `browserRuntimeService`
  - resolve e valida Chrome/Chromium
  - protege a subida na VM quando o browser nao existe
- `whatsappService`
  - controla sessao, QR, keepalive, offline e reconexao
- `healthMonitor`
  - corrige apenas casos de status persistido incoerente, como `online` sem cliente real

## Observacoes

- o frontend deve refletir o backend; o canal principal e Socket.IO, com polling periodico apenas para resincronizar
- logs continuam disponiveis pela API
- se existirem `backend/node_modules` ou `frontend/node_modules`, remova e use apenas a instalacao da raiz

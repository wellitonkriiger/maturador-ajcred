# maturador-ajcred

Projeto com `npm workspaces`:

- `backend`: API, Socket.IO e runtime do WhatsApp
- `frontend`: painel React/Vite
- `root`: ponto oficial de instalacao, build e execucao

## Estrutura oficial

- `package.json` na raiz, no `backend` e no `frontend`: necessario
  - a raiz orquestra os workspaces
  - cada pacote declara suas dependencias e scripts
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

Build:

```bash
npm run build
```

## Como funciona

- `npm run dev`
  - sobe o backend em `3001`
  - sobe o frontend Vite em `500`
  - o frontend usa proxy para `/api`, `/health` e `/socket.io`
- `npm start`
  - sobe o backend pelo script da raiz
  - carrega `backend/.env`
  - nao precisa `live-server`

## Ambiente

- desenvolvimento local usa `backend/.env`
- producao na VM tambem usa `backend/.env`
- como esse arquivo nao guarda segredos hoje, ele pode ficar versionado no projeto

## VM Linux

Dependencias minimas:

```bash
sudo apt update
sudo apt install -y chromium
```

Deploy padrao:

```bash
npm install
npm run build
sudo systemctl daemon-reload
sudo systemctl restart maturador.service
```

Apos atualizar o codigo na VM:

```bash
git pull
npm install
npm run build
sudo systemctl restart maturador.service
```

## systemd

O `maturador.service` faz o papel de gerente de processo da VM, no mesmo estilo operacional do PM2:

- sobe o sistema
- reinicia se cair
- aceita `start`, `stop`, `restart` e `status`

Crie `/etc/systemd/system/maturador.service` com este conteudo:

```ini
[Unit]
Description=Maturador AJCred
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/maturador-ajcred
ExecStart=/usr/bin/node /opt/maturador-ajcred/backend/src/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Garanta que `backend/.env` exista dentro do projeto com:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
SERVE_FRONTEND=true
DAILY_RESET_TIMEZONE=America/Manaus
# WHATSAPP_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
```

Instalacao sugerida na VM:

```bash
sudo editor /etc/systemd/system/maturador.service
sudo systemctl daemon-reload
sudo systemctl enable --now maturador.service
```

O servico roda pela raiz do projeto:

- `WorkingDirectory=/opt/maturador-ajcred`
- `ExecStart=/usr/bin/node /opt/maturador-ajcred/backend/src/server.js`

## Validacao na VM

Conferir o unit file realmente carregado:

```bash
systemctl cat maturador.service
systemctl status maturador.service
```

Se ainda aparecer `vm:prod`, o `systemd` continua com configuracao antiga e precisa de `daemon-reload` ou de limpeza de override.

Logs do servico:

```bash
journalctl -u maturador.service -n 100 --no-pager
```

Health check local da VM:

```bash
curl http://127.0.0.1:3001/health
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
- para investigar quedas do processo, filtre na tela de logs por `"[Diag][PhoneInit]"` e `"[Diag][Supervisor]"`
- em producao, nao use `FRONTEND_URL`; o frontend integrado usa mesma origem
- se `backend/.env` mudar, depois do `git pull` rode `sudo systemctl restart maturador.service`

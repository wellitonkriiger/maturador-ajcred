# maturador-ajcred

Backend Node.js + frontend Vite para gerenciar sessoes de WhatsApp e o fluxo de maturacao.

## Suporte oficial

- `Windows`: desenvolvimento local
- `Debian 12`: producao

## Runtime do navegador

O backend valida o browser no startup e expoe o diagnostico em `/health`.

Prioridade de resolucao do executavel:

1. `WHATSAPP_BROWSER_EXECUTABLE_PATH`
2. `PUPPETEER_EXECUTABLE_PATH`
3. `CHROME_PATH`
4. Chrome/Chromium do sistema
5. Browser gerenciado pelo Puppeteer

Quando o browser nao esta utilizavel, o backend sobe em modo degradado:

- painel, CRUD, logs e plano continuam funcionando
- `conectar`, `reconectar` e `qrcode` retornam `503`
- `/health` responde `status: "degraded"` com o diagnostico

## Variaveis de ambiente

Use [backend/.env](/c:/Users/03081055245/Documents/maturador-ajcred/backend/.env) como base.

Principais variaveis:

- `PORT`
- `HOST`
- `NODE_ENV`
- `SERVE_FRONTEND`
- `DAILY_RESET_TIMEZONE`
- `WHATSAPP_BROWSER_EXECUTABLE_PATH`
- `PUPPETEER_EXECUTABLE_PATH`
- `CHROME_PATH`

Portas oficiais do projeto:

- desenvolvimento: frontend Vite em `500`, backend em `3001`
- producao integrada: uma unica porta definida pelo comando/env de deploy
- o script `npm run lan` usa `PORT=500` por padrao; se a plataforma mostrar `3001`, ela esta subindo o backend por outro caminho
- para VM/producao, o comando recomendado agora e `npm run vm:prod`

## Inicializacao no ambiente de desenvolvimento

Ambiente oficial de desenvolvimento: `Windows`.

1. Instale Node.js 22.
2. Instale as dependencias:

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

3. Se o Chrome nao for detectado automaticamente, edite `backend/.env` e preencha `WHATSAPP_BROWSER_EXECUTABLE_PATH`.
4. Valide o runtime do navegador:

```bash
npm run doctor:browser --prefix backend
```

5. Inicie o ambiente local:

```bash
npm run dev
```

Resumo:

- comando principal: `npm run dev`
- diagnostico do browser: `npm run doctor:browser --prefix backend`
- `npm run lan` nao e o fluxo padrao de desenvolvimento

## Inicializacao no ambiente de producao

Ambiente oficial de producao: `Debian 12`.

1. Instale Node.js 22.
2. Instale o Chromium no host:

```bash
sudo apt update
sudo apt install -y chromium
```

3. Confirme o executavel:

```bash
which chromium
```

O esperado e `/usr/bin/chromium`.

4. Atualize o projeto:

```bash
git pull origin main
```

5. Instale as dependencias:

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

6. Ajuste `backend/.env` com:

```env
WHATSAPP_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
```

7. Valide o runtime:

```bash
npm run doctor:browser --prefix backend
```

8. Inicie o sistema:

```bash
npm run vm:prod
```

Nesse fluxo, `npm run vm:prod`:

- garante `backend/.env` se ele nao existir
- instala dependencias faltantes da raiz, backend e frontend
- valida browser e runtime
- builda o frontend
- verifica se a porta configurada esta livre
- sobe o backend servindo os arquivos estaticos com `HOST=0.0.0.0`, `SERVE_FRONTEND=true` e `NODE_ENV=production`

Porta usada na VM:

- `PORT` do `backend/.env`, se existir
- `PORT` passada no ambiente ou em `--port=<porta>`, se voce quiser sobrescrever
- fallback padrao: `3001`

Se o servidor Nobre estiver mostrando `3001`, confirme antes de tudo:

- qual comando real de start esta configurado na plataforma
- qual porta interna a plataforma espera
- qual healthcheck, timeout e politica de restart foram configurados
- quais limites de memoria e CPU o container/processo recebeu

Para coletar isso do lado da aplicacao, rode:

```bash
npm run doctor:runtime
```

ou:

```bash
npm run doctor:runtime --prefix backend
```

O comando imprime:

- `process.argv`, `pid`, `ppid`, `cwd` e uptime
- `PORT`, `HOST`, `SERVE_FRONTEND`, `NODE_ENV` e variaveis de health/restart expostas no ambiente
- limites de memoria/CPU detectados via cgroup quando disponiveis
- diagnostico atual do browser e eventos recentes do processo

Para validar a VM sem iniciar o processo final:

```bash
npm run vm:prod:check
```

## Health e diagnostico

Exemplo de `/health`:

```json
{
  "status": "ok",
  "timestamp": "2026-03-09T00:00:00.000Z",
  "services": {
    "whatsappBrowser": {
      "available": true,
      "source": "system:chromium",
      "executablePath": "/usr/bin/chromium",
      "platform": "linux",
      "message": "Browser pronto (system:chromium)",
      "checkedAt": "2026-03-09T00:00:00.000Z"
    }
  }
}
```

## Comandos uteis

```bash
npm run dev
npm run build:frontend
npm run lan
npm run vm:prod
npm run vm:prod:check
npm run doctor:runtime
npm run doctor:browser --prefix backend
node backend/src/tests/12-whatsapp-status-guard.js
node backend/src/tests/13-auto-salvar-contato.js
node backend/src/tests/14-browser-runtime.js
node backend/src/tests/15-browser-runtime-guard.js
node backend/src/tests/16-runtime-diagnostics.js
```

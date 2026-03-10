#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const backendEnvPath = path.join(backendDir, '.env');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmExecPath = process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)
  ? process.env.npm_execpath
  : null;

function log(message) {
  console.log(`[vm:prod] ${message}`);
}

function fail(message) {
  console.error(`[vm:prod] ERRO: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = {
    checkOnly: false,
    port: null
  };

  for (const arg of argv) {
    if (arg === '--check-only') {
      result.checkOnly = true;
      continue;
    }

    if (arg.startsWith('--port=')) {
      result.port = arg.slice('--port='.length).trim();
      continue;
    }
  }

  return result;
}

function parseDotEnv(content) {
  const parsed = {};

  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function ensureBackendEnvFile() {
  if (fs.existsSync(backendEnvPath)) {
    return false;
  }

  const defaultBrowserPath = process.platform === 'linux' ? '/usr/bin/chromium' : '';
  const content = [
    'PORT=3001',
    'HOST=0.0.0.0',
    'NODE_ENV=production',
    'SERVE_FRONTEND=true',
    'DAILY_RESET_TIMEZONE=America/Manaus',
    `WHATSAPP_BROWSER_EXECUTABLE_PATH=${defaultBrowserPath}`,
    'PUPPETEER_EXECUTABLE_PATH=',
    'CHROME_PATH=',
    ''
  ].join('\n');

  fs.writeFileSync(backendEnvPath, content, 'utf8');
  return true;
}

function loadBackendEnv() {
  if (!fs.existsSync(backendEnvPath)) {
    return {};
  }

  return parseDotEnv(fs.readFileSync(backendEnvPath, 'utf8'));
}

function normalizePort(rawPort) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail(`PORT invalida: ${rawPort}`);
  }
  return String(port);
}

function buildProductionEnv(args, fileEnv) {
  const port = normalizePort(args.port || process.env.PORT || fileEnv.PORT || '3001');
  const browserPath = process.env.WHATSAPP_BROWSER_EXECUTABLE_PATH
    || fileEnv.WHATSAPP_BROWSER_EXECUTABLE_PATH
    || (process.platform === 'linux' ? '/usr/bin/chromium' : '');

  return {
    ...process.env,
    ...fileEnv,
    PORT: port,
    HOST: '0.0.0.0',
    NODE_ENV: 'production',
    SERVE_FRONTEND: 'true',
    DAILY_RESET_TIMEZONE: process.env.DAILY_RESET_TIMEZONE || fileEnv.DAILY_RESET_TIMEZONE || 'America/Manaus',
    WHATSAPP_BROWSER_EXECUTABLE_PATH: browserPath,
    PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || fileEnv.PUPPETEER_EXECUTABLE_PATH || '',
    CHROME_PATH: process.env.CHROME_PATH || fileEnv.CHROME_PATH || ''
  };
}

function runCommand(command, args, options = {}) {
  const { cwd = rootDir, env = process.env, label = `${command} ${args.join(' ')}` } = options;
  log(`Executando: ${label}`);

  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit'
  });

  if (result.error) {
    fail(`Falha ao executar ${label}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runNpmCommand(args, options = {}) {
  if (npmExecPath) {
    return runCommand(process.execPath, [npmExecPath, ...args], {
      ...options,
      label: options.label || `npm ${args.join(' ')}`
    });
  }

  return runCommand(npmCmd, args, {
    ...options,
    label: options.label || `${npmCmd} ${args.join(' ')}`
  });
}

function checkPortAvailability(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });

    server.once('listening', () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(true);
      });
    });

    server.listen({
      host: '0.0.0.0',
      port: Number(port),
      exclusive: true
    });
  });
}

function printSummary(env) {
  log('Resumo de execucao:');
  log(`PORT=${env.PORT}`);
  log(`HOST=${env.HOST}`);
  log(`NODE_ENV=${env.NODE_ENV}`);
  log(`SERVE_FRONTEND=${env.SERVE_FRONTEND}`);
  log(`DAILY_RESET_TIMEZONE=${env.DAILY_RESET_TIMEZONE}`);
  log(`WHATSAPP_BROWSER_EXECUTABLE_PATH=${env.WHATSAPP_BROWSER_EXECUTABLE_PATH || '(auto)'}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const createdEnvFile = ensureBackendEnvFile();
  if (createdEnvFile) {
    log(`Arquivo criado automaticamente: ${backendEnvPath}`);
  }

  const fileEnv = loadBackendEnv();
  const productionEnv = buildProductionEnv(args, fileEnv);

  printSummary(productionEnv);

  runCommand(process.execPath, [path.join(rootDir, 'scripts', 'ensure-deps.js')], {
    env: productionEnv,
    label: 'node scripts/ensure-deps.js'
  });
  runNpmCommand(['run', 'doctor:browser', '--prefix', 'backend'], {
    env: productionEnv
  });
  runNpmCommand(['run', 'doctor:runtime', '--prefix', 'backend'], {
    env: productionEnv
  });
  runNpmCommand(['run', 'build:frontend'], {
    env: productionEnv
  });

  const portFree = await checkPortAvailability(productionEnv.PORT);
  if (!portFree) {
    fail(`A porta ${productionEnv.PORT} ja esta em uso. Pare o processo atual ou rode com --port=<nova_porta>.`);
  }

  if (args.checkOnly) {
    log('Preflight concluido com sucesso. Nenhum processo foi iniciado por causa do --check-only.');
    return;
  }

  log('Iniciando backend integrado para a VM...');
  const childCommand = npmExecPath ? process.execPath : npmCmd;
  const childArgs = npmExecPath
    ? [npmExecPath, 'run', 'start', '--prefix', 'backend']
    : ['run', 'start', '--prefix', 'backend'];
  const child = spawn(childCommand, childArgs, {
    cwd: rootDir,
    env: productionEnv,
    stdio: 'inherit'
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('error', (error) => {
    fail(`Falha ao iniciar o backend: ${error.message}`);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  fail(error.stack || error.message);
});

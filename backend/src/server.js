require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const cron = require('node-cron');

const logger = require('./utils/logger');
const routes = require('./routes');
const TelefoneModel = require('./models/Telefone');
const WhatsAppService = require('./services/whatsappService');
const HealthMonitor = require('./services/healthMonitor');
const RealtimeService = require('./services/realtimeService');
const BrowserRuntimeService = require('./services/browserRuntimeService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

app.use('/api', routes);

app.get('/health', (req, res) => {
  const health = BrowserRuntimeService.getServiceHealth();
  res.json({
    status: health.status,
    timestamp: new Date().toISOString(),
    services: health.services
  });
});

const SERVE_FRONTEND = ['1', 'true', 'yes'].includes(
  String(process.env.SERVE_FRONTEND || '').toLowerCase()
);

if (SERVE_FRONTEND) {
  const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
  const indexFilePath = path.join(frontendDistPath, 'index.html');

  if (fs.existsSync(indexFilePath)) {
    app.use(express.static(frontendDistPath));

    app.get('*', (req, res, next) => {
      if (
        req.path === '/health' ||
        req.path === '/api' ||
        req.path.startsWith('/api/') ||
        req.path.startsWith('/socket.io')
      ) {
        return next();
      }

      return res.sendFile(indexFilePath);
    });

    logger.info(`[Frontend] Arquivos estaticos servidos de: ${frontendDistPath}`);
  } else {
    logger.warn(`[Frontend] SERVE_FRONTEND=true, mas index.html nao encontrado em ${indexFilePath}`);
  }
}

io.on('connection', (socket) => {
  logger.debug(`[Socket.IO] Painel conectado: ${socket.id}`);

  socket.on('disconnect', (reason) => {
    logger.debug(`[Socket.IO] Painel desconectado: ${socket.id} (${reason})`);
  });
});

app.set('io', io);
RealtimeService.setIO(io);

const DAILY_RESET_TIMEZONE = process.env.DAILY_RESET_TIMEZONE || 'America/Manaus';
let shutdownInFlight = false;

cron.schedule('0 0 * * *', () => {
  logger.info('Resetando contadores diarios...');
  TelefoneModel.resetarContadoresDiarios({ motivo: 'cron_meia_noite' });
}, {
  timezone: DAILY_RESET_TIMEZONE
});

cron.schedule('* * * * *', () => {
  TelefoneModel.garantirResetDiario('cron_check_minuto');
}, {
  timezone: DAILY_RESET_TIMEZONE
});

app.use((err, req, res, next) => {
  logger.error('Erro nao tratado:', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

async function handleShutdownSignal(signal) {
  if (shutdownInFlight) {
    logger.warn(`${signal} ignorado porque o shutdown ja esta em andamento`);
    return;
  }

  shutdownInFlight = true;
  logger.info(`${signal} recebido. Encerrando gracefully...`);
  HealthMonitor.stop();
  WhatsAppService.stopKeepAlive();
  await WhatsAppService.desconectarTodos();

  server.close(() => {
    logger.info('Servidor encerrado');
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  handleShutdownSignal('SIGTERM').catch((error) => {
    logger.error(`Falha durante shutdown SIGTERM: ${error.message}`);
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  handleShutdownSignal('SIGINT').catch((error) => {
    logger.error(`Falha durante shutdown SIGINT: ${error.message}`);
    process.exit(1);
  });
});

const EXPECTED_PUPPETEER_ERRORS = [
  'Execution context was destroyed',
  'Target closed',
  'Session closed',
  'Protocol error',
  'detached Frame',
  'Navigation failed'
];

process.on('unhandledRejection', (reason) => {
  const message = reason?.message ?? String(reason);
  if (EXPECTED_PUPPETEER_ERRORS.some((entry) => message.includes(entry))) {
    logger.warn(`[Guard] Erro Puppeteer capturado (nao fatal): ${message.split('\n')[0]}`);
    return;
  }

  logger.error(`[Guard] unhandledRejection nao tratada: ${message}`);
});

process.on('uncaughtException', (error) => {
  const message = error?.message ?? String(error);
  if (EXPECTED_PUPPETEER_ERRORS.some((entry) => message.includes(entry))) {
    logger.warn(`[Guard] Exception Puppeteer capturada (nao fatal): ${message.split('\n')[0]}`);
    return;
  }

  logger.error(`[Guard] uncaughtException: ${message}`);
  logger.error(error.stack);
  process.exit(1);
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

WhatsAppService.reconciliarStatusPersistido();

function startHttpServer() {
  server.listen(PORT, HOST, () => {
    WhatsAppService.startKeepAlive();
    HealthMonitor.start(WhatsAppService);
    logger.info(`Servidor rodando na porta ${PORT}`);
    logger.info(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Health check: http://localhost:${PORT}/health`);
    logger.info(`API: http://localhost:${PORT}/api`);
  });
}

BrowserRuntimeService.validateBrowserRuntime({ force: true })
  .then((diagnosis) => {
    if (diagnosis.available) {
      logger.info(`[BrowserRuntime] ${diagnosis.message} -> ${diagnosis.executablePath}`);
    } else {
      logger.warn(`[BrowserRuntime] ${diagnosis.message}`);
    }

    startHttpServer();
  })
  .catch((error) => {
    logger.error(`[Startup] Falha ao validar runtime do navegador: ${error.message}`);
    startHttpServer();
  });

module.exports = { app, server, io };

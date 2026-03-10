// src/server.js

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
const RuntimeDiagnosticsService = require('./services/runtimeDiagnosticsService');

// Criar app Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging de requisições
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Rotas
app.use('/api', routes);

// Rota de health check
app.get('/health', (req, res) => {
  const health = BrowserRuntimeService.getServiceHealth();
  const now = Date.now();
  if (lastHealthStatus !== health.status || now - lastHealthDiagnosticAt >= 15000) {
    lastHealthStatus = health.status;
    lastHealthDiagnosticAt = now;
    RuntimeDiagnosticsService.record('http', 'health_response', {
      status: health.status,
      ip: req.ip,
      userAgent: req.get('user-agent') || null
    });
  }
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
    logger.warn(
      `[Frontend] SERVE_FRONTEND=true, mas index.html nao encontrado em ${indexFilePath}`
    );
  }
}

// WebSocket para atualizações em tempo real
io.on('connection', (socket) => {
  logger.debug(`[Socket.IO] Painel conectado: ${socket.id}`);

  socket.on('disconnect', (reason) => {
    logger.debug(`[Socket.IO] Painel desconectado: ${socket.id} (${reason})`);
  });
});

// Exportar io para uso em outros módulos
app.set('io', io);
RealtimeService.setIO(io);

const DAILY_RESET_TIMEZONE = process.env.DAILY_RESET_TIMEZONE || 'America/Manaus';
let shutdownInFlight = false;
let lastHealthDiagnosticAt = 0;
let lastHealthStatus = null;

// Cron job: Resetar contadores diários à meia-noite
cron.schedule('0 0 * * *', () => {
  logger.info('🔄 Resetando contadores diários...');
  TelefoneModel.resetarContadoresDiarios({ motivo: 'cron_meia_noite' });
}, {
  timezone: DAILY_RESET_TIMEZONE
});

// Fallback: garante reset na virada de dia mesmo que o processo tenha perdido o gatilho.
cron.schedule('* * * * *', () => {
  TelefoneModel.garantirResetDiario('cron_check_minuto');
}, {
  timezone: DAILY_RESET_TIMEZONE
});

// Tratamento de erros
app.use((err, req, res, next) => {
  logger.error('Erro não tratado:', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// Graceful shutdown
async function handleShutdownSignal(signal) {
  if (shutdownInFlight) {
    logger.warn(`[RuntimeDoctor] ${signal} ignorado porque o shutdown ja esta em andamento`);
    return;
  }
  shutdownInFlight = true;
  RuntimeDiagnosticsService.record('server', 'signal_received', {
    signal,
    browserRuntime: BrowserRuntimeService.getDiagnosis()
  });
  logger.warn(
    `[RuntimeDoctor] ${signal} context ${RuntimeDiagnosticsService.toLogString(
      RuntimeDiagnosticsService.getSignalLogContext(signal, {
        browserRuntime: BrowserRuntimeService.getDiagnosis(),
        health: BrowserRuntimeService.getServiceHealth()
      })
    )}`
  );
  logger.info(`⏹️ ${signal} recebido. Encerrando gracefully...`);
  HealthMonitor.stop();
  await WhatsAppService.desconectarTodos();

  server.close(() => {
    RuntimeDiagnosticsService.record('server', 'shutdown_complete', { signal });
    logger.info(
      `[RuntimeDoctor] Shutdown complete ${RuntimeDiagnosticsService.toLogString({
        signal,
        uptimeSec: Math.round(process.uptime())
      })}`
    );
    logger.info('✅ Servidor encerrado');
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  handleShutdownSignal('SIGTERM').catch((error) => {
    logger.error(`[RuntimeDoctor] Falha durante shutdown SIGTERM: ${error.message}`);
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  handleShutdownSignal('SIGINT').catch((error) => {
    logger.error(`[RuntimeDoctor] Falha durante shutdown SIGINT: ${error.message}`);
    process.exit(1);
  });
});

// ─── GUARD GLOBAL CONTRA CRASHES ─────────────────────────────────────────────
// Impede que erros internos do Puppeteer/whatsapp-web.js derrubem o processo.
// Erros de contexto destruido sao esperados quando um telefone bane ou desconecta.
const ERROS_PUPPETEER_ESPERADOS = [
  'Execution context was destroyed',
  'Target closed',
  'Session closed',
  'Protocol error',
  'detached Frame',
  'Navigation failed'
];

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message ?? String(reason);
  if (ERROS_PUPPETEER_ESPERADOS.some(e => msg.includes(e))) {
    logger.warn(`[Guard] Erro Puppeteer capturado (nao fatal): ${msg.split('\n')[0]}`);
    return; // nao derruba o processo
  }
  RuntimeDiagnosticsService.record('server', 'unhandled_rejection', { message: msg });
  logger.error(
    `[RuntimeDoctor] unhandledRejection context ${RuntimeDiagnosticsService.toLogString(
      RuntimeDiagnosticsService.getSignalLogContext('unhandledRejection', {
        reason: msg
      })
    )}`
  );
  logger.error(`[Guard] unhandledRejection nao tratada: ${msg}`);
  // Para outros erros nao esperados, loga mas ainda nao derruba
  // Se quiser comportamento padrao Node.js, descomente a linha abaixo:
  // process.exit(1);
});

process.on('uncaughtException', (err) => {
  const msg = err?.message ?? String(err);
  if (ERROS_PUPPETEER_ESPERADOS.some(e => msg.includes(e))) {
    logger.warn(`[Guard] Exception Puppeteer capturada (nao fatal): ${msg.split('\n')[0]}`);
    return;
  }
  RuntimeDiagnosticsService.record('server', 'uncaught_exception', { message: msg });
  logger.error(
    `[RuntimeDoctor] uncaughtException context ${RuntimeDiagnosticsService.toLogString(
      RuntimeDiagnosticsService.getSignalLogContext('uncaughtException', {
        error: msg
      })
    )}`
  );
  logger.error(`[Guard] uncaughtException: ${msg}`);
  logger.error(err.stack);
  // Erros verdadeiramente inesperados encerram o processo
  process.exit(1);
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

WhatsAppService.reconciliarStatusPersistido();

function startHttpServer() {
  server.listen(PORT, HOST, () => {
    HealthMonitor.start(WhatsAppService);
    RuntimeDiagnosticsService.record('server', 'listening', {
      port: PORT,
      host: HOST,
      serveFrontend: SERVE_FRONTEND,
      nodeEnv: process.env.NODE_ENV || 'development'
    });
    logger.info(
      `[RuntimeDoctor] Startup context ${RuntimeDiagnosticsService.toLogString(
        RuntimeDiagnosticsService.getStartupLogContext({
          port: PORT,
          host: HOST,
          serveFrontend: SERVE_FRONTEND,
          nodeEnv: process.env.NODE_ENV || 'development'
        })
      )}`
    );
    logger.info(`🚀 Servidor rodando na porta ${PORT}`);
    logger.info(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`🌐 Health check: http://localhost:${PORT}/health`);
    logger.info(`📡 API: http://localhost:${PORT}/api`);
  });
}

BrowserRuntimeService.validateBrowserRuntime({ force: true })
  .then((diagnosis) => {
    RuntimeDiagnosticsService.record('server', 'browser_runtime_validated', diagnosis);
    if (diagnosis.available) {
      logger.info(`[BrowserRuntime] ${diagnosis.message} -> ${diagnosis.executablePath}`);
    } else {
      logger.warn(`[BrowserRuntime] ${diagnosis.message}`);
    }

    logger.info(
      `[RuntimeDoctor] Browser diagnosis ${RuntimeDiagnosticsService.toLogString({
        available: diagnosis.available,
        source: diagnosis.source,
        executablePath: diagnosis.executablePath,
        message: diagnosis.message
      })}`
    );

    startHttpServer();
  })
  .catch((error) => {
    RuntimeDiagnosticsService.record('server', 'browser_runtime_validation_failed', {
      message: error.message
    });
    logger.error(`[Startup] Falha ao validar runtime do navegador: ${error.message}`);
    startHttpServer();
  });

module.exports = { app, server, io };

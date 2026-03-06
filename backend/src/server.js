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
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString() 
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
process.on('SIGTERM', async () => {
  logger.info('⏹️ SIGTERM recebido. Encerrando gracefully...');
  HealthMonitor.stop();
  await WhatsAppService.desconectarTodos();
  
  server.close(() => {
    logger.info('✅ Servidor encerrado');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('⏹️ SIGINT recebido. Encerrando gracefully...');
  HealthMonitor.stop();
  await WhatsAppService.desconectarTodos();
  
  server.close(() => {
    logger.info('✅ Servidor encerrado');
    process.exit(0);
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
  logger.error(`[Guard] uncaughtException: ${msg}`);
  logger.error(err.stack);
  // Erros verdadeiramente inesperados encerram o processo
  process.exit(1);
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  HealthMonitor.start(WhatsAppService);
  logger.info(`🚀 Servidor rodando na porta ${PORT}`);
  logger.info(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🌐 Health check: http://localhost:${PORT}/health`);
  logger.info(`📡 API: http://localhost:${PORT}/api`);
});

module.exports = { app, server, io };

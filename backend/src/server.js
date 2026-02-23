// src/server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const cron = require('node-cron');

const logger = require('./utils/logger');
const routes = require('./routes');
const TelefoneModel = require('./models/Telefone');
const WhatsAppService = require('./services/whatsappService');

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

// WebSocket para atualizações em tempo real
io.on('connection', (socket) => {
  logger.info(`🔌 Cliente conectado: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`🔌 Cliente desconectado: ${socket.id}`);
  });
});

// Exportar io para uso em outros módulos
app.set('io', io);

// Cron job: Resetar contadores diários à meia-noite
cron.schedule('0 0 * * *', () => {
  logger.info('🔄 Resetando contadores diários...');
  TelefoneModel.resetarContadoresDiarios();
});

// Tratamento de erros
app.use((err, req, res, next) => {
  logger.error('Erro não tratado:', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('⏹️ SIGTERM recebido. Encerrando gracefully...');
  
  await WhatsAppService.desconectarTodos();
  
  server.close(() => {
    logger.info('✅ Servidor encerrado');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('⏹️ SIGINT recebido. Encerrando gracefully...');
  
  await WhatsAppService.desconectarTodos();
  
  server.close(() => {
    logger.info('✅ Servidor encerrado');
    process.exit(0);
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  logger.info(`🚀 Servidor rodando na porta ${PORT}`);
  logger.info(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🌐 Health check: http://localhost:${PORT}/health`);
  logger.info(`📡 API: http://localhost:${PORT}/api`);
});

module.exports = { app, server, io };
// src/utils/logger.js

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const RealtimeService = require('../services/realtimeService');

// Criar diretório de logs se não existir
const logsDir = path.join(__dirname, '../../data/logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'maturador-ajcred' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// Console em desenvolvimento
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} [${level}] ${message}`;
      })
    )
  }));
}

const LEVELS_TO_STREAM = new Set(['info', 'warn', 'error', 'debug']);

for (const level of LEVELS_TO_STREAM) {
  const original = logger[level].bind(logger);
  logger[level] = (...args) => {
    const result = original(...args);
    const [message, meta] = args;
    RealtimeService.emitLog({
      timestamp: new Date().toISOString(),
      level,
      message: message instanceof Error ? message.message : String(message),
      meta: meta && typeof meta === 'object' ? meta : null
    });
    return result;
  };
}

module.exports = logger;

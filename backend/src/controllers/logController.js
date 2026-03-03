const LogService = require('../services/logService');
const logger = require('../utils/logger');

class LogController {
  async listarArquivos(req, res) {
    try {
      res.json(LogService.listFiles());
    } catch (error) {
      logger.error('Erro ao listar arquivos de log:', error);
      res.status(500).json({ erro: 'Erro ao listar arquivos de log' });
    }
  }

  async listar(req, res) {
    try {
      const { file, limit, level, search } = req.query;
      res.json(LogService.read({ file, limit, level, search }));
    } catch (error) {
      logger.error('Erro ao ler logs:', error);
      res.status(500).json({ erro: 'Erro ao ler logs' });
    }
  }
}

module.exports = new LogController();

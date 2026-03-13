const TelefoneModel = require('../models/Telefone');
const MaturacaoService = require('../services/maturacaoService');
const logger = require('../utils/logger');
const { buildHealthPayload } = require('../utils/healthPayload');

class PainelController {
  async snapshot(req, res) {
    try {
      res.json({
        telefones: TelefoneModel.listar(),
        maturacaoStatus: MaturacaoService.getStatus(),
        conversasAtivas: MaturacaoService.getConversasAtivas(),
        health: buildHealthPayload()
      });
    } catch (error) {
      logger.error('Erro ao obter snapshot do painel:', error);
      res.status(500).json({ erro: 'Erro ao obter snapshot do painel' });
    }
  }
}

module.exports = new PainelController();

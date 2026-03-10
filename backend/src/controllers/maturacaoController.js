// src/controllers/maturacaoController.js

const MaturacaoService = require('../services/maturacaoService');
const PlanoMaturacaoModel = require('../models/PlanoMaturacao');
const logger = require('../utils/logger');

class MaturacaoController {
  async status(req, res) {
    try {
      const status = MaturacaoService.getStatus();
      res.json(status);
    } catch (error) {
      logger.error('Erro ao obter status:', error);
      res.status(500).json({ erro: 'Erro ao obter status' });
    }
  }

  async iniciar(req, res) {
    try {
      const sucesso = await MaturacaoService.iniciar();
      if (!sucesso) {
        return res.status(400).json({ erro: 'Nao foi possivel iniciar maturacao' });
      }

      res.json({ mensagem: 'Maturacao iniciada com sucesso' });
    } catch (error) {
      logger.error('Erro ao iniciar maturacao:', error);
      res.status(500).json({ erro: 'Erro ao iniciar maturacao' });
    }
  }

  async parar(req, res) {
    try {
      const sucesso = MaturacaoService.parar();
      if (!sucesso) {
        return res.status(400).json({ erro: 'Maturacao nao esta em execucao' });
      }

      res.json({ mensagem: 'Maturacao pausada com sucesso' });
    } catch (error) {
      logger.error('Erro ao parar maturacao:', error);
      res.status(500).json({ erro: 'Erro ao parar maturacao' });
    }
  }

  async obterPlano(req, res) {
    try {
      const plano = PlanoMaturacaoModel.obter();
      res.json(plano);
    } catch (error) {
      logger.error('Erro ao obter plano:', error);
      res.status(500).json({ erro: 'Erro ao obter plano' });
    }
  }

  async atualizarPlano(req, res) {
    try {
      if (MaturacaoService.emExecucao) {
        return res.status(409).json({ erro: 'Pause a maturacao antes de alterar o plano' });
      }

      const plano = PlanoMaturacaoModel.atualizar(req.body);
      res.json(plano);
    } catch (error) {
      logger.error('Erro ao atualizar plano:', error);
      res.status(500).json({ erro: 'Erro ao atualizar plano' });
    }
  }

  async togglePlano(req, res) {
    try {
      if (MaturacaoService.emExecucao) {
        return res.status(409).json({ erro: 'Pause a maturacao antes de alterar o plano' });
      }

      const { ativo } = req.body;
      const plano = PlanoMaturacaoModel.setAtivo(ativo);
      res.json(plano);
    } catch (error) {
      logger.error('Erro ao ativar/desativar plano:', error);
      res.status(500).json({ erro: 'Erro ao ativar/desativar plano' });
    }
  }

  async conversasAtivas(req, res) {
    try {
      const ativas = MaturacaoService.getConversasAtivas();
      res.json(ativas);
    } catch (error) {
      logger.error('Erro ao obter conversas ativas:', error);
      res.status(500).json({ erro: 'Erro ao obter conversas ativas' });
    }
  }
}

module.exports = new MaturacaoController();

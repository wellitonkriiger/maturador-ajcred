// src/controllers/maturacaoController.js

const MaturacaoService = require('../services/maturacaoService');
const PlanoMaturacaoModel = require('../models/PlanoMaturacao');
const logger = require('../utils/logger');

class MaturacaoController {
  /**
   * Obtém status da maturação
   */
  async status(req, res) {
    try {
      const status = MaturacaoService.getStatus();
      res.json(status);
    } catch (error) {
      logger.error('Erro ao obter status:', error);
      res.status(500).json({ erro: 'Erro ao obter status' });
    }
  }

  /**
   * Inicia maturação
   */
  async iniciar(req, res) {
    try {
      const sucesso = await MaturacaoService.iniciar();
      
      if (!sucesso) {
        return res.status(400).json({ erro: 'Não foi possível iniciar maturação' });
      }

      res.json({ mensagem: 'Maturação iniciada com sucesso' });
    } catch (error) {
      logger.error('Erro ao iniciar maturação:', error);
      res.status(500).json({ erro: 'Erro ao iniciar maturação' });
    }
  }

  /**
   * Para maturação
   */
  async parar(req, res) {
    try {
      const sucesso = MaturacaoService.parar();
      
      if (!sucesso) {
        return res.status(400).json({ erro: 'Maturação não está em execução' });
      }

      res.json({ mensagem: 'Maturação pausada com sucesso' });
    } catch (error) {
      logger.error('Erro ao parar maturação:', error);
      res.status(500).json({ erro: 'Erro ao parar maturação' });
    }
  }

  /**
   * Obtém plano de maturação
   */
  async obterPlano(req, res) {
    try {
      const plano = PlanoMaturacaoModel.obter();
      res.json(plano);
    } catch (error) {
      logger.error('Erro ao obter plano:', error);
      res.status(500).json({ erro: 'Erro ao obter plano' });
    }
  }

  /**
   * Atualiza plano de maturação
   */
  async atualizarPlano(req, res) {
    try {
      const dados = req.body;
      const plano = PlanoMaturacaoModel.atualizar(dados);
      
      res.json(plano);
    } catch (error) {
      logger.error('Erro ao atualizar plano:', error);
      res.status(500).json({ erro: 'Erro ao atualizar plano' });
    }
  }

  /**
   * Ativa/desativa plano
   */
  async togglePlano(req, res) {
    try {
      const { ativo } = req.body;
      const plano = PlanoMaturacaoModel.setAtivo(ativo);
      
      res.json(plano);
    } catch (error) {
      logger.error('Erro ao ativar/desativar plano:', error);
      res.status(500).json({ erro: 'Erro ao ativar/desativar plano' });
    }
  }

  /**
   * Obtém conversas ativas
   */
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
// src/controllers/conversaController.js

const ConversaModel = require('../models/Conversa');
const logger = require('../utils/logger');

class ConversaController {
  /**
   * Lista todas as conversas
   */
  async listar(req, res) {
    try {
      const conversas = ConversaModel.listar();
      res.json(conversas);
    } catch (error) {
      logger.error('Erro ao listar conversas:', error);
      res.status(500).json({ erro: 'Erro ao listar conversas' });
    }
  }

  /**
   * Busca conversa por ID
   */
  async buscarPorId(req, res) {
    try {
      const { id } = req.params;
      const conversa = ConversaModel.buscarPorId(id);
      
      if (!conversa) {
        return res.status(404).json({ erro: 'Conversa não encontrada' });
      }

      res.json(conversa);
    } catch (error) {
      logger.error('Erro ao buscar conversa:', error);
      res.status(500).json({ erro: 'Erro ao buscar conversa' });
    }
  }

  /**
   * Importa conversa de JSON
   */
  async importar(req, res) {
    try {
      const conversaJSON = req.body;

      const conversa = ConversaModel.importar(conversaJSON);
      
      res.status(201).json(conversa);
    } catch (error) {
      logger.error('Erro ao importar conversa:', error);
      res.status(400).json({ erro: error.message });
    }
  }

  /**
   * Deleta conversa
   */
  async deletar(req, res) {
    try {
      const { id } = req.params;

      const sucesso = ConversaModel.deletar(id);
      
      if (!sucesso) {
        return res.status(404).json({ erro: 'Conversa não encontrada' });
      }

      res.json({ mensagem: 'Conversa deletada com sucesso' });
    } catch (error) {
      logger.error('Erro ao deletar conversa:', error);
      res.status(500).json({ erro: 'Erro ao deletar conversa' });
    }
  }

  /**
   * Recarrega conversas do disco
   */
  async recarregar(req, res) {
    try {
      ConversaModel.carregar();
      const conversas = ConversaModel.listar();
      
      res.json({ 
        mensagem: 'Conversas recarregadas',
        total: conversas.length
      });
    } catch (error) {
      logger.error('Erro ao recarregar conversas:', error);
      res.status(500).json({ erro: 'Erro ao recarregar conversas' });
    }
  }
}

module.exports = new ConversaController();
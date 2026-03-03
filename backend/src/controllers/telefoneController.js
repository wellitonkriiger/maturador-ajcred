// src/controllers/telefoneController.js

const QRCode = require('qrcode');
const TelefoneModel = require('../models/Telefone');
const WhatsAppService = require('../services/whatsappService');
const logger = require('../utils/logger');

class TelefoneController {
  /**
   * Lista todos os telefones
   */
  async listar(req, res) {
    try {
      const telefones = TelefoneModel.listar();
      res.json(telefones);
    } catch (error) {
      logger.error('Erro ao listar telefones:', error);
      res.status(500).json({ erro: 'Erro ao listar telefones' });
    }
  }

  /**
   * Busca telefone por ID
   */
  async buscarPorId(req, res) {
    try {
      const { id } = req.params;
      const telefone = TelefoneModel.buscarPorId(id);

      if (!telefone) {
        return res.status(404).json({ erro: 'Telefone não encontrado' });
      }

      res.json(telefone);
    } catch (error) {
      logger.error('Erro ao buscar telefone:', error);
      res.status(500).json({ erro: 'Erro ao buscar telefone' });
    }
  }

  /**
   * Cria novo telefone
   */
  async criar(req, res) {
    try {
      const { nome, podeIniciarConversa, podeReceberMensagens, quantidadeConversasDia, sensibilidade } = req.body;

      if (!nome) {
        return res.status(400).json({ erro: 'Nome é obrigatório' });
      }

      const telefone = TelefoneModel.criar({
        nome,
        podeIniciarConversa,
        podeReceberMensagens,
        quantidadeConversasDia,
        sensibilidade
      });

      res.status(201).json(telefone);
    } catch (error) {
      logger.error('Erro ao criar telefone:', error);
      res.status(500).json({ erro: 'Erro ao criar telefone' });
    }
  }

  /**
   * Atualiza telefone
   */
  async atualizar(req, res) {
    try {
      const { id } = req.params;
      const dados = req.body;

      const telefone = TelefoneModel.atualizar(id, dados);

      if (!telefone) {
        return res.status(404).json({ erro: 'Telefone não encontrado' });
      }

      res.json(telefone);
    } catch (error) {
      logger.error('Erro ao atualizar telefone:', error);
      res.status(500).json({ erro: 'Erro ao atualizar telefone' });
    }
  }

  /**
   * Deleta telefone
   */
  async deletar(req, res) {
    try {
      const { id } = req.params;

      // Destroi o cliente em qualquer estado (conectando, QR pendente, online)
      // estaConectado() retorna false durante QR — forçamos destroy direto
      await WhatsAppService.desconectarCliente(id, { removeSession: true, suppressAutoReconnect: true });

      const sucesso = TelefoneModel.deletar(id);

      if (!sucesso) {
        return res.status(404).json({ erro: 'Telefone não encontrado' });
      }

      res.json({ mensagem: 'Telefone deletado com sucesso' });
    } catch (error) {
      logger.error('Erro ao deletar telefone:', error);
      res.status(500).json({ erro: 'Erro ao deletar telefone' });
    }
  }

  /**
   * Conecta telefone ao WhatsApp
   */
  async conectar(req, res) {
    try {
      const { id } = req.params;

      const telefone = TelefoneModel.buscarPorId(id);

      if (!telefone) {
        return res.status(404).json({ erro: 'Telefone não encontrado' });
      }

      // Inicializar cliente (assíncrono, não bloqueia resposta)
      WhatsAppService.inicializarCliente(id, { allowQr: true, isReconnect: false }).catch(error => {
        logger.error(`Erro ao conectar ${id}:`, error);
      });

      res.json({
        mensagem: 'Conexão iniciada. Aguarde o QR Code.',
        telefone: TelefoneModel.buscarPorId(id)
      });
    } catch (error) {
      logger.error('Erro ao conectar telefone:', error);
      res.status(500).json({ erro: 'Erro ao conectar telefone' });
    }
  }

  /**
   * Desconecta telefone
   */
  async desconectar(req, res) {
    try {
      const { id } = req.params;

      const sucesso = await WhatsAppService.desconectarCliente(id, { removeSession: true, suppressAutoReconnect: true });

      if (!sucesso) {
        return res.status(404).json({ erro: 'Telefone não está conectado' });
      }

      res.json({ mensagem: 'Telefone desconectado com sucesso' });
    } catch (error) {
      logger.error('Erro ao desconectar telefone:', error);
      res.status(500).json({ erro: 'Erro ao desconectar telefone' });
    }
  }

  /**
   * Tenta reconectar sem QR reaproveitando a sessao salva
   */
  async reconectar(req, res) {
    try {
      const { id } = req.params;
      const telefone = TelefoneModel.buscarPorId(id);

      if (!telefone) {
        return res.status(404).json({ erro: 'Telefone nao encontrado' });
      }

      const resultado = await WhatsAppService.tentarReconectar(id);
      res.json(resultado);
    } catch (error) {
      logger.error('Erro ao reconectar telefone:', error);
      res.status(500).json({ erro: 'Erro ao reconectar telefone' });
    }
  }

  /**
   * Obtém QR Code — converte string bruta em imagem base64
   */
  async obterQRCode(req, res) {
    try {
      const { id } = req.params;

      const qrRaw = WhatsAppService.getQRCode(id);

      if (!qrRaw) {
        return res.status(404).json({ erro: 'QR Code não disponível' });
      }

      // Converte a string bruta do whatsapp-web.js em imagem base64
      const qrCode = await QRCode.toDataURL(qrRaw);

      res.json({ qrCode });
    } catch (error) {
      logger.error('Erro ao obter QR Code:', error);
      res.status(500).json({ erro: 'Erro ao obter QR Code' });
    }
  }

  /**
   * Obtém status de conexão
   */
  async statusConexao(req, res) {
    try {
      const { id } = req.params;

      const telefone = TelefoneModel.buscarPorId(id);

      if (!telefone) {
        return res.status(404).json({ erro: 'Telefone não encontrado' });
      }

      const conectado = WhatsAppService.estaConectado(id);
      const qrCode = WhatsAppService.getQRCode(id);

      res.json({
        telefone: telefone.nome,
        status: telefone.status,
        conectado,
        temQRCode: !!qrCode,
        numero: telefone.numero
      });
    } catch (error) {
      logger.error('Erro ao verificar status:', error);
      res.status(500).json({ erro: 'Erro ao verificar status' });
    }
  }
}

module.exports = new TelefoneController();

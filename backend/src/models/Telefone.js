// src/models/Telefone.js

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class TelefoneModel {
  constructor() {
    this.configFile = path.join(__dirname, '../../data/config.json');
    this.telefones = [];
    this.carregar();
  }

  /**
   * Carrega telefones do arquivo
   */
  carregar() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        const config = JSON.parse(data);
        this.telefones = config.telefones || [];
        logger.info(`📱 ${this.telefones.length} telefones carregados`);
      } else {
        this.telefones = [];
        this.salvar();
        logger.info('📱 Arquivo de configuração criado (vazio)');
      }
    } catch (error) {
      logger.error('❌ Erro ao carregar telefones:', error);
      this.telefones = [];
    }
  }

  /**
   * Salva telefones no arquivo
   */
  salvar() {
    try {
      const config = { telefones: this.telefones };
      fs.writeFileSync(
        this.configFile,
        JSON.stringify(config, null, 2),
        'utf8'
      );
      logger.debug('💾 Configuração de telefones salva');
    } catch (error) {
      logger.error('❌ Erro ao salvar telefones:', error);
    }
  }

  /**
   * Cria novo telefone
   */
  criar(dados) {
    const telefone = {
      id: `tel_${uuidv4().substring(0, 8)}`,
      nome: dados.nome,
      numero: null,
      sessionName: `session-${uuidv4().substring(0, 8)}`,
      status: 'offline',
      configuracao: {
        podeIniciarConversa: dados.podeIniciarConversa !== false,
        podeReceberMensagens: dados.podeReceberMensagens !== false,
        quantidadeConversasDia: dados.quantidadeConversasDia || 5,
        conversasRealizadasHoje: 0,
        ultimaConversaEm: null
      },
      estatisticas: {
        totalConversas: 0,
        totalMensagensEnviadas: 0,
        totalMensagensRecebidas: 0,
        diasAtivo: 0,
        ultimoBanimento: null
      },
      sensibilidade: dados.sensibilidade || 'media',
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString()
    };

    this.telefones.push(telefone);
    this.salvar();
    logger.info(`✅ Telefone criado: ${telefone.nome} (${telefone.id})`);
    
    return telefone;
  }

  /**
   * Busca telefone por ID
   */
  buscarPorId(id) {
    return this.telefones.find(t => t.id === id);
  }

  /**
   * Lista todos os telefones
   */
  listar() {
    return this.telefones;
  }

  /**
   * Atualiza telefone
   */
  atualizar(id, dados) {
    const index = this.telefones.findIndex(t => t.id === id);
    
    if (index === -1) {
      return null;
    }

    this.telefones[index] = {
      ...this.telefones[index],
      ...dados,
      atualizadoEm: new Date().toISOString()
    };

    this.salvar();
    logger.info(`♻️ Telefone atualizado: ${id}`);
    
    return this.telefones[index];
  }

  /**
   * Atualiza status do telefone
   */
  atualizarStatus(id, status, numero = null) {
    const telefone = this.buscarPorId(id);
    
    if (!telefone) {
      return null;
    }

    telefone.status = status;
    if (numero == "556992050632@c.us") {
      telefone.numero = "54335782293589@lid";
    }else if(numero == "556993731026@c.us"){
      telefone.numero = "206876360859898@lid";
    }else if(numero){
      telefone.numero = numero;
    }
    telefone.atualizadoEm = new Date().toISOString();

    this.salvar();
    logger.info(`📊 Status atualizado: ${id} → ${status}`);
    
    return telefone;
  }

  /**
   * Incrementa contador de conversas
   */
  incrementarConversas(id) {
    const telefone = this.buscarPorId(id);
    
    if (!telefone) {
      return null;
    }

    telefone.configuracao.conversasRealizadasHoje++;
    telefone.configuracao.ultimaConversaEm = new Date().toISOString();
    telefone.estatisticas.totalConversas++;

    this.salvar();
    
    return telefone;
  }

  /**
   * Incrementa mensagens enviadas
   */
  incrementarMensagensEnviadas(id, quantidade = 1) {
    const telefone = this.buscarPorId(id);
    
    if (!telefone) {
      return null;
    }

    telefone.estatisticas.totalMensagensEnviadas += quantidade;
    this.salvar();
    
    return telefone;
  }

  /**
   * Incrementa mensagens recebidas
   */
  incrementarMensagensRecebidas(id, quantidade = 1) {
    const telefone = this.buscarPorId(id);
    
    if (!telefone) {
      return null;
    }

    telefone.estatisticas.totalMensagensRecebidas += quantidade;
    this.salvar();
    
    return telefone;
  }

  /**
   * Reseta contadores diários (executar à meia-noite)
   */
  resetarContadoresDiarios() {
    this.telefones.forEach(telefone => {
      telefone.configuracao.conversasRealizadasHoje = 0;
    });

    this.salvar();
    logger.info('🔄 Contadores diários resetados');
  }

  /**
   * Deleta telefone
   */
  deletar(id) {
    const index = this.telefones.findIndex(t => t.id === id);
    
    if (index === -1) {
      return false;
    }

    this.telefones.splice(index, 1);
    this.salvar();
    logger.info(`🗑️ Telefone deletado: ${id}`);
    
    return true;
  }

  /**
   * Busca telefones online
   */
  buscarOnline() {
    return this.telefones.filter(t => t.status === 'online');
  }

  /**
   * Busca telefones disponíveis para conversa
   */
  buscarDisponiveis() {
    return this.telefones.filter(t => {
      return (
        t.status === 'online' &&
        t.configuracao.conversasRealizadasHoje < t.configuracao.quantidadeConversasDia
      );
    });
  }
}

module.exports = new TelefoneModel();
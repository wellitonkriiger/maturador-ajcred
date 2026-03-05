const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger');
const RealtimeService = require('../services/realtimeService');

class TelefoneModel {
  constructor() {
    this.configFile = path.join(__dirname, '../../data/config.json');
    this.telefones = [];
    this.carregar();
  }

  carregar() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        const config = JSON.parse(data);
        this.telefones = config.telefones || [];
        logger.info(`${this.telefones.length} telefones carregados`);
      } else {
        this.telefones = [];
        this.salvar();
        logger.info('Arquivo de configuracao criado (vazio)');
      }
    } catch (error) {
      logger.error('Erro ao carregar telefones:', error);
      this.telefones = [];
    }
  }

  salvar() {
    try {
      const config = { telefones: this.telefones };
      fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf8');
      logger.debug('Configuracao de telefones salva');
    } catch (error) {
      logger.error('Erro ao salvar telefones:', error);
    }
  }

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
        ultimaConversaEm: null,
        proximaConversaDisponivelEm: null
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
    logger.info(`Telefone criado: ${telefone.nome} (${telefone.id})`);
    RealtimeService.emitTelefoneStatus(telefone);
    return telefone;
  }

  buscarPorId(id) {
    return this.telefones.find(item => item.id === id) ?? null;
  }

  listar() {
    return this.telefones;
  }

  atualizar(id, dados) {
    const index = this.telefones.findIndex(item => item.id === id);
    if (index === -1) return null;

    this.telefones[index] = {
      ...this.telefones[index],
      ...dados,
      atualizadoEm: new Date().toISOString()
    };

    this.salvar();
    logger.info(`Telefone atualizado: ${id}`);
    RealtimeService.emitTelefoneStatus(this.telefones[index]);
    return this.telefones[index];
  }

  atualizarStatus(id, status, numero = null) {
    const telefone = this.buscarPorId(id);
    if (!telefone) return null;

    telefone.status = status;
    if (numero) {
      telefone.numero = numero;
    }
    telefone.atualizadoEm = new Date().toISOString();

    this.salvar();
    logger.info(`Status atualizado: ${id} -> ${status}`);
    RealtimeService.emitTelefoneStatus(telefone);
    return telefone;
  }

  incrementarConversas(id, opcoes = {}) {
    const telefone = this.buscarPorId(id);
    if (!telefone) return null;

    const {
      proximaConversaDisponivelEm = null
    } = opcoes;

    telefone.configuracao.conversasRealizadasHoje++;
    telefone.configuracao.ultimaConversaEm = new Date().toISOString();
    telefone.configuracao.proximaConversaDisponivelEm = proximaConversaDisponivelEm;
    telefone.estatisticas.totalConversas++;
    this.salvar();
    RealtimeService.emitTelefoneStatus(telefone);
    return telefone;
  }

  incrementarMensagensEnviadas(id, quantidade = 1) {
    const telefone = this.buscarPorId(id);
    if (!telefone) return null;

    telefone.estatisticas.totalMensagensEnviadas += quantidade;
    this.salvar();
    RealtimeService.emitTelefoneStatus(telefone);
    return telefone;
  }

  incrementarMensagensRecebidas(id, quantidade = 1) {
    const telefone = this.buscarPorId(id);
    if (!telefone) return null;

    telefone.estatisticas.totalMensagensRecebidas += quantidade;
    this.salvar();
    RealtimeService.emitTelefoneStatus(telefone);
    return telefone;
  }

  resetarContadoresDiarios() {
    this.telefones.forEach((telefone) => {
      telefone.configuracao.conversasRealizadasHoje = 0;
      telefone.configuracao.proximaConversaDisponivelEm = null;
      RealtimeService.emitTelefoneStatus(telefone);
    });
    this.salvar();
    logger.info('Contadores diarios resetados');
  }

  deletar(id) {
    const index = this.telefones.findIndex(item => item.id === id);
    if (index === -1) return false;

    this.telefones.splice(index, 1);
    this.salvar();
    logger.info(`Telefone deletado: ${id}`);
    RealtimeService.emit('telefone:status', { telefoneId: id, deleted: true });
    return true;
  }

  buscarOnline() {
    return this.telefones.filter(item => item.status === 'online');
  }

  buscarDisponiveis() {
    return this.telefones.filter(item =>
      item.status === 'online' &&
      item.configuracao.conversasRealizadasHoje < item.configuracao.quantidadeConversasDia
    );
  }
}

module.exports = new TelefoneModel();

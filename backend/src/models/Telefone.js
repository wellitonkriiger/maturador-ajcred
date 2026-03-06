const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger');
const RealtimeService = require('../services/realtimeService');

class TelefoneModel {
  constructor() {
    this.configFile = path.join(__dirname, '../../data/config.json');
    this.telefones = [];
    this.controleDiario = { ultimoDiaReset: null };
    this.carregar();
  }

  carregar() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        const config = JSON.parse(data);
        this.telefones = config.telefones || [];
        this.controleDiario = config.controleDiario || { ultimoDiaReset: null };
        this._normalizarControleDiario();
        this._garantirResetDiario('carregamento');
        logger.info(`${this.telefones.length} telefones carregados`);
      } else {
        this.telefones = [];
        this.controleDiario = { ultimoDiaReset: this._diaAtualLocal() };
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
      const config = {
        telefones: this.telefones,
        controleDiario: this.controleDiario
      };
      fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf8');
      logger.debug('Configuracao de telefones salva');
    } catch (error) {
      logger.error('Erro ao salvar telefones:', error);
    }
  }

  _diaAtualLocal() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _diaDeIso(iso) {
    if (!iso) return null;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _diaMaisRecenteComConversas() {
    let diaMaisRecente = null;

    this.telefones.forEach((telefone) => {
      const conversasHoje = Number(telefone?.configuracao?.conversasRealizadasHoje || 0);
      if (conversasHoje <= 0) return;

      const dia = this._diaDeIso(telefone?.configuracao?.ultimaConversaEm)
        || this._diaDeIso(telefone?.atualizadoEm);

      if (!dia) return;
      if (!diaMaisRecente || dia > diaMaisRecente) {
        diaMaisRecente = dia;
      }
    });

    return diaMaisRecente;
  }

  _normalizarControleDiario() {
    if (!this.controleDiario || typeof this.controleDiario !== 'object') {
      this.controleDiario = { ultimoDiaReset: null };
    }

    const diaSalvo = this.controleDiario.ultimoDiaReset;
    const diaValido = typeof diaSalvo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(diaSalvo);
    if (diaValido) return;

    this.controleDiario.ultimoDiaReset = this._diaMaisRecenteComConversas() || this._diaAtualLocal();
  }

  _garantirResetDiario(origem = 'check') {
    const diaAtual = this._diaAtualLocal();
    if (this.controleDiario?.ultimoDiaReset === diaAtual) return false;

    const diaAnterior = this.controleDiario?.ultimoDiaReset || 'desconhecido';
    this.resetarContadoresDiarios({
      motivo: `${origem} (${diaAnterior} -> ${diaAtual})`,
      diaReset: diaAtual
    });
    return true;
  }

  garantirResetDiario(origem = 'manual') {
    return this._garantirResetDiario(origem);
  }

  criar(dados) {
    this._garantirResetDiario('criar');

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
    this._garantirResetDiario('buscarPorId');
    return this.telefones.find(item => item.id === id) ?? null;
  }

  listar() {
    this._garantirResetDiario('listar');
    return this.telefones;
  }

  atualizar(id, dados) {
    this._garantirResetDiario('atualizar');

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
    this._garantirResetDiario('atualizarStatus');

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
    this._garantirResetDiario('incrementarConversas');

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
    this._garantirResetDiario('incrementarMensagensEnviadas');

    const telefone = this.buscarPorId(id);
    if (!telefone) return null;

    telefone.estatisticas.totalMensagensEnviadas += quantidade;
    this.salvar();
    RealtimeService.emitTelefoneStatus(telefone);
    return telefone;
  }

  incrementarMensagensRecebidas(id, quantidade = 1) {
    this._garantirResetDiario('incrementarMensagensRecebidas');

    const telefone = this.buscarPorId(id);
    if (!telefone) return null;

    telefone.estatisticas.totalMensagensRecebidas += quantidade;
    this.salvar();
    RealtimeService.emitTelefoneStatus(telefone);
    return telefone;
  }

  resetarContadoresDiarios(opcoes = {}) {
    const { motivo = 'manual', diaReset = this._diaAtualLocal() } = opcoes;

    this.telefones.forEach((telefone) => {
      telefone.configuracao.conversasRealizadasHoje = 0;
      telefone.configuracao.ultimaConversaEm = null;
      telefone.configuracao.proximaConversaDisponivelEm = null;
      telefone.atualizadoEm = new Date().toISOString();
      RealtimeService.emitTelefoneStatus(telefone);
    });

    this.controleDiario.ultimoDiaReset = diaReset;
    this.salvar();
    logger.info(`Contadores diarios resetados (${motivo})`);
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
    this._garantirResetDiario('buscarOnline');
    return this.telefones.filter(item => item.status === 'online');
  }

  buscarDisponiveis() {
    this._garantirResetDiario('buscarDisponiveis');
    return this.telefones.filter(item =>
      item.status === 'online' &&
      item.configuracao.conversasRealizadasHoje < item.configuracao.quantidadeConversasDia
    );
  }
}

module.exports = new TelefoneModel();

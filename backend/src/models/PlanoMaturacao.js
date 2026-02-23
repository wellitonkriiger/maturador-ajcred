// src/models/PlanoMaturacao.js

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class PlanoMaturacaoModel {
  constructor() {
    this.configFile = path.join(__dirname, '../../data/config.json');
    this.plano = null;
    this.carregar();
  }

  /**
   * Carrega plano de maturação
   */
  carregar() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        const config = JSON.parse(data);
        this.plano = config.planoMaturacao || this.getPlanoDefault();
      } else {
        this.plano = this.getPlanoDefault();
      }
      logger.info('📅 Plano de maturação carregado');
    } catch (error) {
      logger.error('❌ Erro ao carregar plano:', error);
      this.plano = this.getPlanoDefault();
    }
  }

  /**
   * Retorna plano padrão
   */
  getPlanoDefault() {
    return {
      ativo: false,
      horarioFuncionamento: {
        inicio: process.env.HORARIO_INICIO || '08:00',
        fim: process.env.HORARIO_FIM || '22:00',
        diasSemana: [1, 2, 3, 4, 5, 6, 0] // Todos os dias
      },
      intervalosGlobais: {
        entreConversas: { 
          min: parseInt(process.env.INTERVALO_ENTRE_CONVERSAS_MIN) || 1800,
          max: parseInt(process.env.INTERVALO_ENTRE_CONVERSAS_MAX) || 3600
        },
        pausaLonga: { 
          min: parseInt(process.env.PAUSA_LONGA_MIN) || 180,
          max: parseInt(process.env.PAUSA_LONGA_MAX) || 600
        },
        leituraMinima: { min: 1, max: 3 },
        leituraMaxima: { min: 5, max: 10 }
      },
      metas: {
        conversasPorTelefoneDia: parseInt(process.env.CONVERSAS_POR_TELEFONE_DIA) || 5,
        totalConversasDia: null,
        duracaoPlano: '30 dias'
      },
      estrategia: {
        prioridadeTelefonesAltaSensibilidade: true,
        evitarRepeticaoConversas: true,
        distribuirUniformemente: true,
        randomizarParticipantes: true
      }
    };
  }

  /**
   * Salva plano
   */
  salvar() {
    try {
      // Ler config atual
      let config = { telefones: [] };
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        config = JSON.parse(data);
      }

      // Atualizar plano
      config.planoMaturacao = this.plano;

      // Salvar
      fs.writeFileSync(
        this.configFile,
        JSON.stringify(config, null, 2),
        'utf8'
      );
      
      logger.debug('💾 Plano de maturação salvo');
    } catch (error) {
      logger.error('❌ Erro ao salvar plano:', error);
    }
  }

  /**
   * Obtém plano atual
   */
  obter() {
    return this.plano;
  }

  /**
   * Atualiza plano
   */
  atualizar(dados) {
    this.plano = {
      ...this.plano,
      ...dados
    };
    this.salvar();
    logger.info('♻️ Plano de maturação atualizado');
    return this.plano;
  }

  /**
   * Ativa/desativa plano
   */
  setAtivo(ativo) {
    this.plano.ativo = ativo;
    this.salvar();
    logger.info(`📅 Plano ${ativo ? 'ativado' : 'desativado'}`);
    return this.plano;
  }

  /**
   * Verifica se está dentro do horário de funcionamento
   */
  estaDentroHorario() {
    const agora = new Date();
    const diaAtual = agora.getDay();
    const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

    // Verificar dia da semana
    if (!this.plano.horarioFuncionamento.diasSemana.includes(diaAtual)) {
      return false;
    }

    // Verificar horário
    const inicio = this.plano.horarioFuncionamento.inicio;
    const fim = this.plano.horarioFuncionamento.fim;

    return horaAtual >= inicio && horaAtual <= fim;
  }

  /**
   * Calcula próximo horário de funcionamento
   */
  proximoHorarioFuncionamento() {
    const agora = new Date();
    const inicio = this.plano.horarioFuncionamento.inicio.split(':');
    
    let proxima = new Date();
    proxima.setHours(parseInt(inicio[0]), parseInt(inicio[1]), 0, 0);

    // Se já passou do horário de hoje, pega amanhã
    if (proxima <= agora) {
      proxima.setDate(proxima.getDate() + 1);
    }

    return proxima;
  }
}

module.exports = new PlanoMaturacaoModel();
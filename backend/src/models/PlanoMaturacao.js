// src/models/PlanoMaturacao.js
// Persiste o plano de maturacao em data/plano.json (arquivo proprio, separado de config.json).
// Nao depende de variaveis de ambiente para valores de negocio.

const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');

const PLANO_FILE = path.join(__dirname, '../../data/plano.json');

// Valores padrao razoaveis -- podem ser alterados pelo usuario pela interface
const PLANO_DEFAULT = {
  ativo: false,
  horarioFuncionamento: {
    inicio:     '08:00',
    fim:        '22:00',
    diasSemana: [0, 1, 2, 3, 4, 5, 6]
  },
  intervalosGlobais: {
    entreConversas: { min: 1800, max: 3600 },
    pausaLonga:     { min: 180,  max: 600  },
    leituraMinima:  { min: 1,    max: 3    },
    leituraMaxima:  { min: 5,    max: 10   }
  },
  metas: {
    conversasPorTelefoneDia: 5,
    totalConversasDia:       null,
    duracaoPlano:            '30 dias'
  },
  estrategia: {
    prioridadeTelefonesAltaSensibilidade: true,
    evitarRepeticaoConversas:             true,
    distribuirUniformemente:              true,
    randomizarParticipantes:              true,
    maxConversasMesmoParDia:              3
  }
};

class PlanoMaturacaoModel {
  constructor() {
    this.plano = null;
    this._carregar();
  }

  _carregar() {
    try {
      if (fs.existsSync(PLANO_FILE)) {
        const raw = fs.readFileSync(PLANO_FILE, 'utf8');
        this.plano = this._merge(PLANO_DEFAULT, JSON.parse(raw));
        logger.info('Plano de maturacao carregado de plano.json');
      } else {
        this.plano = JSON.parse(JSON.stringify(PLANO_DEFAULT));
        this._salvar();
        logger.info('plano.json criado com valores padrao');
      }
    } catch (err) {
      logger.error(`Erro ao carregar plano.json: ${err.message} -- usando padrao`);
      this.plano = JSON.parse(JSON.stringify(PLANO_DEFAULT));
    }
  }

  _salvar() {
    try {
      const dir = path.dirname(PLANO_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PLANO_FILE, JSON.stringify(this.plano, null, 2), 'utf8');
      logger.debug('Plano de maturacao salvo em plano.json');
    } catch (err) {
      logger.error(`Erro ao salvar plano.json: ${err.message}`);
    }
  }

  // Deep merge: campos presentes no base e ausentes no override sao mantidos
  _merge(base, override) {
    const result = JSON.parse(JSON.stringify(base));
    for (const key of Object.keys(override)) {
      if (
        override[key] !== null &&
        typeof override[key] === 'object' &&
        !Array.isArray(override[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null
      ) {
        result[key] = this._merge(result[key], override[key]);
      } else {
        result[key] = override[key];
      }
    }
    return result;
  }

  obter() {
    return this.plano;
  }

  atualizar(dados) {
    this.plano = this._merge(this.plano, dados);
    this._salvar();
    logger.info('Plano de maturacao atualizado');
    return this.plano;
  }

  setAtivo(ativo) {
    this.plano.ativo = ativo;
    this._salvar();
    logger.info(`Plano ${ativo ? 'ativado' : 'desativado'}`);
    return this.plano;
  }

  estaDentroHorario() {
    const agora     = new Date();
    const diaAtual  = agora.getDay();
    const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

    if (!this.plano.horarioFuncionamento.diasSemana.includes(diaAtual)) return false;

    const { inicio, fim } = this.plano.horarioFuncionamento;
    return horaAtual >= inicio && horaAtual <= fim;
  }

  proximoHorarioFuncionamento() {
    const agora    = new Date();
    const [h, m]   = this.plano.horarioFuncionamento.inicio.split(':').map(Number);
    const proxima  = new Date();
    proxima.setHours(h, m, 0, 0);
    if (proxima <= agora) proxima.setDate(proxima.getDate() + 1);
    return proxima;
  }
}

module.exports = new PlanoMaturacaoModel();

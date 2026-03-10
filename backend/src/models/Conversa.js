// src/models/Conversa.js
// Carrega conversas de data/conversas/*.json.
// Nao rastreia quantas vezes cada conversa foi usada -- isso nao importa mais.
// A unica restricao de selecao e: nao usar a mesma conversa em dois pares simultaneos.
// Quem controla isso e o maturacaoService, que passa os IDs em uso para selecionarAleatoria().

const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');

const MESSAGE_PREFIX = 'MATURADOR_APAGAR';

class ConversaModel {
  constructor() {
    this.conversasDir = path.join(__dirname, '../../data/conversas');
    this.conversas    = [];
    this._inicializar();
  }

  _normalizarTextoMensagem(texto) {
    if (typeof texto !== 'string') return texto;
    if (texto === MESSAGE_PREFIX || texto.startsWith(`${MESSAGE_PREFIX} `)) {
      return texto;
    }
    return `${MESSAGE_PREFIX} ${texto}`;
  }

  _normalizarConversa(conversa) {
    if (!conversa || typeof conversa !== 'object' || !Array.isArray(conversa.mensagens)) {
      return { conversa, alterada: false };
    }

    let alterada = false;
    const mensagens = conversa.mensagens.map((mensagem) => {
      if (!mensagem || typeof mensagem !== 'object') return mensagem;
      if (mensagem.tipo === 'pausa_longa' || typeof mensagem.texto !== 'string') {
        return mensagem;
      }

      const texto = this._normalizarTextoMensagem(mensagem.texto);
      if (texto === mensagem.texto) return mensagem;

      alterada = true;
      return { ...mensagem, texto };
    });

    if (!alterada) {
      return { conversa, alterada: false };
    }

    return {
      conversa: { ...conversa, mensagens },
      alterada: true
    };
  }

  // ─── INICIALIZACAO ────────────────────────────────────────────────────────

  _inicializar() {
    if (!fs.existsSync(this.conversasDir)) {
      fs.mkdirSync(this.conversasDir, { recursive: true });
      logger.info('Diretorio de conversas criado');
      this._criarExemplo();
    }
    this.carregar();
  }

  _criarExemplo() {
    const exemplo = {
      id: 'conv_exemplo_001',
      nome: 'Churrasco no Fim de Semana',
      categoria: 'social',
      participantesMinimos: 2,
      participantesMaximos: 2,
      mensagens: [
        { ordem: 1, remetente: 0, texto: 'E ai, bora marcar aquele churrasco no sabado?', delay: { min: 2, max: 5 }, comportamento: { marcarComoLida: true, tempoAntesLeitura: { min: 1, max: 3 }, simularDigitacao: true, tempoDigitacao: { min: 2, max: 4 } } },
        { ordem: 2, remetente: 1, texto: 'Bora sim! Que horas vc ta pensando?', delay: { min: 3, max: 7 }, comportamento: { marcarComoLida: true, tempoAntesLeitura: { min: 1, max: 2 }, simularDigitacao: true, tempoDigitacao: { min: 3, max: 5 } } },
        { ordem: 3, remetente: 0, texto: 'Umas 15h ta bom? Assim da tempo de preparar tudo', delay: { min: 2, max: 4 }, comportamento: { marcarComoLida: true, tempoAntesLeitura: { min: 1, max: 3 }, simularDigitacao: true, tempoDigitacao: { min: 2, max: 4 } } },
        { ordem: 4, tipo: 'pausa_longa', duracao: { min: 180, max: 300 } },
        { ordem: 5, remetente: 1, texto: 'Perfeito! Vou levar as bebidas', delay: { min: 4, max: 8 }, comportamento: { marcarComoLida: true, tempoAntesLeitura: { min: 2, max: 4 }, simularDigitacao: true, tempoDigitacao: { min: 3, max: 5 } } },
        { ordem: 6, remetente: 0, texto: 'Massa! Eu cuido da carne e do carvao', delay: { min: 2, max: 5 }, comportamento: { marcarComoLida: true, tempoAntesLeitura: { min: 1, max: 3 }, simularDigitacao: true, tempoDigitacao: { min: 2, max: 4 } } },
        { ordem: 7, remetente: 1, texto: 'Fechou entao! Ate sabado', delay: { min: 3, max: 6 }, comportamento: { marcarComoLida: true, tempoAntesLeitura: { min: 1, max: 2 }, simularDigitacao: true, tempoDigitacao: { min: 2, max: 3 } } }
      ]
    };
    const { conversa } = this._normalizarConversa(exemplo);
    fs.writeFileSync(
      path.join(this.conversasDir, 'conv_exemplo_001.json'),
      JSON.stringify(conversa, null, 2),
      'utf8'
    );
    logger.info('Conversa de exemplo criada');
  }

  // ─── CARREGAR / RECARREGAR ────────────────────────────────────────────────

  carregar() {
    try {
      const arquivos = fs.readdirSync(this.conversasDir).filter(f => f.endsWith('.json'));
      this.conversas = [];

      for (const arquivo of arquivos) {
        try {
          const caminhoArquivo = path.join(this.conversasDir, arquivo);
          const raw = fs.readFileSync(caminhoArquivo, 'utf8');
          const { conversa, alterada } = this._normalizarConversa(JSON.parse(raw));

          if (alterada) {
            fs.writeFileSync(caminhoArquivo, JSON.stringify(conversa, null, 2), 'utf8');
            logger.info(`Conversa normalizada com prefixo: ${arquivo}`);
          }

          this.conversas.push(conversa);
        } catch (err) {
          logger.error(`Erro ao carregar ${arquivo}: ${err.message}`);
        }
      }

      logger.info(`${this.conversas.length} conversas carregadas`);
    } catch (err) {
      logger.error(`Erro ao carregar conversas: ${err.message}`);
      this.conversas = [];
    }
  }

  // ─── CONSULTAS ────────────────────────────────────────────────────────────

  listar()        { return this.conversas; }
  buscarPorId(id) { return this.conversas.find(c => c.id === id) ?? null; }

  validar(conversaJSON, { existingId = null } = {}) {
    let conversa = typeof conversaJSON === 'string' ? JSON.parse(conversaJSON) : conversaJSON;
    if (!conversa || typeof conversa !== 'object') {
      throw new Error('Conversa invalida: payload ausente');
    }
    if (!conversa.id || typeof conversa.id !== 'string') {
      throw new Error('Conversa invalida: id obrigatorio');
    }
    if (!conversa.nome || typeof conversa.nome !== 'string') {
      throw new Error('Conversa invalida: nome obrigatorio');
    }
    if (!Array.isArray(conversa.mensagens) || conversa.mensagens.length === 0) {
      throw new Error('Conversa invalida: mensagens obrigatorias');
    }
    conversa = this._normalizarConversa(conversa).conversa;
    if (existingId && conversa.id !== existingId) {
      throw new Error('Nao e permitido alterar o id da conversa');
    }
    if (!existingId && this.buscarPorId(conversa.id)) {
      throw new Error(`Ja existe uma conversa com id "${conversa.id}"`);
    }

    conversa.mensagens.forEach((mensagem, index) => {
      if (!mensagem || typeof mensagem !== 'object') {
        throw new Error(`Mensagem invalida na posicao ${index + 1}`);
      }
      if (typeof mensagem.ordem !== 'number') {
        throw new Error(`Mensagem invalida: ordem obrigatoria na posicao ${index + 1}`);
      }

      if (mensagem.tipo === 'pausa_longa') {
        if (!mensagem.duracao || typeof mensagem.duracao.min !== 'number' || typeof mensagem.duracao.max !== 'number') {
          throw new Error(`Mensagem pausa_longa invalida na ordem ${mensagem.ordem}`);
        }
        return;
      }

      if (typeof mensagem.remetente !== 'number' || mensagem.remetente < 0) {
        throw new Error(`Mensagem invalida: remetente incorreto na ordem ${mensagem.ordem}`);
      }
      if (!mensagem.texto || typeof mensagem.texto !== 'string') {
        throw new Error(`Mensagem invalida: texto obrigatorio na ordem ${mensagem.ordem}`);
      }
      if (!mensagem.delay || typeof mensagem.delay.min !== 'number' || typeof mensagem.delay.max !== 'number') {
        throw new Error(`Mensagem invalida: delay obrigatorio na ordem ${mensagem.ordem}`);
      }
      if (mensagem.comportamento) {
        const { tempoAntesLeitura, tempoDigitacao } = mensagem.comportamento;
        if (mensagem.comportamento.marcarComoLida && (!tempoAntesLeitura || typeof tempoAntesLeitura.min !== 'number' || typeof tempoAntesLeitura.max !== 'number')) {
          throw new Error(`Mensagem invalida: tempoAntesLeitura obrigatorio na ordem ${mensagem.ordem}`);
        }
        if (mensagem.comportamento.simularDigitacao && (!tempoDigitacao || typeof tempoDigitacao.min !== 'number' || typeof tempoDigitacao.max !== 'number')) {
          throw new Error(`Mensagem invalida: tempoDigitacao obrigatorio na ordem ${mensagem.ordem}`);
        }
      }
    });

    return conversa;
  }

  /**
   * Seleciona uma conversa aleatoria compativel com o numero de participantes,
   * excluindo as que estao em uso simultaneo no momento.
   *
   * @param {number}   numParticipantes - quantos telefones vao participar
   * @param {string[]} idsEmUso         - IDs de conversas ja em andamento (para nao repetir)
   */
  selecionarAleatoria(numParticipantes, idsEmUso = []) {
    const emUso = new Set(idsEmUso);

    const candidatas = this.conversas.filter(c => {
      const minOk = numParticipantes >= (c.participantesMinimos ?? 2);
      const maxOk = numParticipantes <= (c.participantesMaximos ?? 2);
      const livres = !emUso.has(c.id);
      return minOk && maxOk && livres;
    });

    if (candidatas.length === 0) {
      // Se todas estao em uso, libera a restricao e escolhe qualquer compativel
      const qualquer = this.conversas.filter(c =>
        numParticipantes >= (c.participantesMinimos ?? 2) &&
        numParticipantes <= (c.participantesMaximos ?? 2)
      );
      if (qualquer.length === 0) return null;
      logger.debug('Todas as conversas em uso simultaneo -- reutilizando uma aleatoria');
      return qualquer[Math.floor(Math.random() * qualquer.length)];
    }

    return candidatas[Math.floor(Math.random() * candidatas.length)];
  }

  // ─── ESCRITA (usada pelo controller de importacao) ────────────────────────

  salvar(conversa) {
    try {
      const normalizada = this._normalizarConversa(conversa).conversa;
      const arquivo = path.join(this.conversasDir, `${normalizada.id}.json`);
      fs.writeFileSync(arquivo, JSON.stringify(normalizada, null, 2), 'utf8');

      const idx = this.conversas.findIndex(c => c.id === normalizada.id);
      if (idx !== -1) this.conversas[idx] = normalizada;
      else            this.conversas.push(normalizada);

      logger.debug(`Conversa salva: ${normalizada.id}`);
      return true;
    } catch (err) {
      logger.error(`Erro ao salvar conversa: ${err.message}`);
      return false;
    }
  }

  deletar(id) {
    try {
      const arquivo = path.join(this.conversasDir, `${id}.json`);
      if (!fs.existsSync(arquivo)) return false;
      fs.unlinkSync(arquivo);
      this.conversas = this.conversas.filter(c => c.id !== id);
      logger.info(`Conversa deletada: ${id}`);
      return true;
    } catch (err) {
      logger.error(`Erro ao deletar conversa: ${err.message}`);
      return false;
    }
  }

  importar(conversaJSON) {
    const conversa = this.validar(conversaJSON);
    const ok = this.salvar(conversa);
    if (ok) logger.info(`Conversa importada: ${conversa.nome}`);
    return ok ? conversa : null;
  }

  atualizar(id, conversaJSON) {
    if (!this.buscarPorId(id)) return null;
    const conversa = this.validar(conversaJSON, { existingId: id });
    const ok = this.salvar(conversa);
    if (ok) logger.info(`Conversa atualizada: ${conversa.nome}`);
    return ok ? conversa : null;
  }
}

module.exports = new ConversaModel();

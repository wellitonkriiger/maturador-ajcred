// src/services/maturacaoService.js
// Orquestrador inteligente de maturacao.
//
// Filosofia:
//  - Nao ha "loop unico bloqueante". Ha um pool de telefones livres.
//  - Quando um telefone fica online  -> tenta emparelha-lo imediatamente.
//  - Quando um telefone fica offline -> remove do pool, encerra conversa ativa.
//  - Quando uma conversa falha      -> telefone entra em cooldown (5 min) e volta automaticamente.
//  - Um ciclo de agendamento roda a cada 60s verificando se sobrou alguem sem par.

const TelefoneModel   = require('../models/Telefone');
const ConversaModel   = require('../models/Conversa');
const PlanoMaturacao  = require('../models/PlanoMaturacao');
const WhatsAppService = require('./whatsappService');
const DelayUtils      = require('../utils/delay');
const logger          = require('../utils/logger');

const COOLDOWN_MS          = 5 * 60 * 1000;  // 5 minutos apos falha
const CICLO_AGENDAMENTO_MS = 60 * 1000;       // verificacao periodica

// Erros de Puppeteer que indicam desconexao fisica do WhatsApp
const ERROS_CONEXAO = [
  'detached Frame',
  'Execution context was destroyed',
  'Target closed',
  'Session closed',
  'Protocol error',
  'Frame detachado'
];

function isErroConexao(msg) {
  return ERROS_CONEXAO.some(e => msg && msg.includes(e));
}

class MaturacaoService {
  constructor() {
    this.emExecucao   = false;

    // telefoneId -> { conversaId, conversaNome, participantes, mensagemAtual, totalMensagens, progresso, iniciouEm }
    this.conversasAtivas = new Map();

    // telefoneId -> timestamp do fim do cooldown
    this.cooldowns = new Map();

    this._cicloTimer = null;
    this._eventsBound = false;
  }

  // ─── CICLO DE VIDA ────────────────────────────────────────────────────────

  async iniciar() {
    if (this.emExecucao) {
      logger.warn('Maturacao ja esta em execucao');
      return false;
    }

    const plano = PlanoMaturacao.obter();
    if (!plano.ativo) {
      PlanoMaturacao.setAtivo(true);
      logger.info('Plano ativado automaticamente ao iniciar maturacao');
    }

    this.emExecucao = true;
    logger.info('Processo de maturacao iniciado');

    // Escuta eventos do WhatsAppService
    this._bindEventos();

    // Ciclo periodico para emparelhar quem ficou sozinho
    this._cicloTimer = setInterval(() => this._tentarEmparelharTodos(), CICLO_AGENDAMENTO_MS);

    // Emparelha imediatamente quem ja esta online
    this._tentarEmparelharTodos();

    return true;
  }

  parar() {
    if (!this.emExecucao) {
      logger.warn('Maturacao nao esta em execucao');
      return false;
    }
    this.emExecucao = false;

    if (this._cicloTimer) {
      clearInterval(this._cicloTimer);
      this._cicloTimer = null;
    }

    this._unbindEventos();
    logger.info('Processo de maturacao pausado');
    return true;
  }

  // ─── EVENTOS DO WHATSAPP ──────────────────────────────────────────────────

  _bindEventos() {
    if (this._eventsBound) return;
    this._eventsBound = true;

    this._onTelefoneOnline  = (id) => this._aoTelefoneOnline(id);
    this._onTelefoneOffline = (id, motivo) => this._aoTelefoneOffline(id, motivo);
    this._onTelefoneErro    = (id, motivo) => this._aoTelefoneOffline(id, motivo);

    WhatsAppService.on('telefone:online',  this._onTelefoneOnline);
    WhatsAppService.on('telefone:offline', this._onTelefoneOffline);
    WhatsAppService.on('telefone:erro',    this._onTelefoneErro);
  }

  _unbindEventos() {
    WhatsAppService.off('telefone:online',  this._onTelefoneOnline);
    WhatsAppService.off('telefone:offline', this._onTelefoneOffline);
    WhatsAppService.off('telefone:erro',    this._onTelefoneErro);
    this._eventsBound = false;
  }

  _aoTelefoneOnline(telefoneId) {
    if (!this.emExecucao) return;
    const tel = TelefoneModel.buscarPorId(telefoneId);
    logger.info(`[Maturacao] ${tel?.nome ?? telefoneId} ficou online -- tentando emparelhar`);
    // Pequena espera para garantir que o numero foi gravado
    setTimeout(() => this._tentarEmparelharTelefone(telefoneId), 3000);
  }

  _aoTelefoneOffline(telefoneId, motivo) {
    const tel = TelefoneModel.buscarPorId(telefoneId);
    logger.warn(`[Maturacao] ${tel?.nome ?? telefoneId} ficou offline (${motivo}) -- removendo de conversas ativas`);
    // Remove da conversa ativa sem cooldown (foi desconexao externa, nao falha nossa)
    this.conversasAtivas.delete(telefoneId);
  }

  // ─── EMPARELHAMENTO ───────────────────────────────────────────────────────

  /**
   * Verifica todos os telefones disponiveis e forma pares para iniciar conversas.
   * Chamado periodicamente e ao detectar novo telefone online.
   */
  _tentarEmparelharTodos() {
    if (!this.emExecucao) return;
    if (!PlanoMaturacao.estaDentroHorario()) return;

    const livres = this._telefonesDivisiveis();
    if (livres.length < 2) return;

    const plano = PlanoMaturacao.obter();
    const pares = this._formarPares(livres, plano);

    for (const par of pares) {
      this._iniciarConversa(par);
    }
  }

  /**
   * Tenta emparelhar um telefone especifico que acabou de ficar disponivel.
   */
  _tentarEmparelharTelefone(telefoneId) {
    if (!this.emExecucao) return;
    if (!PlanoMaturacao.estaDentroHorario()) return;

    const tel = TelefoneModel.buscarPorId(telefoneId);
    if (!tel) return;

    // Ja esta em conversa?
    if (this.conversasAtivas.has(telefoneId)) return;

    // Em cooldown?
    if (this._emCooldown(telefoneId)) return;

    // Dentro do limite diario?
    if (tel.configuracao.conversasRealizadasHoje >= tel.configuracao.quantidadeConversasDia) return;

    // Nao esta operacional?
    if (!WhatsAppService.estaOperacional(telefoneId)) return;

    // Busca um parceiro disponivel
    const livres = this._telefonesDivisiveis().filter(t => t.id !== telefoneId);
    if (livres.length === 0) {
      logger.debug(`[Maturacao] ${tel.nome} online mas sem parceiro disponivel no momento`);
      return;
    }

    const plano = PlanoMaturacao.obter();
    const parceiros = this._embaralhar(livres);
    // Respeita intervalo entre conversas para o parceiro tambem
    const parceiro = parceiros.find(t => this._podeParticipar(t, plano));
    if (!parceiro) {
      logger.debug(`[Maturacao] ${tel.nome} online mas parceiros ainda em intervalo`);
      return;
    }

    this._iniciarConversa([tel, parceiro]);
  }

  /**
   * Lista telefones que podem entrar em nova conversa agora.
   */
  _telefonesDivisiveis() {
    const emUso = new Set(this.conversasAtivas.keys());
    return TelefoneModel.buscarDisponiveis().filter(t =>
      !emUso.has(t.id) &&
      !this._emCooldown(t.id) &&
      WhatsAppService.estaOperacional(t.id)
    );
  }

  _emCooldown(telefoneId) {
    const fim = this.cooldowns.get(telefoneId);
    if (!fim) return false;
    if (Date.now() >= fim) {
      this.cooldowns.delete(telefoneId);
      return false;
    }
    return true;
  }

  _podeParticipar(tel, plano) {
    if (!tel.configuracao.ultimaConversaEm) return true;
    const decorrido = (Date.now() - new Date(tel.configuracao.ultimaConversaEm).getTime()) / 1000;
    return decorrido >= plano.intervalosGlobais.entreConversas.min;
  }

  /**
   * Forma o maximo de pares validos a partir dos candidatos.
   * Cada telefone so aparece em um par.
   */
  _formarPares(candidatos, plano) {
    const aptos = candidatos.filter(t => this._podeParticipar(t, plano));
    if (aptos.length < 2) return [];

    const embaralhados = this._embaralhar(aptos);
    const usados = new Set();
    const pares = [];

    for (const t of embaralhados) {
      if (usados.has(t.id)) continue;
      if (!t.configuracao.podeIniciarConversa) continue;

      const parceiro = embaralhados.find(p => p.id !== t.id && !usados.has(p.id));
      if (!parceiro) continue;

      usados.add(t.id);
      usados.add(parceiro.id);
      pares.push([t, parceiro]);
    }

    // Fallback: se nenhum tem podeIniciarConversa, usa os dois primeiros
    if (pares.length === 0 && aptos.length >= 2) {
      const [a, b] = this._embaralhar(aptos);
      pares.push([a, b]);
    }

    return pares;
  }

  _embaralhar(arr) {
    const s = [...arr];
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    return s;
  }

  // ─── CONVERSA ─────────────────────────────────────────────────────────────

  _iniciarConversa(participantes) {
    const idsEmUso = [...new Set([...this.conversasAtivas.values()].map(v => v.conversaId))];
    const conversa = ConversaModel.selecionarAleatoria(participantes.length, idsEmUso);
    if (!conversa) {
      logger.warn(`[Maturacao] Nenhuma conversa disponivel para ${participantes.length} participantes`);
      return;
    }

    logger.info(`[Maturacao] Iniciando: "${conversa.nome}" | ${participantes.map(p => p.nome).join(' <-> ')}`);

    const iniciouEm = new Date().toISOString();
    const totalMensagens = conversa.mensagens.filter(m => m.texto).length;

    participantes.forEach(p => {
      this.conversasAtivas.set(p.id, {
        conversaId:    conversa.id,
        conversaNome:  conversa.nome,
        participantes: participantes.map(x => x.nome),
        mensagemAtual: 0,
        totalMensagens,
        progresso:     0,
        iniciouEm
      });
    });

    this._executarConversa(conversa, participantes).catch(err => {
      logger.error(`[Maturacao] Erro nao tratado na conversa "${conversa.nome}": ${err.message}`);
      this._finalizarConversa(participantes, false);
    });
  }

  async _executarConversa(conversa, participantes) {
    let mensagensEnviadas = 0;
    const totalMensagens  = conversa.mensagens.filter(m => m.texto).length;

    try {
      for (let i = 0; i < conversa.mensagens.length; i++) {
        if (!this.emExecucao) {
          logger.info(`[Maturacao] Maturacao pausada -- interrompendo "${conversa.nome}"`);
          break;
        }

        const msg = conversa.mensagens[i];

        if (msg.tipo === 'pausa_longa') {
          const dur = DelayUtils.getRandomDelay(msg.duracao.min, msg.duracao.max);
          logger.info(`[Maturacao] Pausa longa: ${DelayUtils.formatDuration(dur)}`);
          await DelayUtils.sleep(dur);
          continue;
        }

        const remetente    = participantes[msg.remetente];
        const destinatarios = participantes.filter((_, idx) => idx !== msg.remetente);

        if (!remetente) {
          logger.error(`[Maturacao] Remetente invalido: indice ${msg.remetente}`);
          continue;
        }

        // Verifica se remetente ainda esta operacional
        if (!WhatsAppService.estaOperacional(remetente.id)) {
          logger.warn(`[Maturacao] ${remetente.nome} nao operacional -- abortando conversa`);
          this._iniciarCooldown(remetente.id, `${remetente.nome} desconectou durante conversa`);
          break;
        }

        const delay = DelayUtils.getRandomDelay(msg.delay.min, msg.delay.max);
        logger.info(`[Maturacao] Delay: ${DelayUtils.formatDuration(delay)} | #${msg.ordem} [${remetente.nome}]: "${msg.texto}"`);
        await DelayUtils.sleep(delay);

        for (const dest of destinatarios) {
          const destOk = WhatsAppService.estaOperacional(dest.id);

          try {
            // Marcar como lida
            if (msg.comportamento?.marcarComoLida && i > 0 && destOk) {
              const tLeitura = DelayUtils.getRandomDelay(
                msg.comportamento.tempoAntesLeitura.min,
                msg.comportamento.tempoAntesLeitura.max
              );
              logger.debug(`[Maturacao] ${dest.nome} lendo (${DelayUtils.formatDuration(tLeitura)})...`);
              await DelayUtils.sleep(tLeitura);
              await WhatsAppService.marcarComoLida(dest.id, remetente.numero);
            }

            // Simular digitacao
            if (msg.comportamento?.simularDigitacao) {
              const tDigitacao = DelayUtils.getRandomDelay(
                msg.comportamento.tempoDigitacao.min,
                msg.comportamento.tempoDigitacao.max
              );
              logger.debug(`[Maturacao] ${remetente.nome} digitando (${DelayUtils.formatDuration(tDigitacao)})...`);
              await WhatsAppService.simularDigitacao(remetente.id, dest.numero, tDigitacao);
            }

            // Verifica novamente apos delays (a pagina pode ter fechado durante o typing)
            if (!WhatsAppService.estaOperacional(remetente.id)) {
              throw new Error(`Frame detachado apos delay: ${remetente.nome}`);
            }

            await WhatsAppService.enviarMensagem(remetente.id, dest.numero, msg.texto);
            logger.info(`[Maturacao] Enviado! [${remetente.nome} -> ${dest.nome}]: "${msg.texto}"`);
            TelefoneModel.incrementarMensagensRecebidas(dest.id);

          } catch (err) {
            if (isErroConexao(err.message)) {
              logger.warn(`[Maturacao] Conexao perdida (${remetente.nome}) -- iniciando cooldown e abortando conversa`);
              this._iniciarCooldown(remetente.id, err.message);
              throw err; // propaga para encerrar _executarConversa
            }
            // Erro nao fatal -- loga e continua
            logger.error(`[Maturacao] Falha ao enviar [${remetente.nome} -> ${dest.nome}]: ${err.message}`);
          }
        }

        mensagensEnviadas++;
        const progresso = Math.floor((mensagensEnviadas / totalMensagens) * 100);
        participantes.forEach(p => {
          const ativo = this.conversasAtivas.get(p.id);
          if (ativo) {
            ativo.progresso     = progresso;
            ativo.mensagemAtual = mensagensEnviadas;
          }
        });
        logger.debug(`[Maturacao] Progresso: ${mensagensEnviadas}/${totalMensagens} (${progresso}%)`);
      }

      logger.info(`[Maturacao] Conversa "${conversa.nome}" finalizada! (${mensagensEnviadas}/${totalMensagens} msgs)`);
      this._finalizarConversa(participantes, true);

    } catch (err) {
      logger.error(`[Maturacao] Conversa abortada: ${err.message}`);
      this._finalizarConversa(participantes, false);
    }
  }

  /**
   * Registra fim de conversa, atualiza contadores e agenda cooldown se necessario.
   */
  _finalizarConversa(participantes, sucesso) {
    participantes.forEach(p => {
      this.conversasAtivas.delete(p.id);
      if (sucesso) {
        TelefoneModel.incrementarConversas(p.id);
      }
    });

  }

  /**
   * Coloca telefone em cooldown por COOLDOWN_MS.
   * Apos o cooldown, tenta emparelhar automaticamente.
   */
  _iniciarCooldown(telefoneId, motivo) {
    const fim = Date.now() + COOLDOWN_MS;
    this.cooldowns.set(telefoneId, fim);
    const tel = TelefoneModel.buscarPorId(telefoneId);
    logger.info(`[Maturacao] ${tel?.nome ?? telefoneId} em cooldown por ${COOLDOWN_MS / 60000} min (${motivo})`);

    setTimeout(() => {
      if (!this.emExecucao) return;
      this.cooldowns.delete(telefoneId);
      logger.info(`[Maturacao] Cooldown encerrado para ${tel?.nome ?? telefoneId} -- tentando emparelhar`);
      this._tentarEmparelharTelefone(telefoneId);
    }, COOLDOWN_MS);
  }

  // ─── STATUS E MONITORAMENTO ───────────────────────────────────────────────

  getStatus() {
    const plano      = PlanoMaturacao.obter();
    const telefones  = TelefoneModel.listar();
    const online     = TelefoneModel.buscarOnline();
    const disponiveis = TelefoneModel.buscarDisponiveis();
    const conversasHoje = telefones.reduce((s, t) => s + t.configuracao.conversasRealizadasHoje, 0);

    return {
      emExecucao:   this.emExecucao,
      planoAtivo:   plano.ativo,
      dentroHorario: PlanoMaturacao.estaDentroHorario(),
      telefones: {
        total:      telefones.length,
        online:     online.length,
        disponiveis: disponiveis.length,
        emCooldown:  this.cooldowns.size
      },
      conversas: {
        realizadasHoje: conversasHoje,
        ativas: Math.floor(this.conversasAtivas.size / 2)
      },
      proximoHorario: PlanoMaturacao.estaDentroHorario()
        ? null
        : PlanoMaturacao.proximoHorarioFuncionamento()
    };
  }

  getConversasAtivas() {
    const ativas  = [];
    const vistos  = new Set();
    this.conversasAtivas.forEach((info) => {
      if (vistos.has(info.conversaId)) return;
      vistos.add(info.conversaId);
      ativas.push({
        conversaId:    info.conversaId,
        conversaNome:  info.conversaNome,
        participantes: info.participantes || [],
        mensagemAtual: info.mensagemAtual || 0,
        totalMensagens: info.totalMensagens || 0,
        progresso:     info.progresso || 0,
        iniciouEm:     info.iniciouEm || null
      });
    });
    return ativas;
  }
}

module.exports = new MaturacaoService();

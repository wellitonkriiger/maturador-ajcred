const TelefoneModel = require('../models/Telefone');
const ConversaModel = require('../models/Conversa');
const PlanoMaturacao = require('../models/PlanoMaturacao');
const WhatsAppService = require('./whatsappService');
const DelayUtils = require('../utils/delay');
const RealtimeService = require('./realtimeService');
const logger = require('../utils/logger');

const COOLDOWN_MS = 5 * 60 * 1000;
const REQUEUE_DELAY_MS = 7 * 1000;
const CICLO_AGENDAMENTO_MS = 60 * 1000;
const ERROS_CONEXAO = [
  'detached Frame',
  'Attempted to use detached Frame',
  'Execution context was destroyed',
  'Target closed',
  'Session closed',
  'Protocol error',
  'Frame detachado'
];

function isErroConexao(msg) {
  return ERROS_CONEXAO.some(entry => msg && msg.includes(entry));
}

class MaturacaoService {
  constructor() {
    this.emExecucao = false;
    this.execucoes = new Map();
    this.telefoneParaExecucao = new Map();
    this.cooldowns = new Map();
    this.historicoPares = new Map();
    this._cicloTimer = null;
    this._eventsBound = false;
  }

  _emitStatus() {
    RealtimeService.emitMaturacaoStatus({
      ...this.getStatus(),
      ativas: this.getConversasAtivas()
    });
  }

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
    this._bindEventos();
    this._cicloTimer = setInterval(() => this._tentarEmparelharTodos(), CICLO_AGENDAMENTO_MS);
    this._tentarEmparelharTodos();
    this._emitStatus();
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
    this._emitStatus();
    return true;
  }

  _bindEventos() {
    if (this._eventsBound) return;
    this._eventsBound = true;

    this._onTelefoneOnline = (id) => this._aoTelefoneOnline(id);
    this._onTelefoneOffline = (id, motivo) => this._aoTelefoneOffline(id, motivo);
    this._onTelefoneErro = (id, motivo) => this._aoTelefoneOffline(id, motivo);

    WhatsAppService.on('telefone:online', this._onTelefoneOnline);
    WhatsAppService.on('telefone:offline', this._onTelefoneOffline);
    WhatsAppService.on('telefone:erro', this._onTelefoneErro);
  }

  _unbindEventos() {
    if (!this._eventsBound) return;
    WhatsAppService.off('telefone:online', this._onTelefoneOnline);
    WhatsAppService.off('telefone:offline', this._onTelefoneOffline);
    WhatsAppService.off('telefone:erro', this._onTelefoneErro);
    this._eventsBound = false;
  }

  _aoTelefoneOnline(telefoneId) {
    if (!this.emExecucao) return;
    const tel = TelefoneModel.buscarPorId(telefoneId);
    logger.info(`[Maturacao] ${tel?.nome ?? telefoneId} ficou online -- tentando emparelhar`);
    setTimeout(() => {
      this._tentarEmparelharTelefone(telefoneId);
      this._emitStatus();
    }, 3000);
  }

  _aoTelefoneOffline(telefoneId, motivo) {
    const tel = TelefoneModel.buscarPorId(telefoneId);
    logger.warn(`[Maturacao] ${tel?.nome ?? telefoneId} ficou offline (${motivo}) -- removendo de conversas ativas`);
    this._abortarExecucaoPorTelefone(telefoneId, motivo || 'telefone_offline');
    this._emitStatus();
  }

  _telefonesDivisiveis() {
    return TelefoneModel.buscarDisponiveis().filter(t =>
      !this.telefoneParaExecucao.has(t.id) &&
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

  _embaralhar(arr) {
    const source = [...arr];
    for (let index = source.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [source[index], source[other]] = [source[other], source[index]];
    }
    return source;
  }

  _parKey(a, b) {
    return [a, b].sort().join('::');
  }

  _registrarPares(participantes) {
    const agora = Date.now();
    for (let index = 0; index < participantes.length; index++) {
      for (let other = index + 1; other < participantes.length; other++) {
        this.historicoPares.set(this._parKey(participantes[index].id, participantes[other].id), agora);
      }
    }
  }

  _selecionarParceiro(base, candidatos, usados, plano) {
    const elegiveis = candidatos.filter(candidate =>
      candidate.id !== base.id &&
      !usados.has(candidate.id) &&
      candidate.configuracao?.podeReceberMensagens !== false &&
      this._podeParticipar(candidate, plano)
    );

    if (elegiveis.length === 0) return null;

    const nuncaUsados = elegiveis.filter(candidate => !this.historicoPares.has(this._parKey(base.id, candidate.id)));
    if (nuncaUsados.length > 0) {
      return this._embaralhar(nuncaUsados)[0];
    }

    const menorTimestamp = Math.min(...elegiveis.map(candidate => this.historicoPares.get(this._parKey(base.id, candidate.id)) || 0));
    const menosRecentes = elegiveis.filter(candidate =>
      (this.historicoPares.get(this._parKey(base.id, candidate.id)) || 0) === menorTimestamp
    );

    return this._embaralhar(menosRecentes)[0];
  }

  _formarPares(candidatos, plano) {
    const aptos = candidatos.filter(t => this._podeParticipar(t, plano));
    if (aptos.length < 2) return [];

    const embaralhados = this._embaralhar(aptos);
    const usados = new Set();
    const pares = [];

    for (const tel of embaralhados) {
      if (usados.has(tel.id)) continue;
      if (!tel.configuracao.podeIniciarConversa) continue;
      const parceiro = this._selecionarParceiro(tel, embaralhados, usados, plano);
      if (!parceiro) continue;
      usados.add(tel.id);
      usados.add(parceiro.id);
      pares.push([tel, parceiro]);
    }

    if (pares.length === 0 && aptos.length >= 2) {
      const base = this._embaralhar(aptos)[0];
      const parceiro = this._selecionarParceiro(base, aptos, new Set([base.id]), plano);
      if (parceiro) {
        pares.push([base, parceiro]);
      }
    }

    return pares;
  }

  _tentarEmparelharTodos() {
    if (!this.emExecucao) return;
    if (!PlanoMaturacao.estaDentroHorario()) {
      this._emitStatus();
      return;
    }

    const livres = this._telefonesDivisiveis();
    if (livres.length < 2) {
      this._emitStatus();
      return;
    }

    const plano = PlanoMaturacao.obter();
    const pares = this._formarPares(livres, plano);
    for (const par of pares) {
      this._iniciarConversa(par);
    }

    this._emitStatus();
  }

  _tentarEmparelharTelefone(telefoneId) {
    if (!this.emExecucao) return;
    if (!PlanoMaturacao.estaDentroHorario()) return;
    if (this.telefoneParaExecucao.has(telefoneId)) return;
    if (this._emCooldown(telefoneId)) return;

    const tel = TelefoneModel.buscarPorId(telefoneId);
    if (!tel) return;
    if (!WhatsAppService.estaOperacional(telefoneId)) return;
    if (tel.configuracao.conversasRealizadasHoje >= tel.configuracao.quantidadeConversasDia) return;

    const plano = PlanoMaturacao.obter();
    const parceiro = this._selecionarParceiro(
      tel,
      this._embaralhar(this._telefonesDivisiveis()),
      new Set(),
      plano
    );

    if (!parceiro) {
      logger.debug(`[Maturacao] ${tel.nome} online mas sem parceiro disponivel no momento`);
      return;
    }

    this._iniciarConversa([tel, parceiro]);
    this._emitStatus();
  }

  _novaExecucaoId() {
    return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  _iniciarConversa(participantes) {
    const idsEmUso = [...new Set([...this.execucoes.values()].map(exec => exec.conversaId))];
    const conversa = ConversaModel.selecionarAleatoria(participantes.length, idsEmUso);
    if (!conversa) {
      logger.warn(`[Maturacao] Nenhuma conversa disponivel para ${participantes.length} participantes`);
      return;
    }

    const totalMensagens = conversa.mensagens.filter(item => item.texto).length;
    const execucao = {
      conversaExecucaoId: this._novaExecucaoId(),
      conversaId: conversa.id,
      conversaNome: conversa.nome,
      participantes: participantes.map(item => ({
        id: item.id,
        nome: item.nome,
        numero: item.numero
      })),
      status: 'running',
      mensagemAtual: 0,
      totalMensagens,
      progresso: 0,
      iniciouEm: new Date().toISOString(),
      ultimoEventoEm: new Date().toISOString(),
      motivoFalha: null
    };

    logger.info(`[Maturacao] Iniciando: "${conversa.nome}" | ${participantes.map(p => p.nome).join(' <-> ')}`);

    this._registrarPares(participantes);
    this.execucoes.set(execucao.conversaExecucaoId, execucao);
    participantes.forEach(p => this.telefoneParaExecucao.set(p.id, execucao.conversaExecucaoId));
    RealtimeService.emitConversaStarted(execucao);

    this._executarConversa(conversa, participantes, execucao.conversaExecucaoId).catch((error) => {
      logger.error(`[Maturacao] Erro nao tratado na conversa "${conversa.nome}": ${error.message}`);
      this._finalizarExecucao(execucao.conversaExecucaoId, false, error.message);
    });
  }

  async _executarConversa(conversa, participantes, execucaoId) {
    let mensagensEnviadas = 0;
    const totalMensagens = conversa.mensagens.filter(item => item.texto).length;

    try {
      for (let index = 0; index < conversa.mensagens.length; index++) {
        if (!this.emExecucao) {
          logger.info(`[Maturacao] Maturacao pausada -- interrompendo "${conversa.nome}"`);
          break;
        }

        const execucao = this.execucoes.get(execucaoId);
        if (!execucao || execucao.status !== 'running') {
          break;
        }

        const msg = conversa.mensagens[index];
        if (msg.tipo === 'pausa_longa') {
          const duracao = DelayUtils.getRandomDelay(msg.duracao.min, msg.duracao.max);
          logger.info(`[Maturacao] Pausa longa: ${DelayUtils.formatDuration(duracao)}`);
          await DelayUtils.sleep(duracao);
          continue;
        }

        const remetente = participantes[msg.remetente];
        const destinatarios = participantes.filter((_, idx) => idx !== msg.remetente);
        if (!remetente) {
          logger.error(`[Maturacao] Remetente invalido: indice ${msg.remetente}`);
          continue;
        }

        if (!WhatsAppService.estaOperacional(remetente.id)) {
          logger.warn(`[Maturacao] ${remetente.nome} nao operacional -- abortando conversa`);
          this._iniciarCooldown(remetente.id, `${remetente.nome} desconectou durante conversa`);
          this._finalizarExecucao(execucaoId, false, `${remetente.nome} desconectou durante conversa`);
          return;
        }

        const delay = DelayUtils.getRandomDelay(msg.delay.min, msg.delay.max);
        logger.info(`[Maturacao] Delay: ${DelayUtils.formatDuration(delay)} | #${msg.ordem} [${remetente.nome}]: "${msg.texto}"`);
        await DelayUtils.sleep(delay);

        for (const dest of destinatarios) {
          try {
            if (msg.comportamento?.marcarComoLida && index > 0 && WhatsAppService.estaOperacional(dest.id)) {
              const tempoLeitura = DelayUtils.getRandomDelay(
                msg.comportamento.tempoAntesLeitura.min,
                msg.comportamento.tempoAntesLeitura.max
              );
              await DelayUtils.sleep(tempoLeitura);
              await WhatsAppService.marcarComoLida(dest.id, remetente.numero);
            }

            if (msg.comportamento?.simularDigitacao) {
              const tempoDigitacao = DelayUtils.getRandomDelay(
                msg.comportamento.tempoDigitacao.min,
                msg.comportamento.tempoDigitacao.max
              );
              const digitacaoOk = await WhatsAppService.simularDigitacao(remetente.id, dest.numero, tempoDigitacao);
              if (!digitacaoOk) {
                throw new Error(`Frame detachado durante digitacao: ${remetente.nome}`);
              }
            }

            if (!WhatsAppService.estaOperacional(remetente.id)) {
              throw new Error(`Frame detachado apos delay: ${remetente.nome}`);
            }

            await WhatsAppService.enviarMensagem(remetente.id, dest.numero, msg.texto);
            TelefoneModel.incrementarMensagensRecebidas(dest.id);
            RealtimeService.emitTelefoneStatus(TelefoneModel.buscarPorId(dest.id));
            logger.info(`[Maturacao] Enviado! [${remetente.nome} -> ${dest.nome}]: "${msg.texto}"`);
          } catch (error) {
            if (isErroConexao(error.message)) {
              logger.warn(`[Maturacao] Conexao perdida (${remetente.nome}) -- iniciando cooldown e abortando conversa`);
              this._iniciarCooldown(remetente.id, error.message);
              this._finalizarExecucao(execucaoId, false, error.message);
              return;
            }

            logger.error(`[Maturacao] Falha ao enviar [${remetente.nome} -> ${dest.nome}]: ${error.message}`);
          }
        }

        mensagensEnviadas++;
        const progresso = Math.floor((mensagensEnviadas / totalMensagens) * 100);
        const execucaoAtual = this.execucoes.get(execucaoId);
        if (execucaoAtual) {
          execucaoAtual.mensagemAtual = mensagensEnviadas;
          execucaoAtual.progresso = progresso;
          execucaoAtual.ultimoEventoEm = new Date().toISOString();
          RealtimeService.emitConversaUpdated({ ...execucaoAtual });
        }
      }

      logger.info(`[Maturacao] Conversa "${conversa.nome}" finalizada! (${mensagensEnviadas}/${totalMensagens} msgs)`);
      this._finalizarExecucao(execucaoId, true, null);
    } catch (error) {
      logger.error(`[Maturacao] Conversa abortada: ${error.message}`);
      this._finalizarExecucao(execucaoId, false, error.message);
    }
  }

  _scheduleRequeue(execucao) {
    if (!this.emExecucao) return;
    execucao.participantes.forEach((participante) => {
      const tel = TelefoneModel.buscarPorId(participante.id);
      if (!tel || tel.status !== 'online') return;
      setTimeout(() => {
        if (this.emExecucao) {
          this._tentarEmparelharTelefone(participante.id);
        }
      }, REQUEUE_DELAY_MS);
    });
  }

  _finalizarExecucao(execucaoId, sucesso, motivoFalha = null) {
    const execucao = this.execucoes.get(execucaoId);
    if (!execucao) return;

    execucao.status = sucesso ? 'finished' : 'aborted';
    execucao.motivoFalha = motivoFalha;
    execucao.ultimoEventoEm = new Date().toISOString();

    execucao.participantes.forEach((participante) => {
      this.telefoneParaExecucao.delete(participante.id);
      if (sucesso) {
        TelefoneModel.incrementarConversas(participante.id);
        RealtimeService.emitTelefoneStatus(TelefoneModel.buscarPorId(participante.id));
      }
    });

    RealtimeService.emitConversaFinished({ ...execucao });
    this.execucoes.delete(execucaoId);

    if (!sucesso) {
      this._scheduleRequeue(execucao);
    }

    this._emitStatus();
  }

  _abortarExecucaoPorTelefone(telefoneId, motivo) {
    const execucaoId = this.telefoneParaExecucao.get(telefoneId);
    if (!execucaoId) return;
    this._finalizarExecucao(execucaoId, false, motivo);
  }

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
      this._emitStatus();
    }, COOLDOWN_MS);
  }

  getStatus() {
    const plano = PlanoMaturacao.obter();
    const telefones = TelefoneModel.listar();
    const online = TelefoneModel.buscarOnline();
    const disponiveis = this._telefonesDivisiveis();
    const conversasHoje = telefones.reduce((sum, tel) => sum + tel.configuracao.conversasRealizadasHoje, 0);

    return {
      emExecucao: this.emExecucao,
      planoAtivo: plano.ativo,
      dentroHorario: PlanoMaturacao.estaDentroHorario(),
      telefones: {
        total: telefones.length,
        online: online.length,
        disponiveis: disponiveis.length,
        emCooldown: this.cooldowns.size
      },
      conversas: {
        realizadasHoje: conversasHoje,
        ativas: this.execucoes.size
      },
      proximoHorario: PlanoMaturacao.estaDentroHorario() ? null : PlanoMaturacao.proximoHorarioFuncionamento()
    };
  }

  getConversasAtivas() {
    return [...this.execucoes.values()].map(execucao => ({
      ...execucao,
      participantes: execucao.participantes.map(item => item.nome)
    }));
  }
}

module.exports = new MaturacaoService();

const TelefoneModel = require('../models/Telefone');
const ConversaModel = require('../models/Conversa');
const PlanoMaturacao = require('../models/PlanoMaturacao');
const WhatsAppService = require('./whatsappService');
const DelayUtils = require('../utils/delay');
const RealtimeService = require('./realtimeService');
const RuntimeDiagnosticsService = require('./runtimeDiagnosticsService');
const logger = require('../utils/logger');

const COOLDOWN_MS = 5 * 60 * 1000;
const REQUEUE_DELAY_MS = 7 * 1000;
const CICLO_AGENDAMENTO_MS = 60 * 1000;
const MAX_CONVERSAS_MESMO_PAR_DIA_DEFAULT = 3;
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
    this.contagemParesDia = new Map();
    this.paresBloqueadosHoje = new Set();
    this._diaControlePares = this._diaAtualLocal();
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
      RuntimeDiagnosticsService.record('maturacao', 'start_ignored', {
        motivo: 'ja_em_execucao'
      });
      return false;
    }

    const plano = PlanoMaturacao.obter();
    if (!plano.ativo) {
      PlanoMaturacao.setAtivo(true);
      logger.info('Plano ativado automaticamente ao iniciar maturacao');
    }

    this.emExecucao = true;
    const status = this.getStatus();
    RuntimeDiagnosticsService.record('maturacao', 'started', {
      planoAtivo: plano.ativo,
      dentroHorario: status.dentroHorario,
      telefones: status.telefones,
      conversas: status.conversas
    });
    logger.info(
      `[RuntimeDoctor] Maturacao start context ${RuntimeDiagnosticsService.toLogString({
        planoAtivo: plano.ativo,
        dentroHorario: status.dentroHorario,
        telefones: status.telefones,
        conversas: status.conversas
      })}`
    );
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
      RuntimeDiagnosticsService.record('maturacao', 'stop_ignored', {
        motivo: 'nao_estava_em_execucao'
      });
      return false;
    }

    this.emExecucao = false;
    if (this._cicloTimer) {
      clearInterval(this._cicloTimer);
      this._cicloTimer = null;
    }
    this._unbindEventos();
    RuntimeDiagnosticsService.record('maturacao', 'stopped', this.getStatus());
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

  _diaAtualLocal() {
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  _rotacionarControleDiarioPares() {
    const diaAtual = this._diaAtualLocal();
    if (diaAtual === this._diaControlePares) return;

    this._diaControlePares = diaAtual;
    this.contagemParesDia.clear();
    this.paresBloqueadosHoje.clear();
    logger.info('[Maturacao] Novo dia detectado -- limites de pares reiniciados');
  }

  _limiteParesPorDia(plano) {
    const limite = Number(plano?.estrategia?.maxConversasMesmoParDia);
    if (!Number.isFinite(limite)) return MAX_CONVERSAS_MESMO_PAR_DIA_DEFAULT;
    if (limite <= 0) return null;
    return Math.max(1, Math.floor(limite));
  }

  _normalizarIntervaloEntreConversas(plano) {
    const minPlano = Number(plano?.intervalosGlobais?.entreConversas?.min);
    const maxPlano = Number(plano?.intervalosGlobais?.entreConversas?.max);

    const min = Number.isFinite(minPlano) && minPlano > 0 ? minPlano : 0;
    let max = Number.isFinite(maxPlano) && maxPlano > 0 ? maxPlano : min;

    if (max < min) max = min;
    return { min, max };
  }

  _sortearIntervaloEntreConversas(plano) {
    const { min, max } = this._normalizarIntervaloEntreConversas(plano);
    return Math.max(0, DelayUtils.getRandomDelay(min, max));
  }

  _calcularProximaDisponibilidade(plano) {
    const esperaMs = this._sortearIntervaloEntreConversas(plano);
    return {
      esperaMs,
      proximaConversaDisponivelEm: new Date(Date.now() + esperaMs).toISOString()
    };
  }

  _parAtingiuLimiteDiario(a, b, limiteParesPorDia) {
    if (!limiteParesPorDia) return false;
    this._rotacionarControleDiarioPares();

    const key = this._parKey(a, b);
    if (this.paresBloqueadosHoje.has(key)) return true;

    return (this.contagemParesDia.get(key) || 0) >= limiteParesPorDia;
  }

  _registrarParesConcluidosNoDia(participantes, limiteParesPorDia) {
    if (!limiteParesPorDia) return;
    this._rotacionarControleDiarioPares();

    for (let index = 0; index < participantes.length; index++) {
      for (let other = index + 1; other < participantes.length; other++) {
        const atual = participantes[index];
        const parceiro = participantes[other];
        const key = this._parKey(atual.id, parceiro.id);
        const total = (this.contagemParesDia.get(key) || 0) + 1;
        this.contagemParesDia.set(key, total);

        if (total >= limiteParesPorDia && !this.paresBloqueadosHoje.has(key)) {
          this.paresBloqueadosHoje.add(key);
          logger.info(`[Maturacao] Par bloqueado ate virar o dia: ${atual.nome} <-> ${parceiro.nome} (${total}/${limiteParesPorDia})`);
        }
      }
    }
  }

  _podeParticipar(tel, plano) {
    const proximaDisponibilidade = tel.configuracao?.proximaConversaDisponivelEm;
    if (proximaDisponibilidade) {
      const alvo = new Date(proximaDisponibilidade).getTime();
      if (!Number.isNaN(alvo)) {
        return Date.now() >= alvo;
      }
    }

    if (!tel.configuracao.ultimaConversaEm) return true;
    const decorrido = (Date.now() - new Date(tel.configuracao.ultimaConversaEm).getTime()) / 1000;
    const { min } = this._normalizarIntervaloEntreConversas(plano);
    return decorrido >= min;
  }

  _embaralhar(arr) {
    const source = [...arr];
    for (let index = source.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [source[index], source[other]] = [source[other], source[index]];
    }
    return source;
  }

  _estrategiaAtiva(plano, chave, fallback = true) {
    const valor = plano?.estrategia?.[chave];
    return typeof valor === 'boolean' ? valor : fallback;
  }

  _sensibilidadeScore(sensibilidade) {
    if (sensibilidade === 'alta') return 2;
    if (sensibilidade === 'media') return 1;
    return 0;
  }

  _ordenarCandidatos(candidatos, plano) {
    const randomizar = this._estrategiaAtiva(plano, 'randomizarParticipantes', true);
    const distribuirUniformemente = this._estrategiaAtiva(plano, 'distribuirUniformemente', true);
    const prioridadeAlta = this._estrategiaAtiva(plano, 'prioridadeTelefonesAltaSensibilidade', true);
    const ordenados = randomizar ? this._embaralhar(candidatos) : [...candidatos];

    return ordenados.sort((a, b) => {
      if (distribuirUniformemente) {
        const conversasA = Number(a.configuracao?.conversasRealizadasHoje || 0);
        const conversasB = Number(b.configuracao?.conversasRealizadasHoje || 0);
        if (conversasA !== conversasB) return conversasA - conversasB;

        const ultimaA = a.configuracao?.ultimaConversaEm ? new Date(a.configuracao.ultimaConversaEm).getTime() : 0;
        const ultimaB = b.configuracao?.ultimaConversaEm ? new Date(b.configuracao.ultimaConversaEm).getTime() : 0;
        if (ultimaA !== ultimaB) return ultimaA - ultimaB;
      }

      if (prioridadeAlta) {
        const sensA = this._sensibilidadeScore(a.sensibilidade);
        const sensB = this._sensibilidadeScore(b.sensibilidade);
        if (sensA !== sensB) return sensB - sensA;
      }

      if (randomizar) return 0;
      return String(a.nome || a.id).localeCompare(String(b.nome || b.id), 'pt-BR');
    });
  }

  _ordenarParticipantesParaConversa(participantes, plano) {
    if (this._estrategiaAtiva(plano, 'randomizarParticipantes', true)) {
      return this._embaralhar(participantes);
    }

    return [...participantes].sort((a, b) => String(a.nome || a.id).localeCompare(String(b.nome || b.id), 'pt-BR'));
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
    const limiteParesPorDia = this._limiteParesPorDia(plano);
    const evitarRepeticao = this._estrategiaAtiva(plano, 'evitarRepeticaoConversas', true);
    const elegiveis = candidatos.filter(candidate =>
      candidate.id !== base.id &&
      !usados.has(candidate.id) &&
      candidate.configuracao?.podeReceberMensagens !== false &&
      !this._parAtingiuLimiteDiario(base.id, candidate.id, limiteParesPorDia) &&
      this._podeParticipar(candidate, plano)
    );

    if (elegiveis.length === 0) return null;
    const ordenados = this._ordenarCandidatos(elegiveis, plano);
    if (!evitarRepeticao) {
      return ordenados[0];
    }

    const nuncaUsados = ordenados.filter(candidate => !this.historicoPares.has(this._parKey(base.id, candidate.id)));
    if (nuncaUsados.length > 0) {
      return nuncaUsados[0];
    }

    const menorTimestamp = Math.min(...ordenados.map(candidate => this.historicoPares.get(this._parKey(base.id, candidate.id)) || 0));
    const menosRecentes = ordenados.filter(candidate =>
      (this.historicoPares.get(this._parKey(base.id, candidate.id)) || 0) === menorTimestamp
    );

    return menosRecentes[0] || ordenados[0];
  }

  _formarPares(candidatos, plano) {
    const aptos = candidatos.filter(t => this._podeParticipar(t, plano));
    if (aptos.length < 2) return [];

    const ordenados = this._ordenarCandidatos(aptos, plano);
    const usados = new Set();
    const pares = [];

    for (const tel of ordenados) {
      if (usados.has(tel.id)) continue;
      if (!tel.configuracao.podeIniciarConversa) continue;
      const parceiro = this._selecionarParceiro(tel, ordenados, usados, plano);
      if (!parceiro) continue;
      usados.add(tel.id);
      usados.add(parceiro.id);
      pares.push([tel, parceiro]);
    }

    if (pares.length === 0 && aptos.length >= 2) {
      const base = ordenados.find(item => item.configuracao?.podeIniciarConversa !== false) || ordenados[0];
      const parceiro = this._selecionarParceiro(base, ordenados, new Set([base.id]), plano);
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
      this._iniciarConversa(par, plano);
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
    if (!this._podeParticipar(tel, plano)) return;

    const parceiro = this._selecionarParceiro(
      tel,
      this._ordenarCandidatos(this._telefonesDivisiveis(), plano),
      new Set(),
      plano
    );

    if (!parceiro) {
      logger.debug(`[Maturacao] ${tel.nome} online mas sem parceiro disponivel no momento`);
      return;
    }

    this._iniciarConversa([tel, parceiro], plano);
    this._emitStatus();
  }

  _novaExecucaoId() {
    return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  _iniciarConversa(participantes, plano = PlanoMaturacao.obter()) {
    const participantesOrdenados = this._ordenarParticipantesParaConversa(participantes, plano);
    const idsEmUso = [...new Set([...this.execucoes.values()].map(exec => exec.conversaId))];
    const conversa = ConversaModel.selecionarAleatoria(participantesOrdenados.length, idsEmUso);
    if (!conversa) {
      logger.warn(`[Maturacao] Nenhuma conversa disponivel para ${participantesOrdenados.length} participantes`);
      return;
    }

    const totalMensagens = conversa.mensagens.filter(item => item.texto).length;
    const execucao = {
      conversaExecucaoId: this._novaExecucaoId(),
      conversaId: conversa.id,
      conversaNome: conversa.nome,
      participantes: participantesOrdenados.map(item => ({
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

    RuntimeDiagnosticsService.record('maturacao', 'conversation_started', {
      execucaoId: execucao.conversaExecucaoId,
      conversaId: execucao.conversaId,
      conversaNome: execucao.conversaNome,
      participantes: execucao.participantes.map((item) => item.nome)
    });
    logger.info(`[Maturacao] Iniciando: "${conversa.nome}" | ${participantesOrdenados.map(p => p.nome).join(' <-> ')}`);

    this._registrarPares(participantesOrdenados);
    this.execucoes.set(execucao.conversaExecucaoId, execucao);
    participantesOrdenados.forEach(p => this.telefoneParaExecucao.set(p.id, execucao.conversaExecucaoId));
    RealtimeService.emitConversaStarted(execucao);

    this._executarConversa(conversa, participantesOrdenados, execucao.conversaExecucaoId).catch((error) => {
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
    const plano = PlanoMaturacao.obter();

    execucao.status = sucesso ? 'finished' : 'aborted';
    execucao.motivoFalha = motivoFalha;
    execucao.ultimoEventoEm = new Date().toISOString();
    RuntimeDiagnosticsService.record('maturacao', sucesso ? 'conversation_finished' : 'conversation_aborted', {
      execucaoId,
      conversaId: execucao.conversaId,
      conversaNome: execucao.conversaNome,
      participantes: execucao.participantes.map((item) => item.nome),
      motivoFalha
    });

    if (sucesso) {
      const limiteParesPorDia = this._limiteParesPorDia(plano);
      this._registrarParesConcluidosNoDia(execucao.participantes, limiteParesPorDia);
    }

    execucao.participantes.forEach((participante) => {
      this.telefoneParaExecucao.delete(participante.id);
      if (sucesso) {
        const { esperaMs, proximaConversaDisponivelEm } = this._calcularProximaDisponibilidade(plano);
        TelefoneModel.incrementarConversas(participante.id, { proximaConversaDisponivelEm });

        logger.info(
          `[Maturacao] ${participante.nome} aguardara ${DelayUtils.formatDuration(esperaMs)} antes da proxima conversa`
        );

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
    RuntimeDiagnosticsService.record('maturacao', 'cooldown_started', {
      telefoneId,
      telefone: tel?.nome ?? telefoneId,
      motivo,
      cooldownMs: COOLDOWN_MS
    });
    logger.info(`[Maturacao] ${tel?.nome ?? telefoneId} em cooldown por ${COOLDOWN_MS / 60000} min (${motivo})`);

    setTimeout(() => {
      if (!this.emExecucao) return;
      this.cooldowns.delete(telefoneId);
      RuntimeDiagnosticsService.record('maturacao', 'cooldown_finished', {
        telefoneId,
        telefone: tel?.nome ?? telefoneId
      });
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

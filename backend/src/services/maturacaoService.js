// src/services/maturacaoService.js

const TelefoneModel = require('../models/Telefone');
const ConversaModel = require('../models/Conversa');
const PlanoMaturacaoModel = require('../models/PlanoMaturacao');
const WhatsAppService = require('./whatsappService');
const DelayUtils = require('../utils/delay');
const logger = require('../utils/logger');

class MaturacaoService {
  constructor() {
    this.emExecucao = false;
    this.conversasAtivas = new Map();
  }

  async iniciar() {
    if (this.emExecucao) {
      logger.warn('⚠️ Maturação já está em execução');
      return false;
    }

    const plano = PlanoMaturacaoModel.obter();

    if (!plano.ativo) {
      PlanoMaturacaoModel.setAtivo(true);
      logger.info('📅 Plano ativado automaticamente ao iniciar maturação');
    }

    this.emExecucao = true;
    logger.info('🚀 Processo de maturação iniciado');
    this.executarLoop();
    return true;
  }

  parar() {
    if (!this.emExecucao) {
      logger.warn('⚠️ Maturação não está em execução');
      return false;
    }
    this.emExecucao = false;
    logger.info('⏸️ Processo de maturação pausado');
    return true;
  }

  async executarLoop() {
    logger.info('🔁 Loop de maturação iniciado');

    while (this.emExecucao) {
      try {
        const plano = PlanoMaturacaoModel.obter();

        // Verificar horário
        if (!PlanoMaturacaoModel.estaDentroHorario()) {
          const proxima = PlanoMaturacaoModel.proximoHorarioFuncionamento();
          logger.info(`⏰ Fora do horário. Próximo início: ${proxima.toLocaleString('pt-BR')}`);
          await DelayUtils.sleep(5 * 60 * 1000);
          continue;
        }

        // Diagnóstico do ciclo
        const todosOsTelefones = TelefoneModel.listar();
        const online = TelefoneModel.buscarOnline();
        const disponiveis = TelefoneModel.buscarDisponiveis();
        logger.debug(`🔍 Ciclo | Total: ${todosOsTelefones.length} | Online: ${online.length} | Disponíveis: ${disponiveis.length} | Conv. ativas: ${this.conversasAtivas.size}`);

        // Selecionar participantes
        const participantes = this.selecionarParticipantes();

        if (!participantes || participantes.length < 2) {
          logger.info(`⏳ Sem participantes suficientes. Online: ${online.length} | Disponíveis: ${disponiveis.length}`);
          if (online.length < 2) {
            logger.info('   → Conecte pelo menos 2 telefones ao WhatsApp');
          } else if (disponiveis.length < 2) {
            logger.info('   → Telefones online mas aguardando intervalo entre conversas');
          }
          await DelayUtils.sleep(60 * 1000);
          continue;
        }

        // Selecionar conversa
        const conversa = ConversaModel.selecionarAleatoria(participantes.length);

        if (!conversa) {
          logger.warn(`⚠️ Nenhuma conversa compatível para ${participantes.length} participantes`);
          await DelayUtils.sleep(60 * 1000);
          continue;
        }

        logger.info(`💬 Iniciando: "${conversa.nome}" | ${participantes.map(p => p.nome).join(' ↔ ')}`);
        await this.executarConversa(conversa, participantes);

        const intervalo = DelayUtils.getRandomDelay(
          plano.intervalosGlobais.entreConversas.min,
          plano.intervalosGlobais.entreConversas.max
        );
        logger.info(`⏰ Aguardando ${DelayUtils.formatDuration(intervalo)} até próxima conversa...`);
        await DelayUtils.sleep(intervalo);

      } catch (error) {
        logger.error(`❌ Erro no loop de maturação: ${error.message}`);
        logger.error(error.stack);
        await DelayUtils.sleep(60 * 1000);
      }
    }

    logger.info('⏹️ Loop de maturação encerrado');
  }

  selecionarParticipantes() {
    const plano = PlanoMaturacaoModel.obter();
    const disponiveis = TelefoneModel.buscarDisponiveis();

    logger.debug(`👥 selecionarParticipantes: ${disponiveis.length} disponível(is)`);

    if (disponiveis.length < 2) {
      logger.debug('   → Menos de 2 disponíveis');
      return null;
    }

    const podeIniciar = disponiveis.filter(t => t.configuracao.podeIniciarConversa);
    if (podeIniciar.length === 0) {
      logger.warn('⚠️ Nenhum disponível pode iniciar conversa (verificar "podeIniciarConversa")');
      return null;
    }

    const agora = new Date();
    const telefonesOk = disponiveis.filter(t => {
      if (!t.configuracao.ultimaConversaEm) return true;
      const ultima = new Date(t.configuracao.ultimaConversaEm);
      const decorrido = (agora - ultima) / 1000;
      const ok = decorrido >= plano.intervalosGlobais.entreConversas.min;
      if (!ok) {
        const restante = plano.intervalosGlobais.entreConversas.min - decorrido;
        logger.debug(`   ${t.nome}: aguardando intervalo (${Math.ceil(restante)}s restantes)`);
      }
      return ok;
    });

    logger.debug(`   Após filtro de intervalo: ${telefonesOk.length} telefone(s) ok`);

    if (telefonesOk.length < 2) {
      logger.debug('   → Menos de 2 após filtro de intervalo entre conversas');
      return null;
    }

    let candidatos = [...telefonesOk];

    if (plano.estrategia.prioridadeTelefonesAltaSensibilidade) {
      candidatos.sort((a, b) => {
        const ordem = { alta: 0, media: 1, baixa: 2 };
        return ordem[a.sensibilidade] - ordem[b.sensibilidade];
      });
    }

    if (plano.estrategia.randomizarParticipantes) {
      candidatos = this.shuffleArray(candidatos);
    }

    let participantes = [];
    const primeiroIndex = candidatos.findIndex(t => t.configuracao.podeIniciarConversa);
    if (primeiroIndex !== -1) {
      participantes.push(candidatos[primeiroIndex]);
      candidatos.splice(primeiroIndex, 1);
    } else {
      return null;
    }

    if (candidatos.length > 0) {
      participantes.push(candidatos[0]);
    } else {
      return null;
    }

    logger.debug(`   Selecionados: ${participantes.map(p => `${p.nome}(${p.numero})`).join(' ↔ ')}`);
    return participantes;
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  async executarConversa(conversa, participantes) {
    try {
      logger.info(`🎬 Conversa: "${conversa.nome}"`);
      logger.info(`👥 ${participantes.map(p => `${p.nome}(${p.numero})`).join(' ↔ ')}`);
      logger.info(`📨 ${conversa.mensagens.length} entradas (${conversa.mensagens.filter(m => m.texto).length} msgs de texto)`);

      participantes.forEach(p => {
        this.conversasAtivas.set(p.id, { conversaId: conversa.id, progresso: 0 });
      });

      let mensagensEnviadas = 0;
      const totalMensagens = conversa.mensagens.filter(m => m.texto).length;

      for (let i = 0; i < conversa.mensagens.length; i++) {
        const msg = conversa.mensagens[i];

        // Pausa longa
        if (msg.tipo === 'pausa_longa') {
          const duracao = DelayUtils.getRandomDelay(msg.duracao.min, msg.duracao.max);
          logger.info(`⏸️ Pausa longa: ${DelayUtils.formatDuration(duracao)}`);
          await DelayUtils.sleep(duracao);
          continue;
        }

        const remetente = participantes[msg.remetente];
        const destinatarios = participantes.filter((_, idx) => idx !== msg.remetente);

        if (!remetente) {
          logger.error(`❌ Remetente inválido: índice ${msg.remetente} — mensagem #${msg.ordem}`);
          continue;
        }

        // Verificar conexão do remetente
        if (!WhatsAppService.estaConectado(remetente.id)) {
          logger.error(`❌ ${remetente.nome} (${remetente.id}) não está conectado. Abortando conversa.`);
          break;
        }

        // Delay antes de enviar
        const delay = DelayUtils.getRandomDelay(msg.delay.min, msg.delay.max);
        logger.info(`⏳ Delay: ${DelayUtils.formatDuration(delay)} | Próxima: #${msg.ordem} [${remetente.nome}]: "${msg.texto}"`);
        await DelayUtils.sleep(delay);

        for (const destinatario of destinatarios) {
          try {
            // Marcar como lida
            if (msg.comportamento?.marcarComoLida && i > 0) {
              const tempoLeitura = DelayUtils.getRandomDelay(
                msg.comportamento.tempoAntesLeitura.min,
                msg.comportamento.tempoAntesLeitura.max
              );
              logger.debug(`👁️ ${destinatario.nome} lendo (${DelayUtils.formatDuration(tempoLeitura)})...`);
              await DelayUtils.sleep(tempoLeitura);
              await WhatsAppService.marcarComoLida(destinatario.id, remetente.numero);
            }

            // Simular digitação
            if (msg.comportamento?.simularDigitacao) {
              const tempoDigitacao = DelayUtils.getRandomDelay(
                msg.comportamento.tempoDigitacao.min,
                msg.comportamento.tempoDigitacao.max
              );
              logger.debug(`✍️ ${remetente.nome} digitando (${DelayUtils.formatDuration(tempoDigitacao)})...`);
              await WhatsAppService.simularDigitacao(remetente.id, destinatario.numero, tempoDigitacao);
            }

            // Enviar mensagem
            await WhatsAppService.enviarMensagem(remetente.id, destinatario.numero, msg.texto);
            logger.info(`✅ Enviado! [${remetente.nome} → ${destinatario.nome}]: "${msg.texto}"`);
            TelefoneModel.incrementarMensagensRecebidas(destinatario.id);

          } catch (error) {
            logger.error(`❌ Falha ao enviar para ${destinatario.nome}: ${error.message}`);
            logger.error(`   remetente.id   : ${remetente.id}`);
            logger.error(`   remetente.numero: ${remetente.numero}`);
            logger.error(`   destinatario.id : ${destinatario.id}`);
            logger.error(`   destinatario.numero: ${destinatario.numero}`);
          }
        }

        mensagensEnviadas++;
        const progresso = Math.floor((mensagensEnviadas / totalMensagens) * 100);
        participantes.forEach(p => {
          const ativo = this.conversasAtivas.get(p.id);
          if (ativo) ativo.progresso = progresso;
        });
        logger.debug(`📊 Progresso: ${mensagensEnviadas}/${totalMensagens} (${progresso}%)`);
      }

      logger.info(`🎉 Conversa "${conversa.nome}" finalizada! (${mensagensEnviadas}/${totalMensagens} msgs)`);

      participantes.forEach(p => {
        TelefoneModel.incrementarConversas(p.id);
        this.conversasAtivas.delete(p.id);
      });

      ConversaModel.incrementarUso(conversa.id);

    } catch (error) {
      logger.error(`❌ Erro ao executar conversa: ${error.message}`);
      logger.error(error.stack);
      participantes.forEach(p => this.conversasAtivas.delete(p.id));
    }
  }

  getStatus() {
    const plano = PlanoMaturacaoModel.obter();
    const telefones = TelefoneModel.listar();
    const telefonesOnline = TelefoneModel.buscarOnline();
    const telefonesDisponiveis = TelefoneModel.buscarDisponiveis();
    const conversasHoje = telefones.reduce((total, t) => total + t.configuracao.conversasRealizadasHoje, 0);

    return {
      emExecucao: this.emExecucao,
      planoAtivo: plano.ativo,
      dentroHorario: PlanoMaturacaoModel.estaDentroHorario(),
      telefones: {
        total: telefones.length,
        online: telefonesOnline.length,
        disponiveis: telefonesDisponiveis.length
      },
      conversas: {
        realizadasHoje: conversasHoje,
        ativas: this.conversasAtivas.size
      },
      proximoHorario: PlanoMaturacaoModel.estaDentroHorario()
        ? null
        : PlanoMaturacaoModel.proximoHorarioFuncionamento()
    };
  }

  getConversasAtivas() {
    const ativas = [];
    this.conversasAtivas.forEach((info, telefoneId) => {
      const telefone = TelefoneModel.buscarPorId(telefoneId);
      const conversa = ConversaModel.buscarPorId(info.conversaId);
      ativas.push({
        telefone: telefone?.nome,
        conversa: conversa?.nome,
        progresso: info.progresso
      });
    });
    return ativas;
  }
}

module.exports = new MaturacaoService();
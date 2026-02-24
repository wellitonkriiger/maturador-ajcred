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
    this.conversasAtivas = new Map(); // telefoneId -> { conversaId, progresso }
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
        // Verificar horário
        if (!PlanoMaturacaoModel.estaDentroHorario()) {
          const proxima = PlanoMaturacaoModel.proximoHorarioFuncionamento();
          logger.info(`⏰ Fora do horário. Próximo início: ${proxima.toLocaleString('pt-BR')}`);
          await DelayUtils.sleep(5 * 60 * 1000);
          continue;
        }

        const plano = PlanoMaturacaoModel.obter();

        // Buscar telefones disponíveis que não estejam em conversa ativa
        const disponiveis = this._buscarDisponiveisParaNovaConversa();
        const online = TelefoneModel.buscarOnline();
        const conversasEmAndamento = Math.floor(this.conversasAtivas.size / 2);

        logger.debug(`🔍 Ciclo | Online: ${online.length} | Disponíveis p/ nova conversa: ${disponiveis.length} | Conv. ativas: ${conversasEmAndamento}`);

        if (disponiveis.length < 2) {
          if (this.conversasAtivas.size > 0) {
            // Há conversas em andamento — aguarda e verifica novamente
            logger.debug('⏳ Telefones em uso. Aguardando disponibilidade...');
            await DelayUtils.sleep(15 * 1000);
          } else {
            logger.info(`⏳ Sem participantes suficientes. Online: ${online.length} | Disponíveis: ${disponiveis.length}`);
            if (online.length < 2) {
              logger.info('   → Conecte pelo menos 2 telefones ao WhatsApp');
            } else {
              logger.info('   → Todos os telefones aguardando intervalo entre conversas');
            }
            await DelayUtils.sleep(60 * 1000);
          }
          continue;
        }

        // Montar o máximo de pares possíveis com os disponíveis
        const pares = this._montarPares(disponiveis, plano);

        if (pares.length === 0) {
          logger.info('⚠️ Nenhum par válido formado (intervalo entre conversas ainda não expirou)');
          await DelayUtils.sleep(30 * 1000);
          continue;
        }

        // Disparar todos os pares em paralelo
        for (const participantes of pares) {
          const conversa = ConversaModel.selecionarAleatoria(participantes.length);
          if (!conversa) {
            logger.warn(`⚠️ Nenhuma conversa compatível para ${participantes.length} participantes`);
            continue;
          }

          logger.info(`💬 Iniciando: "${conversa.nome}" | ${participantes.map(p => p.nome).join(' ↔ ')}`);

          // Marca como em uso ANTES de disparar (para o próximo ciclo não reutilizá-los)
          const iniciouEm = new Date().toISOString();
          const totalMsgs = conversa.mensagens.filter(m => m.texto).length;
          participantes.forEach(p => {
            this.conversasAtivas.set(p.id, {
              conversaId: conversa.id,
              conversaNome: conversa.nome,
              participantes: participantes.map(x => x.nome),
              mensagemAtual: 0,
              totalMensagens: totalMsgs,
              progresso: 0,
              iniciouEm
            });
          });

          // Disparo assíncrono — não bloqueia o loop principal
          this.executarConversa(conversa, participantes).catch(err => {
            logger.error(`❌ Erro não tratado na conversa "${conversa.nome}": ${err.message}`);
            participantes.forEach(p => this.conversasAtivas.delete(p.id));
          });
        }

        // Intervalo entre ciclos de agendamento
        const intervaloAgendamento = DelayUtils.getRandomDelay(
          plano.intervalosGlobais.entreConversas.min,
          plano.intervalosGlobais.entreConversas.max
        );
        logger.info(`⏰ Próximo ciclo de agendamento em ${DelayUtils.formatDuration(intervaloAgendamento)}...`);
        await DelayUtils.sleep(intervaloAgendamento);

      } catch (error) {
        logger.error(`❌ Erro no loop de maturação: ${error.message}`);
        logger.error(error.stack);
        await DelayUtils.sleep(60 * 1000);
      }
    }

    logger.info('⏹️ Loop de maturação encerrado');
  }

  /**
   * Retorna telefones online, disponíveis (abaixo do limite diário)
   * e que NÃO estejam em conversa ativa no momento.
   */
  _buscarDisponiveisParaNovaConversa() {
    const emUso = new Set(this.conversasAtivas.keys());
    return TelefoneModel.buscarDisponiveis().filter(t => !emUso.has(t.id));
  }

  /**
   * Monta o máximo de pares (2 a 2) a partir dos candidatos,
   * respeitando o intervalo mínimo entre conversas.
   */
  _montarPares(candidatos, plano) {
    const agora = new Date();

    // Filtrar pelo intervalo mínimo entre conversas
    const aptos = candidatos.filter(t => {
      if (!t.configuracao.ultimaConversaEm) return true;
      const ultima = new Date(t.configuracao.ultimaConversaEm);
      const decorrido = (agora - ultima) / 1000;
      const ok = decorrido >= plano.intervalosGlobais.entreConversas.min;
      if (!ok) {
        const restante = Math.ceil(plano.intervalosGlobais.entreConversas.min - decorrido);
        logger.debug(`   ${t.nome}: aguardando intervalo (${restante}s restantes)`);
      }
      return ok;
    });

    if (aptos.length < 2) return [];

    // Embaralha para variar combinações a cada ciclo
    const embaralhados = this.shuffleArray(aptos);

    const usados = new Set();
    const pares = [];

    for (let i = 0; i < embaralhados.length; i++) {
      const iniciador = embaralhados[i];
      if (usados.has(iniciador.id)) continue;
      if (!iniciador.configuracao.podeIniciarConversa) continue;

      // Encontra primeiro receptor disponível (diferente e não usado)
      const receptor = embaralhados.find(t =>
        t.id !== iniciador.id && !usados.has(t.id)
      );

      if (!receptor) break;

      usados.add(iniciador.id);
      usados.add(receptor.id);
      pares.push([iniciador, receptor]);

      logger.debug(`   Par formado: ${iniciador.nome} ↔ ${receptor.nome}`);
    }

    // Se nenhum "iniciador" encontrado mas há 2+ aptos, usa os dois primeiros
    if (pares.length === 0 && aptos.length >= 2) {
      logger.debug('   Nenhum com podeIniciarConversa — usando primeiros dois disponíveis');
      pares.push([embaralhados[0], embaralhados[1]]);
    }

    return pares;
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Verifica se o cliente Puppeteer ainda está com a página ativa.
   * client.info preenchido NÃO garante que o frame ainda está vivo.
   */
  _estaOperacional(telefoneId) {
    const client = WhatsAppService.getCliente(telefoneId);
    if (!client || !client.info) return false;
    try {
      const page = client.pupPage;
      if (!page || page.isClosed()) return false;
      return true;
    } catch {
      return false;
    }
  }

  async executarConversa(conversa, participantes) {
    try {
      logger.info(`🎬 Conversa: "${conversa.nome}"`);
      logger.info(`👥 ${participantes.map(p => `${p.nome}(${p.numero})`).join(' ↔ ')}`);
      logger.info(`📨 ${conversa.mensagens.length} entradas`);

      let mensagensEnviadas = 0;
      const totalMensagens = conversa.mensagens.filter(m => m.texto).length;

      for (let i = 0; i < conversa.mensagens.length; i++) {
        // Para se maturação foi pausada
        if (!this.emExecucao) {
          logger.info(`⏹️ Maturação pausada — interrompendo conversa "${conversa.nome}"`);
          break;
        }

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

        // Verifica operacionalidade antes de qualquer operação
        if (!this._estaOperacional(remetente.id)) {
          logger.error(`❌ ${remetente.nome} não está operacional (frame detachado). Abortando conversa.`);
          break;
        }

        // Delay antes de enviar
        const delay = DelayUtils.getRandomDelay(msg.delay.min, msg.delay.max);
        logger.info(`⏳ Delay: ${DelayUtils.formatDuration(delay)} | Próxima: #${msg.ordem} [${remetente.nome}]: "${msg.texto}"`);
        await DelayUtils.sleep(delay);

        for (const destinatario of destinatarios) {
          const destinatarioOk = this._estaOperacional(destinatario.id);

          try {
            // Marcar como lida
            if (msg.comportamento?.marcarComoLida && i > 0 && destinatarioOk) {
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

            // Verifica operacionalidade novamente após os delays
            if (!this._estaOperacional(remetente.id)) {
              logger.error(`❌ ${remetente.nome} perdeu conexão durante delays. Abortando.`);
              throw new Error(`Frame detachado após delay: ${remetente.nome}`);
            }

            await WhatsAppService.enviarMensagem(remetente.id, destinatario.numero, msg.texto);
            logger.info(`✅ Enviado! [${remetente.nome} → ${destinatario.nome}]: "${msg.texto}"`);
            TelefoneModel.incrementarMensagensRecebidas(destinatario.id);

          } catch (error) {
            const isFrameDetach = error.message && (
              error.message.includes('detached Frame') ||
              error.message.includes('Execution context was destroyed') ||
              error.message.includes('Target closed') ||
              error.message.includes('Frame detachado')
            );

            if (isFrameDetach) {
              logger.warn(`⚠️ Conexão perdida (${remetente.nome}) — abortando conversa`);
              // Não altera status aqui — o evento 'disconnected' do wwebjs fará isso
              throw error; // encerra o executarConversa
            }

            // Erros não fatais — loga e continua
            logger.error(`❌ Falha ao enviar para ${destinatario.nome}: ${error.message}`);
            logger.error(`   remetente: ${remetente.nome} (${remetente.id}) → ${remetente.numero}`);
            logger.error(`   destinatario: ${destinatario.nome} (${destinatario.id}) → ${destinatario.numero}`);
          }
        }

        mensagensEnviadas++;
        const progresso = Math.floor((mensagensEnviadas / totalMensagens) * 100);
        participantes.forEach(p => {
          const ativo = this.conversasAtivas.get(p.id);
          if (ativo) {
            ativo.progresso = progresso;
            ativo.mensagemAtual = mensagensEnviadas;
          }
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
        ativas: Math.floor(this.conversasAtivas.size / 2)
      },
      proximoHorario: PlanoMaturacaoModel.estaDentroHorario()
        ? null
        : PlanoMaturacaoModel.proximoHorarioFuncionamento()
    };
  }

  getConversasAtivas() {
    // Cada conversa ocupa 2 slots no Map (um por participante). Deduplica por conversaId.
    const ativas = [];
    const vistos = new Set();
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
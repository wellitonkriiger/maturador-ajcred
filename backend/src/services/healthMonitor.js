// src/services/healthMonitor.js
// Responsabilidade unica: verificar a saude de cada cliente WhatsApp ativo.
// A cada intervalo, testa se o Puppeteer ainda esta vivo. Se nao, emite
// evento para o whatsappService que por sua vez notifica o maturacaoService.

const logger = require('../utils/logger');
const TelefoneModel = require('../models/Telefone');

const INTERVALO_VERIFICACAO_MS = 30 * 1000; // 30 segundos

class HealthMonitor {
  constructor() {
    this.timer = null;
    this.whatsappService = null; // injetado no start() para evitar circular dependency
  }

  start(whatsappService) {
    if (this.timer) return;
    this.whatsappService = whatsappService;
    logger.info(`[HealthMonitor] Iniciado -- verificando clientes a cada ${INTERVALO_VERIFICACAO_MS / 1000}s`);
    this.timer = setInterval(() => this._verificarTodos(), INTERVALO_VERIFICACAO_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[HealthMonitor] Parado');
    }
  }

  _verificarTodos() {
    const ws = this.whatsappService;
    if (!ws) return;

    ws.clients.forEach((client, telefoneId) => {
      // So verifica clientes que deveriam estar online (tem client.info)
      if (!client.info) return;

      const telefone = TelefoneModel.buscarPorId(telefoneId);
      const nome = telefone?.nome ?? telefoneId;

      let operacional = false;
      try {
        const page = client.pupPage;
        operacional = !!(page && !page.isClosed());
      } catch {
        operacional = false;
      }

      if (!operacional) {
        logger.warn(`[HealthMonitor] ${nome} nao esta operacional -- tentando reconectar`);
        ws.tentarReconectar(telefoneId, { auto: true }).catch((error) => {
          logger.warn(`[HealthMonitor] Reconexao falhou para ${nome}: ${error.message}`);
          TelefoneModel.atualizarStatus(telefoneId, 'offline');
          ws.emit('telefone:offline', telefoneId, 'health_check_failed');
        });
      } else {
        // Atualiza status para online caso tenha ficado travado em outro estado
        if (telefone && telefone.status !== 'online') {
          logger.info(`[HealthMonitor] ${nome} operacional mas status era '${telefone.status}' -- corrigindo para online`);
          TelefoneModel.atualizarStatus(telefoneId, 'online', telefone.numero);
        }
      }
    });

    // Verifica telefones que o modelo considera online mas nao tem cliente ativo
    const telefonesOnline = TelefoneModel.buscarOnline();
    telefonesOnline.forEach(tel => {
      const temCliente = ws.clients.has(tel.id);
      const client = ws.clients.get(tel.id);
      const temInfo = !!(client && client.info);

      if (!temCliente || !temInfo) {
        logger.warn(`[HealthMonitor] ${tel.nome} marcado como online mas sem cliente ativo -- corrigindo para offline`);
        TelefoneModel.atualizarStatus(tel.id, 'offline');
        ws.emit('telefone:offline', tel.id, 'ghost_online');
        ws.tentarReconectar(tel.id, { auto: true }).catch((error) => {
          logger.warn(`[HealthMonitor] Reconexao apos ghost_online falhou para ${tel.nome}: ${error.message}`);
        });
      }
    });
  }
}

module.exports = new HealthMonitor();

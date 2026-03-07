const logger = require('../utils/logger');
const TelefoneModel = require('../models/Telefone');

const INTERVALO_VERIFICACAO_MS = 30 * 1000; // 30 segundos

class HealthMonitor {
  constructor() {
    this.timer = null;
    this.whatsappService = null;
  }

  start(whatsappService) {
    if (this.timer) return;
    this.whatsappService = whatsappService;
    logger.info(`[HealthMonitor] Iniciado -- verificando clientes a cada ${INTERVALO_VERIFICACAO_MS / 1000}s`);
    this.timer = setInterval(() => {
      this._verificarTodos().catch((error) => {
        logger.warn(`[HealthMonitor] Falha na verificacao: ${error.message}`);
      });
    }, INTERVALO_VERIFICACAO_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[HealthMonitor] Parado');
    }
  }

  async _verificarTodos() {
    const ws = this.whatsappService;
    if (!ws) return;

    for (const [telefoneId, client] of ws.clients.entries()) {
      if (!client.info) continue;

      const telefone = TelefoneModel.buscarPorId(telefoneId);
      const nome = telefone?.nome ?? telefoneId;

      let operacional = true;
      if (typeof ws._checkPage === 'function') {
        operacional = await ws._checkPage(telefoneId, { recover: true });
      } else {
        try {
          const page = client.pupPage;
          operacional = !!(page && !page.isClosed());
        } catch {
          operacional = false;
        }
      }

      if (!operacional) {
        logger.warn(`[HealthMonitor] ${nome} nao esta operacional -- reconexao automatica em andamento`);
      }
    }

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

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

    // Verifica telefones que o modelo considera online mas nao tem cliente ativo
    const telefonesOnline = TelefoneModel.buscarOnline();
    for (const tel of telefonesOnline) {
      const meta = typeof ws.getClientMeta === 'function' ? ws.getClientMeta(tel.id) : null;
      const operacional = typeof ws.estaOperacional === 'function' ? ws.estaOperacional(tel.id) : false;

      if (operacional || meta?.reconnectInFlight || meta?.nextAutoReconnectAt) {
        continue;
      }

      logger.warn(`[HealthMonitor] ${tel.nome} marcado como online mas sem cliente operacional -- corrigindo para offline`);

      if (typeof ws._transitionToOffline === 'function') {
        await ws._transitionToOffline(tel.id, 'ghost_online', {
          scheduleReconnect: false,
          destroyClient: false,
          waState: null
        });
      } else {
        TelefoneModel.atualizarStatus(tel.id, 'offline');
        ws.emit('telefone:offline', tel.id, 'ghost_online');
      }

      ws.tentarReconectar(tel.id, { auto: true }).catch((error) => {
        logger.warn(`[HealthMonitor] Reconexao apos ghost_online falhou para ${tel.nome}: ${error.message}`);
      });
    }
  }
}

module.exports = new HealthMonitor();

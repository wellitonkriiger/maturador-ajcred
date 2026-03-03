const noop = () => {};

class RealtimeService {
  constructor() {
    this.io = null;
  }

  setIO(io) {
    this.io = io;
  }

  emit(event, payload) {
    if (!this.io) return;
    this.io.emit(event, payload);
  }

  emitTelefoneStatus(telefone) {
    if (!telefone) return;
    this.emit('telefone:status', {
      telefoneId: telefone.id,
      telefone
    });
  }

  emitTelefoneQRCode(telefoneId, payload) {
    this.emit('telefone:qrcode', {
      telefoneId,
      ...payload
    });
  }

  clearTelefoneQRCode(telefoneId) {
    this.emit('telefone:qr_cleared', { telefoneId });
  }

  emitReconnectAttempt(telefoneId, status, message = null) {
    this.emit('telefone:reconnect_attempt', {
      telefoneId,
      status,
      message
    });
  }

  emitMaturacaoStatus(payload) {
    this.emit('maturacao:status', payload);
  }

  emitConversaStarted(payload) {
    this.emit('maturacao:conversa_started', payload);
  }

  emitConversaUpdated(payload) {
    this.emit('maturacao:conversa_updated', payload);
  }

  emitConversaFinished(payload) {
    this.emit('maturacao:conversa_finished', payload);
  }

  emitLog(payload) {
    this.emit('logs:tail', payload);
  }
}

module.exports = new RealtimeService();

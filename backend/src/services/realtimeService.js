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

  hasSocket(socketId) {
    if (!this.io || !socketId) return false;
    return this.io.sockets?.sockets?.has(socketId) === true;
  }

  emitToSocket(socketId, event, payload) {
    if (!this.io || !socketId) return false;
    if (!this.hasSocket(socketId)) return false;
    this.io.to(socketId).emit(event, payload);
    return true;
  }

  emitTelefoneStatus(telefone) {
    if (!telefone) return;
    this.emit('telefone:status', {
      telefoneId: telefone.id,
      telefone
    });
  }

  emitTelefoneQRCode(telefoneId, payload, socketId = null) {
    const eventPayload = {
      telefoneId,
      ...payload
    };

    if (socketId) {
      return this.emitToSocket(socketId, 'telefone:qrcode', eventPayload);
    }

    this.emit('telefone:qrcode', eventPayload);
    return true;
  }

  emitTelefonePairingCode(telefoneId, payload, socketId = null) {
    const eventPayload = {
      telefoneId,
      ...payload
    };

    if (socketId) {
      return this.emitToSocket(socketId, 'telefone:pairing_code', eventPayload);
    }

    this.emit('telefone:pairing_code', eventPayload);
    return true;
  }

  clearTelefoneQRCode(telefoneId, socketId = null) {
    const eventPayload = { telefoneId };
    if (socketId) {
      return this.emitToSocket(socketId, 'telefone:qr_cleared', eventPayload);
    }

    this.emit('telefone:qr_cleared', eventPayload);
    return true;
  }

  clearTelefonePairingCode(telefoneId, socketId = null) {
    const eventPayload = { telefoneId };
    if (socketId) {
      return this.emitToSocket(socketId, 'telefone:pairing_code_cleared', eventPayload);
    }

    this.emit('telefone:pairing_code_cleared', eventPayload);
    return true;
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

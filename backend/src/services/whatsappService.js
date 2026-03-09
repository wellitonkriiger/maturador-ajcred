const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const logger = require('../utils/logger');
const TelefoneModel = require('../models/Telefone');
const DelayUtils = require('../utils/delay');
const RealtimeService = require('./realtimeService');

const KEEPALIVE_INTERVAL_MS = 25 * 1000;
const KEEPALIVE_EVAL_TIMEOUT_MS = 4 * 1000;
const KEEPALIVE_STATE_TIMEOUT_MS = 4 * 1000;
const AUTO_RECONNECT_DELAY_MS = 30 * 1000;
const MAX_AUTO_RECONNECT_ATTEMPTS = 6;
const TRANSIENT_INIT_ERRORS = [
  'The browser is already running for',
  'Cannot read properties of undefined'
];
const CONNECTION_ERRORS = [
  'Execution context was destroyed',
  'Target closed',
  'Session closed',
  'Protocol error',
  'detached Frame',
  'Attempted to use detached Frame',
  'Navigation failed',
  "Cannot read properties of undefined (reading 'getChat')"
];
const OPERATIONAL_WA_STATES = new Set(['CONNECTED', 'OPENING', 'PAIRING', 'TIMEOUT']);
const NON_OPERATIONAL_WA_STATES = new Set([
  'UNPAIRED',
  'UNPAIRED_IDLE',
  'TOS_BLOCK',
  'SMB_TOS_BLOCK',
  'PROXYBLOCK',
  'DEPRECATED_VERSION',
  'UNLAUNCHED'
]);

function isConnectionError(message) {
  const text = message?.message ?? String(message ?? '');
  return CONNECTION_ERRORS.some(entry => text.includes(entry));
}

function isTransientInitError(message) {
  const text = message?.message ?? String(message ?? '');
  return TRANSIENT_INIT_ERRORS.some(entry => text.includes(entry));
}

function firstErrorLine(message) {
  const text = message?.message ?? String(message ?? '');
  return text.split('\n')[0];
}

function sanitizePhoneNumber(phoneNumber) {
  return String(phoneNumber ?? '').replace(/\D/g, '');
}

function normalizeWaState(state) {
  const text = String(state ?? '').trim().toUpperCase();
  return text || null;
}

function isOperationalWaState(state) {
  return OPERATIONAL_WA_STATES.has(normalizeWaState(state));
}

function isNonOperationalWaState(state) {
  return NON_OPERATIONAL_WA_STATES.has(normalizeWaState(state));
}

function extractWaStateFromReason(reason) {
  const text = firstErrorLine(reason);
  const match = text.match(/WhatsApp state ([A-Z_]+)/);
  return match ? normalizeWaState(match[1]) : null;
}

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.authPath = path.join(__dirname, '../../.wwebjs_auth');
    this.clients = new Map();
    this.qrCodes = new Map();
    this.pairingCodes = new Map();
    this.connectionRequesters = new Map();
    this.clientMeta = new Map();
    this.autoSavedContacts = new Map();
    this._desconectando = new Set();
    this._keepAliveTimer = setInterval(() => this._runKeepAlive(), KEEPALIVE_INTERVAL_MS);
  }

  _createClient(telefoneId, options = {}) {
    const { pairWithPhoneNumber = null } = options;
    const clientOptions = {
      authStrategy: new LocalAuth({
        clientId: telefoneId,
        dataPath: this.authPath
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--headless=new'
        ]
      }
    };

    if (pairWithPhoneNumber?.phoneNumber) {
      clientOptions.pairWithPhoneNumber = {
        phoneNumber: sanitizePhoneNumber(pairWithPhoneNumber.phoneNumber),
        showNotification: pairWithPhoneNumber.showNotification !== false,
        intervalMs: Number(pairWithPhoneNumber.intervalMs) > 0 ? Number(pairWithPhoneNumber.intervalMs) : 180000
      };
    }

    return new Client(clientOptions);
  }

  _meta(telefoneId) {
    const existing = this.clientMeta.get(telefoneId);
    if (existing) return existing;

    const meta = {
      telefoneId,
      state: 'offline',
      waState: null,
      waStateUpdatedAt: null,
      lastReadyAt: null,
      lastActivityAt: null,
      lastKeepAliveAt: null,
      reconnectInFlight: false,
      lastDisconnectReason: null,
      autoReconnectAttempts: 0,
      autoReconnectTimer: null,
      nextAutoReconnectAt: null,
      manualDisconnect: false,
      activeClientToken: 0,
      offlineTransitionInFlight: false
    };

    this.clientMeta.set(telefoneId, meta);
    return meta;
  }

  _touchActivity(telefoneId) {
    this._meta(telefoneId).lastActivityAt = new Date().toISOString();
  }

  _setWaState(telefoneId, waState) {
    const meta = this._meta(telefoneId);
    meta.waState = normalizeWaState(waState);
    meta.waStateUpdatedAt = new Date().toISOString();
    return meta.waState;
  }

  _isCurrentClient(telefoneId, client, clientToken = null) {
    const currentClient = this.clients.get(telefoneId);
    if (client && currentClient !== client) {
      return false;
    }

    if (clientToken !== null && this._meta(telefoneId).activeClientToken !== clientToken) {
      return false;
    }

    return true;
  }

  _normalizeContactIdentifier(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) {
      return { raw: '', user: '', domain: '', digits: '' };
    }

    const [userRaw = '', domain = ''] = raw.split('@');
    const user = userRaw.split(':')[0];
    const digits = user.replace(/\D/g, '');

    return { raw, user, domain, digits };
  }

  _extractPhoneDigits(value) {
    const normalized = this._normalizeContactIdentifier(value);
    if (!normalized.digits) return null;
    if (normalized.digits.length < 10) return null;
    return normalized.digits;
  }

  _resolveNumeroReal(client, fallback = null) {
    return this._extractPhoneDigits(client?.info?.wid?.user)
      || this._extractPhoneDigits(client?.info?.wid?._serialized)
      || this._extractPhoneDigits(fallback)
      || null;
  }

  _findManagedTelefoneByContact(contactId, ignoreTelefoneId = null) {
    const target = this._normalizeContactIdentifier(contactId);
    if (!target.raw) return null;

    return TelefoneModel.listar().find((telefone) => {
      if (ignoreTelefoneId && telefone.id === ignoreTelefoneId) return false;
      const identifiers = [telefone?.numero, telefone?.numeroAlt];

      return identifiers.some((value) => {
        const candidate = this._normalizeContactIdentifier(value);
        if (!candidate.raw) return false;

        if (candidate.raw === target.raw) return true;
        if (candidate.user && candidate.user === target.user) return true;
        if (candidate.digits && target.digits && candidate.digits === target.digits) return true;
        return false;
      });
    }) || null;
  }

  async _resolvePhoneNumberForContactSave(client, senderContactId, senderTelefone) {
    const normalizedSender = this._normalizeContactIdentifier(senderContactId);

    if (normalizedSender.domain === 'lid' && typeof client.getContactLidAndPhone === 'function') {
      try {
        const mapping = await client.getContactLidAndPhone([senderContactId]);
        const phoneFromMapping = this._extractPhoneDigits(mapping?.[0]?.pn);
        if (phoneFromMapping) return phoneFromMapping;
      } catch (error) {
        logger.debug(`[AutoContato] Falha ao resolver LID para telefone: ${firstErrorLine(error)}`);
      }
    }

    return this._extractPhoneDigits(senderTelefone?.numeroAlt)
      || this._extractPhoneDigits(senderTelefone?.numero)
      || this._extractPhoneDigits(senderContactId);
  }

  async _autoSaveManagedContactName(receiverTelefoneId, senderContactId) {
    const receiverClient = this.clients.get(receiverTelefoneId);
    if (!receiverClient || typeof receiverClient.saveOrEditAddressbookContact !== 'function') return;

    const senderTelefone = this._findManagedTelefoneByContact(senderContactId, receiverTelefoneId);
    if (!senderTelefone) return;

    const displayName = String(senderTelefone.nome || '').trim();
    if (!displayName) return;

    const phoneNumber = await this._resolvePhoneNumberForContactSave(receiverClient, senderContactId, senderTelefone);
    if (!phoneNumber) return;

    const cacheKey = `${receiverTelefoneId}::${senderTelefone.id}`;
    const cacheValue = `${phoneNumber}|${displayName}`;
    if (this.autoSavedContacts.get(cacheKey) === cacheValue) return;

    await receiverClient.saveOrEditAddressbookContact(phoneNumber, displayName, '', true);
    this.autoSavedContacts.set(cacheKey, cacheValue);

    const receiverName = TelefoneModel.buscarPorId(receiverTelefoneId)?.nome || receiverTelefoneId;
    logger.info(`[AutoContato] ${receiverName} salvou ${displayName} (${phoneNumber})`);
  }

  _clearReconnectTimer(telefoneId) {
    const meta = this._meta(telefoneId);
    if (meta.autoReconnectTimer) {
      clearTimeout(meta.autoReconnectTimer);
      meta.autoReconnectTimer = null;
    }
    meta.nextAutoReconnectAt = null;
  }

  _setConnectionRequester(telefoneId, socketId) {
    const normalizedSocketId = String(socketId || '').trim();
    if (!normalizedSocketId) {
      this.connectionRequesters.delete(telefoneId);
      return null;
    }

    this.connectionRequesters.set(telefoneId, normalizedSocketId);
    return normalizedSocketId;
  }

  _getConnectionRequester(telefoneId) {
    return this.connectionRequesters.get(telefoneId) || null;
  }

  _clearConnectionRequester(telefoneId) {
    this.connectionRequesters.delete(telefoneId);
  }

  _clearPendingAuthArtifacts(telefoneId) {
    const requesterSocketId = this._getConnectionRequester(telefoneId);
    this.qrCodes.delete(telefoneId);
    this.pairingCodes.delete(telefoneId);
    RealtimeService.clearTelefoneQRCode(telefoneId, requesterSocketId);
    RealtimeService.clearTelefonePairingCode(telefoneId, requesterSocketId);
  }

  _sessionDir(telefoneId) {
    return path.join(this.authPath, `session-${telefoneId}`);
  }

  temSessaoPersistida(telefoneId) {
    return fs.existsSync(this._sessionDir(telefoneId));
  }

  async removerSessao(telefoneId) {
    const sessionDir = this._sessionDir(telefoneId);
    if (!fs.existsSync(sessionDir)) return true;

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        logger.info(`Sessao removida: ${telefoneId}`);
        return true;
      } catch (error) {
        if (tentativa === 3) {
          logger.warn(`Nao foi possivel remover a sessao ${telefoneId}: ${error.message}`);
          return false;
        }
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }

    return false;
  }

  _updateStatus(telefoneId, status, numeroOrPayload = undefined) {
    let numero = undefined;
    let numeroAlt = undefined;

    if (
      numeroOrPayload &&
      typeof numeroOrPayload === 'object' &&
      !Array.isArray(numeroOrPayload)
    ) {
      numero = numeroOrPayload.numero;
      numeroAlt = numeroOrPayload.numeroAlt;
    } else {
      numero = numeroOrPayload;
    }

    const telefone = TelefoneModel.atualizarStatus(telefoneId, status, numero, numeroAlt);
    const meta = this._meta(telefoneId);
    meta.state = status;
    if (telefone) {
      RealtimeService.emitTelefoneStatus(telefone);
    }
    return telefone;
  }

  _scheduleReconnect(telefoneId, reason = 'auto_reconnect', delayMs = AUTO_RECONNECT_DELAY_MS) {
    const meta = this._meta(telefoneId);
    const telefone = TelefoneModel.buscarPorId(telefoneId);

    if (!telefone || meta.manualDisconnect) return false;
    if (meta.reconnectInFlight) return false;
    if (!this.temSessaoPersistida(telefoneId)) return false;
    if (meta.autoReconnectAttempts >= MAX_AUTO_RECONNECT_ATTEMPTS) {
      meta.nextAutoReconnectAt = null;
      logger.warn(`[AutoReconnect] ${telefone.nome} atingiu o limite de ${MAX_AUTO_RECONNECT_ATTEMPTS} tentativas automaticas`);
      RealtimeService.emitReconnectAttempt(
        telefoneId,
        'failed',
        `Limite de ${MAX_AUTO_RECONNECT_ATTEMPTS} tentativas automaticas atingido`
      );
      return false;
    }

    this._clearReconnectTimer(telefoneId);

    meta.nextAutoReconnectAt = new Date(Date.now() + delayMs).toISOString();
    meta.autoReconnectTimer = setTimeout(async () => {
      meta.autoReconnectTimer = null;
      meta.nextAutoReconnectAt = null;

      if (meta.manualDisconnect) return;
      if (this.estaOperacional(telefoneId)) {
        meta.autoReconnectAttempts = 0;
        return;
      }

      try {
        await this.tentarReconectar(telefoneId, { auto: true });
      } catch (error) {
        logger.warn(`[AutoReconnect] Falha ao reagendar ${telefoneId}: ${error.message}`);
        this._updateStatus(telefoneId, 'offline');
        this._scheduleReconnect(telefoneId, 'retry_after_error', delayMs);
      }
    }, delayMs);

    logger.info(`[AutoReconnect] ${telefone.nome} tera nova tentativa em ${Math.round(delayMs / 1000)}s (${reason})`);
    RealtimeService.emitReconnectAttempt(telefoneId, 'scheduled', `Nova tentativa em ${Math.round(delayMs / 1000)}s`);
    return true;
  }

  async _markOffline(telefoneId, reason = 'offline', { scheduleReconnect = true, destroyClient = true } = {}) {
    return this._transitionToOffline(telefoneId, reason, {
      scheduleReconnect,
      destroyClient,
      waState: extractWaStateFromReason(reason)
    });
  }

  async _recoverFromRuntimeError(telefoneId, error, context = 'runtime_error') {
    const linha = firstErrorLine(error);
    logger.warn(`[Reconnect] ${telefoneId} saiu de operacao (${context}: ${linha})`);
    await this._markOffline(telefoneId, `${context}:${linha}`, {
      scheduleReconnect: true,
      destroyClient: true
    });
    RealtimeService.emitReconnectAttempt(telefoneId, 'failed', linha);
  }

  async _destroyClient(client) {
    if (!client) return;
    try {
      await client.destroy();
    } catch (_) {}
  }

  async _transitionToOffline(telefoneId, reason = 'offline', options = {}) {
    const {
      client = null,
      clientToken = null,
      scheduleReconnect = true,
      destroyClient = true,
      nextStatus = 'offline',
      waState = undefined,
      emitOfflineEvent = true
    } = options;

    const meta = this._meta(telefoneId);
    if (client && !this._isCurrentClient(telefoneId, client, clientToken)) {
      return false;
    }
    if (meta.offlineTransitionInFlight) {
      return false;
    }

    const targetClient = client || this.clients.get(telefoneId) || null;
    meta.offlineTransitionInFlight = true;

    try {
      meta.reconnectInFlight = false;
      meta.lastDisconnectReason = reason;
      if (waState !== undefined) {
        this._setWaState(telefoneId, waState);
      }

      this._clearPendingAuthArtifacts(telefoneId);
      this._clearConnectionRequester(telefoneId);
      this.clients.delete(telefoneId);
      this._updateStatus(telefoneId, nextStatus);

      if (emitOfflineEvent) {
        this.emit('telefone:offline', telefoneId, reason);
      }

      if (destroyClient && targetClient) {
        await this._destroyClient(targetClient);
      }

      if (scheduleReconnect && nextStatus === 'offline' && !meta.manualDisconnect) {
        this._clearReconnectTimer(telefoneId);
        this._scheduleReconnect(telefoneId, reason);
      }

      return true;
    } finally {
      meta.offlineTransitionInFlight = false;
    }
  }

  async _handleClientStateChange(telefoneId, waState, options = {}) {
    const { client = null, clientToken = null } = options;

    if (client && !this._isCurrentClient(telefoneId, client, clientToken)) {
      return false;
    }

    const normalizedState = this._setWaState(telefoneId, waState);
    if (!normalizedState || !isNonOperationalWaState(normalizedState)) {
      return false;
    }

    const telefone = TelefoneModel.buscarPorId(telefoneId);
    logger.warn(`[Reconnect] ${telefone?.nome ?? telefoneId} entrou em estado nao operacional (${normalizedState})`);

    return this._transitionToOffline(telefoneId, `state_changed:${normalizedState}`, {
      client,
      clientToken,
      scheduleReconnect: true,
      destroyClient: true,
      nextStatus: 'offline',
      waState: normalizedState
    });
  }

  _bindClientEvents(client, telefoneId, options) {
    const { allowQr, isReconnect, autoReconnect, pairWithPhoneNumber, clientToken } = options;
    const telefone = TelefoneModel.buscarPorId(telefoneId);
    let lidCapturado = false;
    let qrBloqueado = false;
    let readyHandled = false;
    let onlineEmitted = false;

    const emitOnlineOnce = () => {
      if (onlineEmitted || !this._isCurrentClient(telefoneId, client, clientToken)) {
        return false;
      }

      onlineEmitted = true;
      this.emit('telefone:online', telefoneId);
      if (isReconnect) {
        RealtimeService.emitReconnectAttempt(telefoneId, 'online');
      }
      return true;
    };

    client.on('message', (msg) => {
      if (!msg || msg.fromMe) return;

      const senderContactId = msg.author || msg.from;
      if (!senderContactId) return;
      if (senderContactId === 'status@broadcast') return;
      if (String(senderContactId).includes('@g.us')) return;

      this._touchActivity(telefoneId);
      this._autoSaveManagedContactName(telefoneId, senderContactId).catch((error) => {
        logger.debug(`[AutoContato] Falha ao salvar contato automaticamente (${telefoneId}): ${firstErrorLine(error)}`);
      });
    });

    client.on('change_state', (waState) => {
      this._handleClientStateChange(telefoneId, waState, { client, clientToken }).catch((error) => {
        logger.warn(`[Reconnect] Falha ao processar estado ${waState} para ${telefone?.nome ?? telefoneId}: ${error.message}`);
      });
    });

    client.on('qr', async (qr) => {
      if (client.info || !this._isCurrentClient(telefoneId, client, clientToken)) return;

      const meta = this._meta(telefoneId);

      if (!allowQr) {
        qrBloqueado = true;
        meta.reconnectInFlight = false;
        this._clearPendingAuthArtifacts(telefoneId);
        this.clients.delete(telefoneId);

        const atingiuLimite = autoReconnect && meta.autoReconnectAttempts >= MAX_AUTO_RECONNECT_ATTEMPTS;
        const precisaQr = !autoReconnect || atingiuLimite;
        this._updateStatus(telefoneId, precisaQr ? 'requires_qr' : 'offline');
        RealtimeService.emitReconnectAttempt(
          telefoneId,
          precisaQr ? 'requires_qr' : 'failed',
          precisaQr ? 'Limite de tentativas automaticas atingido ou QR exigido' : 'Reconexao silenciosa nao concluiu'
        );

        logger.warn(`[Reconnect] ${telefone.nome} exigiu QR na tentativa silenciosa #${meta.autoReconnectAttempts}`);

        await this._destroyClient(client);

        if (autoReconnect && !atingiuLimite) {
          this._scheduleReconnect(telefoneId, 'qr_durante_reconexao');
        }
        return;
      }

      const requesterSocketId = this._getConnectionRequester(telefoneId);
      meta.autoReconnectAttempts = 0;
      this.pairingCodes.delete(telefoneId);
      RealtimeService.clearTelefonePairingCode(telefoneId, requesterSocketId);
      this.qrCodes.set(telefoneId, qr);
      this._updateStatus(telefoneId, 'conectando');
      logger.info(`QR Code gerado para ${telefone.nome} -- escaneie pelo WhatsApp`);
      console.log(`\nQR CODE para ${telefone.nome}:\n`);
      qrcode.generate(qr, { small: true });
      console.log('\n');
      RealtimeService.emitTelefoneQRCode(telefoneId, { nome: telefone.nome }, requesterSocketId);
    });

    client.on('code', (code) => {
      if (!this._isCurrentClient(telefoneId, client, clientToken)) return;
      const pairingCode = String(code ?? '').trim();
      if (!pairingCode) return;

      const requesterSocketId = this._getConnectionRequester(telefoneId);
      this.qrCodes.delete(telefoneId);
      RealtimeService.clearTelefoneQRCode(telefoneId, requesterSocketId);
      this.pairingCodes.set(telefoneId, pairingCode);
      this._updateStatus(telefoneId, 'conectando');

      logger.info(`Codigo de pareamento gerado para ${telefone.nome}: ${pairingCode}`);
      RealtimeService.emitTelefonePairingCode(telefoneId, {
        nome: telefone.nome,
        code: pairingCode,
        phoneNumber: pairWithPhoneNumber?.phoneNumber || null
      }, requesterSocketId);
    });

    client.on('authenticated', () => {
      if (!this._isCurrentClient(telefoneId, client, clientToken)) return;
      logger.info(`${telefone.nome} autenticado com sucesso`);
      this._clearPendingAuthArtifacts(telefoneId);
    });

    client.on('ready', async () => {
      if (qrBloqueado || readyHandled) return;
      if (!this._isCurrentClient(telefoneId, client, clientToken)) return;

      readyHandled = true;

      const numeroInterno = client.info?.wid?._serialized || null;
      const numeroReal = this._resolveNumeroReal(client, numeroInterno);
      const meta = this._meta(telefoneId);
      this._setWaState(telefoneId, 'CONNECTED');
      this._clearReconnectTimer(telefoneId);
      meta.autoReconnectAttempts = 0;
      meta.reconnectInFlight = false;
      meta.manualDisconnect = false;
      meta.lastDisconnectReason = null;
      meta.lastReadyAt = new Date().toISOString();
      this._touchActivity(telefoneId);

      logger.info(`${telefone.nome} ONLINE | ${numeroInterno}`);

      const telAtual = TelefoneModel.buscarPorId(telefoneId);
      const numeroRealConsolidado = numeroReal || telAtual?.numeroAlt || null;
      if (!this._isCurrentClient(telefoneId, client, clientToken)) return;

      if (lidCapturado || (telAtual?.numero && telAtual.numero.includes('@lid'))) {
        this._updateStatus(telefoneId, 'online', {
          numero: telAtual.numero,
          numeroAlt: numeroRealConsolidado
        });
        this._clearConnectionRequester(telefoneId);
        emitOnlineOnce();
        return;
      }

      this._updateStatus(telefoneId, 'online', {
        numero: numeroInterno,
        numeroAlt: numeroRealConsolidado
      });
      this._clearConnectionRequester(telefoneId);
      emitOnlineOnce();

      const capturarLid = (msg) => {
        if (!this._isCurrentClient(telefoneId, client, clientToken)) return;
        if (!msg.fromMe) return;
        client.removeListener('message_create', capturarLid);
        const lid = msg.to;
        if (lid && lid.includes('@lid')) {
          lidCapturado = true;
          logger.info(`@lid capturado para ${telefone.nome}: ${lid}`);
          this._updateStatus(telefoneId, 'online', {
            numero: lid,
            numeroAlt: numeroRealConsolidado
          });
        } else {
          logger.warn(`@lid nao encontrado para ${telefone.nome} -- usando @c.us`);
        }
      };

      client.on('message_create', capturarLid);
      await DelayUtils.sleep(2000);
      if (!this._isCurrentClient(telefoneId, client, clientToken)) {
        client.removeListener('message_create', capturarLid);
        return;
      }

      try {
        await client.sendMessage(numeroInterno, '.');
        logger.info(`Mensagem de descoberta de @lid enviada para ${telefone.nome}`);
      } catch (error) {
        client.removeListener('message_create', capturarLid);
        logger.warn(`Nao foi possivel capturar @lid de ${telefone.nome}: ${error.message}`);
      }
    });

    client.on('auth_failure', async (msg) => {
      if (!this._isCurrentClient(telefoneId, client, clientToken)) return;
      const meta = this._meta(telefoneId);
      logger.error(`Falha de autenticacao -- ${telefone.nome}: ${msg}`);

      this._clearPendingAuthArtifacts(telefoneId);
      this._clearConnectionRequester(telefoneId);
      this.clients.delete(telefoneId);
      this._clearReconnectTimer(telefoneId);

      meta.reconnectInFlight = false;
      meta.autoReconnectAttempts = MAX_AUTO_RECONNECT_ATTEMPTS;
      meta.lastDisconnectReason = 'auth_failure';
      this._setWaState(telefoneId, null);

      this._updateStatus(telefoneId, 'requires_qr');
      this.emit('telefone:erro', telefoneId, 'auth_failure');
      if (isReconnect) {
        RealtimeService.emitReconnectAttempt(telefoneId, 'requires_qr', msg);
      }

      await this._destroyClient(client);
    });

    client.on('disconnected', (reason) => {
      if (!this._isCurrentClient(telefoneId, client, clientToken)) return;
      if (this._desconectando.has(telefoneId)) return;
      this._desconectando.add(telefoneId);

      const meta = this._meta(telefoneId);
      logger.warn(`${telefone.nome} desconectado -- motivo: ${reason}`);

      const atingiuLimite = meta.autoReconnectAttempts >= MAX_AUTO_RECONNECT_ATTEMPTS;
      const nextStatus = qrBloqueado && atingiuLimite ? 'requires_qr' : 'offline';
      const nextWaState = isNonOperationalWaState(reason) ? reason : null;

      this._transitionToOffline(telefoneId, reason, {
        client,
        clientToken,
        scheduleReconnect: nextStatus === 'offline',
        destroyClient: true,
        nextStatus,
        waState: nextWaState
      }).catch((error) => {
        logger.warn(`[Reconnect] Falha ao tratar desconexao de ${telefone.nome}: ${error.message}`);
      }).finally(() => {
        setTimeout(() => {
          this._desconectando.delete(telefoneId);
        }, 1500);
      });
    });
  }

  async inicializarCliente(telefoneId, options = {}) {
    const {
      allowQr = true,
      isReconnect = false,
      autoReconnect = false,
      pairWithPhoneNumber = null,
      requesterSocketId = null
    } = options;
    const telefone = TelefoneModel.buscarPorId(telefoneId);
    if (!telefone) throw new Error(`Telefone ${telefoneId} nao encontrado`);

    const existing = this.clients.get(telefoneId);
    if (existing && this.estaOperacional(telefoneId)) {
      logger.warn(`Cliente ja operacional para ${telefone.nome} -- reaproveitando`);
      return existing;
    }

    if (existing) {
      await this._destroyClient(existing);
      this.clients.delete(telefoneId);
    }

    const meta = this._meta(telefoneId);
    meta.activeClientToken += 1;
    const clientToken = meta.activeClientToken;
    meta.manualDisconnect = false;
    meta.reconnectInFlight = !!isReconnect;
    meta.lastDisconnectReason = null;
    meta.offlineTransitionInFlight = false;
    this._setWaState(telefoneId, 'OPENING');
    if (!isReconnect) {
      meta.autoReconnectAttempts = 0;
    }
    this._clearReconnectTimer(telefoneId);

    if (isReconnect) {
      this._clearConnectionRequester(telefoneId);
    } else {
      this._setConnectionRequester(telefoneId, requesterSocketId);
    }

    logger.info(`Inicializando cliente para ${telefone.nome} (${telefoneId})...`);
    this._updateStatus(telefoneId, isReconnect ? 'reconnecting' : 'conectando');

    const client = this._createClient(telefoneId, { pairWithPhoneNumber });
    this._bindClientEvents(client, telefoneId, {
      allowQr,
      isReconnect,
      autoReconnect,
      pairWithPhoneNumber,
      clientToken
    });
    this.clients.set(telefoneId, client);
    logger.info(`Chamando initialize() para ${telefone.nome}...`);

    client.initialize().catch(async (error) => {
      const metaAtual = this._meta(telefoneId);
      const msgErro = error?.message ?? String(error);
      const linha = firstErrorLine(error);

      metaAtual.reconnectInFlight = false;
      metaAtual.lastDisconnectReason = linha;
      this._setWaState(telefoneId, extractWaStateFromReason(msgErro));
      this._clearConnectionRequester(telefoneId);
      this.clients.delete(telefoneId);
      await this._destroyClient(client);

      if (isConnectionError(msgErro) || isTransientInitError(msgErro)) {
        logger.warn(`${telefone.nome} falhou durante inicializacao (${linha})`);
        const erroTransitorio = isTransientInitError(msgErro);
        const atingiuLimite = autoReconnect && metaAtual.autoReconnectAttempts >= MAX_AUTO_RECONNECT_ATTEMPTS && !erroTransitorio;
        this._updateStatus(telefoneId, atingiuLimite ? 'requires_qr' : 'offline');
        this.emit('telefone:erro', telefoneId, msgErro);

        if (!allowQr) {
          RealtimeService.emitReconnectAttempt(
            telefoneId,
            atingiuLimite ? 'requires_qr' : 'failed',
            linha
          );
          if (autoReconnect && !atingiuLimite) {
            this._scheduleReconnect(telefoneId, 'falha_inicializacao');
          }
        }
        return;
      }

      logger.error(`Erro fatal ao inicializar ${telefone.nome}: ${msgErro}`);
      this._updateStatus(telefoneId, allowQr ? 'offline' : 'requires_qr');
      this.emit('telefone:erro', telefoneId, msgErro);
    });

    return client;
  }

  async tentarReconectar(telefoneId, options = {}) {
    const { auto = false } = options;
    const telefone = TelefoneModel.buscarPorId(telefoneId);
    if (!telefone) throw new Error(`Telefone ${telefoneId} nao encontrado`);

    const meta = this._meta(telefoneId);
    if (meta.reconnectInFlight) {
      return { status: 'reconnecting' };
    }

    if (!auto) {
      meta.autoReconnectAttempts = 0;
    } else {
      meta.autoReconnectAttempts += 1;
      if (meta.autoReconnectAttempts > MAX_AUTO_RECONNECT_ATTEMPTS) {
        meta.reconnectInFlight = false;
        this._updateStatus(telefoneId, 'offline');
        RealtimeService.emitReconnectAttempt(
          telefoneId,
          'failed',
          `Limite de ${MAX_AUTO_RECONNECT_ATTEMPTS} tentativas automaticas atingido`
        );
        return { status: 'offline', message: 'Limite de tentativas automaticas atingido' };
      }
    }

    if (!this.temSessaoPersistida(telefoneId)) {
      meta.reconnectInFlight = false;
      if (auto) {
        this._updateStatus(telefoneId, 'offline');
        return { status: 'offline', message: 'Sessao nao encontrada' };
      }
      this._updateStatus(telefoneId, 'requires_qr');
      RealtimeService.emitReconnectAttempt(telefoneId, 'requires_qr', 'Sessao expirada, QR necessario');
      return { status: 'requires_qr', message: 'Sessao expirada, QR necessario' };
    }

    meta.manualDisconnect = false;
    meta.reconnectInFlight = true;
    RealtimeService.emitReconnectAttempt(telefoneId, auto ? 'attempt' : 'reconnecting');

    const existing = this.clients.get(telefoneId);
    if (existing) {
      await this._destroyClient(existing);
      this.clients.delete(telefoneId);
    }

    await this.inicializarCliente(telefoneId, {
      allowQr: false,
      isReconnect: true,
      autoReconnect: auto
    });

    return { status: 'reconnecting' };
  }

  async desconectarCliente(telefoneId, options = {}) {
    const { removeSession = false, suppressAutoReconnect = false } = options;
    const telefone = TelefoneModel.buscarPorId(telefoneId);
    if (!telefone) {
      return false;
    }

    const meta = this._meta(telefoneId);
    meta.manualDisconnect = true;
    meta.reconnectInFlight = false;
    meta.lastDisconnectReason = 'manual_disconnect';
    this._setWaState(telefoneId, null);
    this._clearReconnectTimer(telefoneId);

    const client = this.clients.get(telefoneId);
    if (client) {
      try {
        logger.info(`Desconectando ${telefoneId}...`);
        await client.destroy();
      } catch (error) {
        logger.warn(`Erro ao destruir cliente ${telefoneId}: ${error.message}`);
      }
    } else {
      logger.warn(`desconectarCliente: ${telefoneId} nao estava na memoria`);
    }

    this.clients.delete(telefoneId);
    this._clearPendingAuthArtifacts(telefoneId);
    this._clearConnectionRequester(telefoneId);
    this._updateStatus(telefoneId, 'offline');

    if (removeSession) {
      await this.removerSessao(telefoneId);
      this.clientMeta.delete(telefoneId);
    }

    if (!suppressAutoReconnect && !removeSession) {
      meta.manualDisconnect = false;
    }

    logger.info(`Cliente ${telefoneId} desconectado`);
    return true;
  }

  async desconectarTodos() {
    logger.info('Desconectando todos os clientes...');
    const ids = [...this.clients.keys()];
    await Promise.all(ids.map(id => this.desconectarCliente(id, { suppressAutoReconnect: true })));
    logger.info('Todos os clientes desconectados');
  }

  async _runKeepAlive() {
    for (const [telefoneId] of this.clients.entries()) {
      const meta = this._meta(telefoneId);
      if (meta.reconnectInFlight) continue;

      const client = this.clients.get(telefoneId);
      if (!client || !client.info) continue;

      const ok = await this._checkPage(telefoneId, { recover: true });
      meta.lastKeepAliveAt = new Date().toISOString();
      if (ok) {
        this._touchActivity(telefoneId);
      }
    }
  }

  async _checkPage(telefoneId, { recover = false } = {}) {
    const client = this.clients.get(telefoneId);
    if (!client || !client.info) return false;

    try {
      const page = client.pupPage;
      if (!page || page.isClosed()) {
        throw new Error('Target closed');
      }

      const result = await Promise.race([
        page.evaluate(() => document.visibilityState),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Keepalive timeout')), KEEPALIVE_EVAL_TIMEOUT_MS))
      ]);

      if (typeof client.getState === 'function') {
        const waState = await Promise.race([
          client.getState(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('State timeout')), KEEPALIVE_STATE_TIMEOUT_MS))
        ]);
        this._setWaState(telefoneId, waState);

        if (!isOperationalWaState(waState)) {
          throw new Error(`WhatsApp state ${normalizeWaState(waState)}`);
        }
      }

      return result === 'visible' || result === 'hidden' || typeof result === 'string';
    } catch (error) {
      logger.warn(`[KeepAlive] ${telefoneId} perdeu a pagina (${error.message})`);
      if (recover) {
        try {
          await this._markOffline(telefoneId, `keepalive_failed:${error.message}`, {
            scheduleReconnect: true,
            destroyClient: true
          });
        } catch (reconnectError) {
          logger.warn(`[KeepAlive] Falha ao reconectar ${telefoneId}: ${reconnectError.message}`);
          this._updateStatus(telefoneId, 'offline');
          this._scheduleReconnect(telefoneId, 'keepalive_fallback');
        }
      }
      return false;
    }
  }

  estaOperacional(telefoneId) {
    const client = this.clients.get(telefoneId);
    if (!client || !client.info) return false;

    try {
      const page = client.pupPage;
      const meta = this._meta(telefoneId);
      return !!(page && !page.isClosed() && isOperationalWaState(meta.waState));
    } catch {
      return false;
    }
  }

  estaConectado(telefoneId) {
    return this.estaOperacional(telefoneId);
  }

  async enviarMensagem(telefoneIdRemetente, numeroDestinatario, texto) {
    const client = this.clients.get(telefoneIdRemetente);
    if (!client) throw new Error(`Cliente ${telefoneIdRemetente} nao encontrado`);
    if (!client.info) throw new Error(`Cliente ${telefoneIdRemetente} nao esta pronto`);

    logger.info('Enviando mensagem...');
    logger.info(`   De  : ${telefoneIdRemetente}`);
    logger.info(`   Para: ${numeroDestinatario}`);
    logger.info(`   Msg : "${texto}"`);

    try {
      const result = await client.sendMessage(numeroDestinatario, texto);
      this._touchActivity(telefoneIdRemetente);
      logger.info(`Mensagem enviada! ID: ${result?.id?._serialized ?? 'N/A'}`);
      TelefoneModel.incrementarMensagensEnviadas(telefoneIdRemetente);
      RealtimeService.emitTelefoneStatus(TelefoneModel.buscarPorId(telefoneIdRemetente));
      return true;
    } catch (error) {
      if (isConnectionError(error)) {
        await this._recoverFromRuntimeError(telefoneIdRemetente, error, 'send_message_failed').catch(() => {});
      }
      throw error;
    }
  }

  async marcarComoLida(telefoneId, numeroRemetente) {
    try {
      const client = this.clients.get(telefoneId);
      if (!client) return false;
      const chat = await client.getChatById(numeroRemetente);
      await chat.sendSeen();
      this._touchActivity(telefoneId);
      logger.debug(`[${telefoneId}] Marcou como lida: ${numeroRemetente}`);
      return true;
    } catch (error) {
      if (isConnectionError(error)) {
        await this._recoverFromRuntimeError(telefoneId, error, 'mark_seen_failed').catch(() => {});
        return false;
      }
      logger.debug(`marcarComoLida falhou (ignorado): ${error.message}`);
      return false;
    }
  }

  async simularDigitacao(telefoneId, numeroDestinatario, duracao) {
    try {
      const client = this.clients.get(telefoneId);
      if (!client) return false;
      const chat = await client.getChatById(numeroDestinatario);
      await chat.sendStateTyping();
      await DelayUtils.sleep(duracao);
      await chat.clearState();
      this._touchActivity(telefoneId);
      logger.debug(`[${telefoneId}] Simulou digitacao por ${duracao}ms`);
      return true;
    } catch (error) {
      if (isConnectionError(error)) {
        logger.warn(`[${telefoneId}] simularDigitacao: cliente indisponivel -- ${firstErrorLine(error)}`);
        await this._recoverFromRuntimeError(telefoneId, error, 'typing_failed').catch(() => {});
        return false;
      }

      logger.debug(`simularDigitacao falhou (ignorado): ${error.message}`);
      await DelayUtils.sleep(duracao);
      return true;
    }
  }

  getCliente(telefoneId) {
    return this.clients.get(telefoneId);
  }

  getQRCode(telefoneId) {
    return this.qrCodes.get(telefoneId);
  }

  getPairingCode(telefoneId) {
    return this.pairingCodes.get(telefoneId);
  }

  getClientMeta(telefoneId) {
    return this.clientMeta.get(telefoneId) ?? null;
  }

  reconciliarStatusPersistido() {
    const telefones = TelefoneModel.listar();
    const corrigidos = [];

    for (const telefone of telefones) {
      if (!['online', 'conectando', 'reconnecting'].includes(telefone.status)) {
        continue;
      }

      if (this.estaOperacional(telefone.id)) {
        continue;
      }

      const meta = this._meta(telefone.id);
      meta.state = 'offline';
      meta.lastDisconnectReason = 'startup_reconcile';
      this._setWaState(telefone.id, null);
      TelefoneModel.atualizarStatus(telefone.id, 'offline');
      corrigidos.push(telefone.nome);
    }

    if (corrigidos.length > 0) {
      logger.warn(`[Startup] ${corrigidos.length} telefone(s) com status transitorio foram reconciliados para offline: ${corrigidos.join(', ')}`);
    }

    return corrigidos;
  }

  listarConectados() {
    const lista = [];
    this.clients.forEach((client, telefoneId) => {
      if (client.info) {
        lista.push({
          telefoneId,
          numero: client.info.wid._serialized,
          nome: client.info.pushname
        });
      }
    });
    return lista;
  }
}

module.exports = new WhatsAppService();

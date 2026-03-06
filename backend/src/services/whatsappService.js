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
const OFFLINE_WA_STATES = ['UNPAIRED', 'UNPAIRED_IDLE', 'SMB_TOS_BLOCK', 'PROXYBLOCK'];

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

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.authPath = path.join(__dirname, '../../.wwebjs_auth');
    this.clients = new Map();
    this.qrCodes = new Map();
    this.pairingCodes = new Map();
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
      lastReadyAt: null,
      lastActivityAt: null,
      lastKeepAliveAt: null,
      reconnectInFlight: false,
      lastDisconnectReason: null,
      autoReconnectAttempts: 0,
      autoReconnectTimer: null,
      nextAutoReconnectAt: null,
      manualDisconnect: false
    };

    this.clientMeta.set(telefoneId, meta);
    return meta;
  }

  _touchActivity(telefoneId) {
    this._meta(telefoneId).lastActivityAt = new Date().toISOString();
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

  _findManagedTelefoneByContact(contactId, ignoreTelefoneId = null) {
    const target = this._normalizeContactIdentifier(contactId);
    if (!target.raw) return null;

    return TelefoneModel.listar().find((telefone) => {
      if (!telefone?.numero) return false;
      if (ignoreTelefoneId && telefone.id === ignoreTelefoneId) return false;

      const candidate = this._normalizeContactIdentifier(telefone.numero);
      if (!candidate.raw) return false;

      if (candidate.raw === target.raw) return true;
      if (candidate.user && candidate.user === target.user) return true;
      if (candidate.digits && target.digits && candidate.digits === target.digits) return true;
      return false;
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

    return this._extractPhoneDigits(senderTelefone?.numero) || this._extractPhoneDigits(senderContactId);
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

  _clearPendingAuthArtifacts(telefoneId) {
    this.qrCodes.delete(telefoneId);
    this.pairingCodes.delete(telefoneId);
    RealtimeService.clearTelefoneQRCode(telefoneId);
    RealtimeService.clearTelefonePairingCode(telefoneId);
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

  _updateStatus(telefoneId, status, numero = null) {
    const telefone = TelefoneModel.atualizarStatus(telefoneId, status, numero);
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
    if (meta.autoReconnectTimer || meta.reconnectInFlight) return false;
    if (!this.temSessaoPersistida(telefoneId)) return false;

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
    const meta = this._meta(telefoneId);
    const client = this.clients.get(telefoneId);

    this._clearPendingAuthArtifacts(telefoneId);
    this.clients.delete(telefoneId);
    this._updateStatus(telefoneId, 'offline');
    this.emit('telefone:offline', telefoneId, reason);

    if (destroyClient && client) {
      await this._destroyClient(client);
    }

    if (scheduleReconnect && !meta.manualDisconnect) {
      this._scheduleReconnect(telefoneId, reason);
    }
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

  _bindClientEvents(client, telefoneId, options) {
    const { allowQr, isReconnect, autoReconnect, pairWithPhoneNumber } = options;
    const telefone = TelefoneModel.buscarPorId(telefoneId);
    let lidCapturado = false;
    let qrBloqueado = false;

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

    client.on('qr', async (qr) => {
      if (client.info) return;

      const meta = this._meta(telefoneId);

      if (!allowQr) {
        qrBloqueado = true;
        meta.reconnectInFlight = false;
        meta.autoReconnectAttempts += 1;
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

      meta.autoReconnectAttempts = 0;
      this.pairingCodes.delete(telefoneId);
      RealtimeService.clearTelefonePairingCode(telefoneId);
      this.qrCodes.set(telefoneId, qr);
      this._updateStatus(telefoneId, 'conectando');
      logger.info(`QR Code gerado para ${telefone.nome} -- escaneie pelo WhatsApp`);
      console.log(`\nQR CODE para ${telefone.nome}:\n`);
      qrcode.generate(qr, { small: true });
      console.log('\n');
      RealtimeService.emitTelefoneQRCode(telefoneId, { nome: telefone.nome });
    });

    client.on('code', (code) => {
      const pairingCode = String(code ?? '').trim();
      if (!pairingCode) return;

      this.qrCodes.delete(telefoneId);
      RealtimeService.clearTelefoneQRCode(telefoneId);
      this.pairingCodes.set(telefoneId, pairingCode);
      this._updateStatus(telefoneId, 'conectando');

      logger.info(`Codigo de pareamento gerado para ${telefone.nome}: ${pairingCode}`);
      RealtimeService.emitTelefonePairingCode(telefoneId, {
        nome: telefone.nome,
        code: pairingCode,
        phoneNumber: pairWithPhoneNumber?.phoneNumber || null
      });
    });

    client.on('authenticated', () => {
      logger.info(`${telefone.nome} autenticado com sucesso`);
      this._clearPendingAuthArtifacts(telefoneId);
    });

    client.on('ready', async () => {
      if (qrBloqueado) return;

      const numeroCus = client.info?.wid?._serialized;
      const meta = this._meta(telefoneId);
      this._clearReconnectTimer(telefoneId);
      meta.autoReconnectAttempts = 0;
      meta.reconnectInFlight = false;
      meta.manualDisconnect = false;
      meta.lastDisconnectReason = null;
      meta.lastReadyAt = new Date().toISOString();
      this._touchActivity(telefoneId);

      logger.info(`${telefone.nome} ONLINE | ${numeroCus}`);

      const telAtual = TelefoneModel.buscarPorId(telefoneId);
      if (lidCapturado || (telAtual?.numero && telAtual.numero.includes('@lid'))) {
        this._updateStatus(telefoneId, 'online', telAtual.numero);
        this.emit('telefone:online', telefoneId);
        if (isReconnect) {
          RealtimeService.emitReconnectAttempt(telefoneId, 'online');
        }
        return;
      }

      this._updateStatus(telefoneId, 'online', numeroCus);

      const capturarLid = (msg) => {
        if (!msg.fromMe) return;
        client.removeListener('message_create', capturarLid);
        const lid = msg.to;
        if (lid && lid.includes('@lid')) {
          lidCapturado = true;
          logger.info(`@lid capturado para ${telefone.nome}: ${lid}`);
          this._updateStatus(telefoneId, 'online', lid);
        } else {
          logger.warn(`@lid nao encontrado para ${telefone.nome} -- usando @c.us`);
        }
        this.emit('telefone:online', telefoneId);
        if (isReconnect) {
          RealtimeService.emitReconnectAttempt(telefoneId, 'online');
        }
      };

      client.on('message_create', capturarLid);
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        await client.sendMessage(numeroCus, '.');
        logger.info(`Mensagem de descoberta de @lid enviada para ${telefone.nome}`);
      } catch (error) {
        client.removeListener('message_create', capturarLid);
        logger.warn(`Nao foi possivel capturar @lid de ${telefone.nome}: ${error.message}`);
        this.emit('telefone:online', telefoneId);
        if (isReconnect) {
          RealtimeService.emitReconnectAttempt(telefoneId, 'online');
        }
      }
    });

    client.on('auth_failure', async (msg) => {
      const meta = this._meta(telefoneId);
      logger.error(`Falha de autenticacao -- ${telefone.nome}: ${msg}`);

      this._clearPendingAuthArtifacts(telefoneId);
      this.clients.delete(telefoneId);
      this._clearReconnectTimer(telefoneId);

      meta.reconnectInFlight = false;
      meta.autoReconnectAttempts = MAX_AUTO_RECONNECT_ATTEMPTS;

      this._updateStatus(telefoneId, 'requires_qr');
      this.emit('telefone:erro', telefoneId, 'auth_failure');
      if (isReconnect) {
        RealtimeService.emitReconnectAttempt(telefoneId, 'requires_qr', msg);
      }

      await this._destroyClient(client);
    });

    client.on('disconnected', (reason) => {
      if (this._desconectando.has(telefoneId)) return;
      this._desconectando.add(telefoneId);

      const meta = this._meta(telefoneId);
      meta.lastDisconnectReason = reason;
      meta.reconnectInFlight = false;

      logger.warn(`${telefone.nome} desconectado -- motivo: ${reason}`);

      this._clearPendingAuthArtifacts(telefoneId);
      this.clients.delete(telefoneId);

      const atingiuLimite = meta.autoReconnectAttempts >= MAX_AUTO_RECONNECT_ATTEMPTS;
      const nextStatus = qrBloqueado && atingiuLimite ? 'requires_qr' : 'offline';

      this._updateStatus(telefoneId, nextStatus);
      this.emit('telefone:offline', telefoneId, reason);

      if (nextStatus === 'offline' && !meta.manualDisconnect) {
        this._scheduleReconnect(telefoneId, 'disconnect_event');
      }

      setTimeout(async () => {
        await this._destroyClient(client);
        this._desconectando.delete(telefoneId);
      }, 1500);
    });
  }

  async inicializarCliente(telefoneId, options = {}) {
    const {
      allowQr = true,
      isReconnect = false,
      autoReconnect = false,
      pairWithPhoneNumber = null
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
    meta.manualDisconnect = false;
    meta.reconnectInFlight = !!isReconnect;
    if (!isReconnect) {
      meta.autoReconnectAttempts = 0;
    }
    this._clearReconnectTimer(telefoneId);

    logger.info(`Inicializando cliente para ${telefone.nome} (${telefoneId})...`);
    this._updateStatus(telefoneId, isReconnect ? 'reconnecting' : 'conectando');

    const client = this._createClient(telefoneId, { pairWithPhoneNumber });
    this._bindClientEvents(client, telefoneId, {
      allowQr,
      isReconnect,
      autoReconnect,
      pairWithPhoneNumber
    });
    this.clients.set(telefoneId, client);
    logger.info(`Chamando initialize() para ${telefone.nome}...`);

    client.initialize().catch(async (error) => {
      const metaAtual = this._meta(telefoneId);
      const msgErro = error?.message ?? String(error);
      const linha = firstErrorLine(error);

      metaAtual.reconnectInFlight = false;
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

        if (OFFLINE_WA_STATES.includes(waState)) {
          throw new Error(`WhatsApp state ${waState}`);
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
      return !!(page && !page.isClosed());
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

// src/services/whatsappService.js
// Gerencia clientes WhatsApp e emite eventos de ciclo de vida.
// Outros servicos (maturacaoService, healthMonitor) reagem aos eventos.

const { Client, LocalAuth } = require('whatsapp-web.js');
const { EventEmitter } = require('events');
const qrcode = require('qrcode-terminal');
const path = require('path');
const logger = require('../utils/logger');
const TelefoneModel = require('../models/Telefone');
const DelayUtils = require('../utils/delay');

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();  // telefoneId -> client
    this.qrCodes = new Map();  // telefoneId -> qrRaw
  }

  // ─── INICIALIZAR ───────────────────────────────────────────────────────────

  async inicializarCliente(telefoneId) {
    const telefone = TelefoneModel.buscarPorId(telefoneId);
    if (!telefone) throw new Error(`Telefone ${telefoneId} nao encontrado`);

    if (this.clients.has(telefoneId)) {
      logger.warn(`Aviso: Cliente ja existe para ${telefone.nome} -- retornando instancia existente`);
      return this.clients.get(telefoneId);
    }

    logger.info(`Inicializando cliente para ${telefone.nome} (${telefoneId})...`);
    TelefoneModel.atualizarStatus(telefoneId, 'conectando');

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: telefone.id,
        dataPath: path.join(__dirname, '../../.wwebjs_auth')
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
    });

    // QR
    client.on('qr', (qr) => {
      if (client.info) return;
      this.qrCodes.set(telefoneId, qr);
      logger.info(`QR Code gerado para ${telefone.nome} -- escaneie pelo WhatsApp`);
      console.log(`\nQR CODE para ${telefone.nome}:\n`);
      qrcode.generate(qr, { small: true });
      console.log('\n');
    });

    // Autenticado
    client.on('authenticated', () => {
      logger.info(`${telefone.nome} autenticado com sucesso`);
      this.qrCodes.delete(telefoneId);
    });

    // Pronto
    let lidCapturado = false;

    client.on('ready', async () => {
      const numeroCus = client.info.wid._serialized;
      logger.info(`${telefone.nome} ONLINE | ${numeroCus}`);

      const telAtual = TelefoneModel.buscarPorId(telefoneId);
      if (lidCapturado || (telAtual?.numero && telAtual.numero.includes('@lid'))) {
        TelefoneModel.atualizarStatus(telefoneId, 'online', telAtual.numero);
        this.emit('telefone:online', telefoneId);
        return;
      }

      TelefoneModel.atualizarStatus(telefoneId, 'online', numeroCus);

      const capturarLid = (msg) => {
        if (!msg.fromMe) return;
        client.removeListener('message_create', capturarLid);
        const lid = msg.to;
        if (lid && lid.includes('@lid')) {
          lidCapturado = true;
          logger.info(`@lid capturado para ${telefone.nome}: ${lid}`);
          TelefoneModel.atualizarStatus(telefoneId, 'online', lid);
        } else {
          logger.warn(`@lid nao encontrado para ${telefone.nome} -- usando @c.us`);
        }
        this.emit('telefone:online', telefoneId);
      };

      client.on('message_create', capturarLid);

      await new Promise(r => setTimeout(r, 2000));

      try {
        await client.sendMessage(numeroCus, '.');
        logger.info(`Mensagem de descoberta de @lid enviada para ${telefone.nome}`);
      } catch (err) {
        client.removeListener('message_create', capturarLid);
        logger.warn(`Nao foi possivel capturar @lid de ${telefone.nome}: ${err.message}`);
        this.emit('telefone:online', telefoneId);
      }
    });

    // Falha de autenticacao
    client.on('auth_failure', (msg) => {
      logger.error(`Falha de autenticacao -- ${telefone.nome}: ${msg}`);
      TelefoneModel.atualizarStatus(telefoneId, 'erro');
      this.qrCodes.delete(telefoneId);
      this.clients.delete(telefoneId);
      this.emit('telefone:erro', telefoneId, 'auth_failure');
    });

    // Desconectado
    client.on('disconnected', (reason) => {
      logger.warn(`${telefone.nome} desconectado -- motivo: ${reason}`);
      TelefoneModel.atualizarStatus(telefoneId, 'offline');
      this.clients.delete(telefoneId);
      this.qrCodes.delete(telefoneId);
      this.emit('telefone:offline', telefoneId, reason);
    });

    this.clients.set(telefoneId, client);
    logger.info(`Chamando initialize() para ${telefone.nome}...`);

    client.initialize().catch(err => {
      logger.error(`Erro fatal ao inicializar ${telefone.nome}: ${err.message}`);
      TelefoneModel.atualizarStatus(telefoneId, 'erro');
      this.clients.delete(telefoneId);
      this.emit('telefone:erro', telefoneId, err.message);
    });

    return client;
  }

  // ─── DESCONECTAR ──────────────────────────────────────────────────────────

  async desconectarCliente(telefoneId) {
    const client = this.clients.get(telefoneId);
    if (!client) {
      logger.warn(`desconectarCliente: ${telefoneId} nao esta na memoria`);
      return false;
    }
    try {
      logger.info(`Desconectando ${telefoneId}...`);
      await client.destroy();
    } catch (err) {
      logger.warn(`Erro ao destruir cliente ${telefoneId}: ${err.message}`);
    }
    this.clients.delete(telefoneId);
    this.qrCodes.delete(telefoneId);
    TelefoneModel.atualizarStatus(telefoneId, 'offline');
    logger.info(`Cliente ${telefoneId} desconectado`);
    return true;
  }

  async desconectarTodos() {
    logger.info('Desconectando todos os clientes...');
    const ids = [...this.clients.keys()];
    await Promise.all(ids.map(id => this.desconectarCliente(id)));
    logger.info('Todos os clientes desconectados');
  }

  // ─── SAUDE DO CLIENTE ─────────────────────────────────────────────────────

  /**
   * Verifica se o Puppeteer ainda esta com a pagina ativa.
   * client.info preenchido NAO garante que o frame esta vivo.
   */
  estaOperacional(telefoneId) {
    const client = this.clients.get(telefoneId);
    if (!client || !client.info) return false;
    try {
      const page = client.pupPage;
      if (!page || page.isClosed()) return false;
      return true;
    } catch {
      return false;
    }
  }

  estaConectado(telefoneId) {
    return this.estaOperacional(telefoneId);
  }

  // ─── ENVIO E INTERACOES ───────────────────────────────────────────────────

  async enviarMensagem(telefoneIdRemetente, numeroDestinatario, texto) {
    const client = this.clients.get(telefoneIdRemetente);
    if (!client) throw new Error(`Cliente ${telefoneIdRemetente} nao encontrado`);
    if (!client.info) throw new Error(`Cliente ${telefoneIdRemetente} nao esta pronto`);

    logger.info(`Enviando mensagem...`);
    logger.info(`   De  : ${telefoneIdRemetente}`);
    logger.info(`   Para: ${numeroDestinatario}`);
    logger.info(`   Msg : "${texto}"`);

    const result = await client.sendMessage(numeroDestinatario, texto);
    logger.info(`Mensagem enviada! ID: ${result?.id?._serialized ?? 'N/A'}`);
    TelefoneModel.incrementarMensagensEnviadas(telefoneIdRemetente);
    return true;
  }

  async marcarComoLida(telefoneId, numeroRemetente) {
    try {
      const client = this.clients.get(telefoneId);
      if (!client) return false;
      const chat = await client.getChatById(numeroRemetente);
      await chat.sendSeen();
      logger.debug(`[${telefoneId}] Marcou como lida: ${numeroRemetente}`);
      return true;
    } catch (err) {
      logger.debug(`marcarComoLida falhou (ignorado): ${err.message}`);
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
      logger.debug(`[${telefoneId}] Simulou digitacao por ${duracao}ms`);
      return true;
    } catch (err) {
      logger.debug(`simularDigitacao falhou (ignorado): ${err.message}`);
      await DelayUtils.sleep(duracao);
      return false;
    }
  }

  // ─── GETTERS ──────────────────────────────────────────────────────────────

  getCliente(telefoneId)  { return this.clients.get(telefoneId); }
  getQRCode(telefoneId)   { return this.qrCodes.get(telefoneId); }

  listarConectados() {
    const lista = [];
    this.clients.forEach((client, telefoneId) => {
      if (client.info) {
        lista.push({ telefoneId, numero: client.info.wid._serialized, nome: client.info.pushname });
      }
    });
    return lista;
  }
}

module.exports = new WhatsAppService();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const logger = require('../utils/logger');
const TelefoneModel = require('../models/Telefone');
const DelayUtils = require('../utils/delay');

class WhatsAppService {
  constructor() {
    this.clients = new Map(); // telefoneId -> client
    this.qrCodes = new Map(); // telefoneId -> qrCode (string bruta)
  }

  async inicializarCliente(telefoneId) {
    try {
      const telefone = TelefoneModel.buscarPorId(telefoneId);

      if (!telefone) {
        throw new Error('Telefone não encontrado');
      }

      if (this.clients.has(telefoneId)) {
        logger.warn(`⚠️ Cliente já existe para ${telefoneId} — retornando instância existente`);
        return this.clients.get(telefoneId);
      }

      logger.info(`🔄 Inicializando cliente para ${telefone.nome} (${telefoneId})...`);
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

      // Event: QR Code gerado
      client.on('qr', (qr) => {
        if (!client.info) {
          this.qrCodes.set(telefoneId, qr);
          logger.info(`📱 QR Code gerado para ${telefone.nome} — escaneie pelo WhatsApp`);
          console.log(`\n📱 QR CODE para ${telefone.nome}:\n`);
          qrcode.generate(qr, { small: true });
          console.log('\n');
        }
      });

      // Event: Autenticado
      client.on('authenticated', () => {
        logger.info(`🔐 ${telefone.nome} autenticado com sucesso`);
        this.qrCodes.delete(telefoneId);
      });

      // Flag para garantir que a captura de @lid só ocorra uma única vez por cliente
      let lidCapturado = false;

      // Event: Pronto
      client.on('ready', async () => {
        const numeroCus = client.info.wid._serialized;
        logger.info(`✅ ${telefone.nome} está ONLINE! Número (c.us): ${numeroCus}`);

        // Se o @lid já foi capturado em uma reconexão anterior, não repete o processo
        const telAtual = TelefoneModel.buscarPorId(telefoneId);
        if (lidCapturado || (telAtual?.numero && telAtual.numero.includes('@lid'))) {
          logger.info(`ℹ️ @lid já conhecido para ${telefone.nome} — pulando captura`);
          TelefoneModel.atualizarStatus(telefoneId, 'online', telAtual.numero);
          return;
        }

        logger.info(`🔍 Tentando descobrir @lid de ${telefone.nome}...`);
        TelefoneModel.atualizarStatus(telefoneId, 'online', numeroCus);

        // Ouve o primeiro message_create gerado por si mesmo para capturar o @lid
        const capturarLid = (msg) => {
          if (!msg.fromMe) return;
          client.removeListener('message_create', capturarLid);

          const lid = msg.to;
          if (lid && lid.includes('@lid')) {
            lidCapturado = true;
            logger.info(`🆔 @lid capturado para ${telefone.nome}: ${lid}`);
            TelefoneModel.atualizarStatus(telefoneId, 'online', lid);
          } else {
            logger.warn(`⚠️ Resposta não continha @lid para ${telefone.nome}. Usando @c.us mesmo.`);
          }
        };

        client.on('message_create', capturarLid);

        // Aguarda 2s para garantir que o cliente está completamente pronto antes de enviar
        await new Promise(r => setTimeout(r, 2000));

        try {
          await client.sendMessage(numeroCus, '.');
          logger.info(`📤 Mensagem de descoberta de @lid enviada para ${telefone.nome}`);
        } catch (err) {
          // ProtocolError = contexto do Puppeteer destruído (página recarregou), ignora silenciosamente
          client.removeListener('message_create', capturarLid);
          if (err.message && err.message.includes('Execution context was destroyed')) {
            logger.warn(`⚠️ Contexto Puppeteer destruído durante captura de @lid para ${telefone.nome} — será tentado na próxima reconexão`);
          } else {
            logger.warn(`⚠️ Não foi possível enviar mensagem de descoberta de @lid para ${telefone.nome}: ${err.message}`);
          }
        }
      });

      // Event: Falha na autenticação
      client.on('auth_failure', (msg) => {
        logger.error(`❌ Falha na autenticação de ${telefone.nome}: ${msg}`);
        TelefoneModel.atualizarStatus(telefoneId, 'erro');
        this.qrCodes.delete(telefoneId);
      });

      // Event: Desconectado
      client.on('disconnected', (reason) => {
        logger.warn(`📴 ${telefone.nome} desconectado. Motivo: ${reason}`);
        TelefoneModel.atualizarStatus(telefoneId, 'offline');
        this.clients.delete(telefoneId);
        this.qrCodes.delete(telefoneId);
      });

      this.clients.set(telefoneId, client);
      logger.info(`🚀 Chamando client.initialize() para ${telefone.nome}...`);
      await client.initialize();
      return client;

    } catch (error) {
      logger.error(`❌ Erro ao inicializar cliente ${telefoneId}: ${error.message}`);
      logger.error(error.stack);
      TelefoneModel.atualizarStatus(telefoneId, 'erro');
      throw error;
    }
  }

  async desconectarCliente(telefoneId) {
    try {
      const client = this.clients.get(telefoneId);

      if (!client) {
        logger.warn(`⚠️ Cliente ${telefoneId} não está na memória`);
        return false;
      }

      logger.info(`📴 Desconectando cliente ${telefoneId}...`);
      await client.destroy();
      this.clients.delete(telefoneId);
      this.qrCodes.delete(telefoneId);
      TelefoneModel.atualizarStatus(telefoneId, 'offline');
      logger.info(`✅ Cliente ${telefoneId} desconectado`);
      return true;

    } catch (error) {
      logger.error(`❌ Erro ao desconectar ${telefoneId}: ${error.message}`);
      return false;
    }
  }

  getCliente(telefoneId) {
    return this.clients.get(telefoneId);
  }

  getQRCode(telefoneId) {
    return this.qrCodes.get(telefoneId);
  }

  estaConectado(telefoneId) {
    const client = this.clients.get(telefoneId);
    const conectado = !!(client && client.info);
    logger.debug(`🔌 estaConectado(${telefoneId}): ${conectado}`);
    return conectado;
  }

  async enviarMensagem(telefoneIdRemetente, numeroDestinatario, texto) {
    try {
      const client = this.getCliente(telefoneIdRemetente);

      if (!client) {
        throw new Error(`Cliente ${telefoneIdRemetente} não está na memória`);
      }

      if (!client.info) {
        throw new Error(`Cliente ${telefoneIdRemetente} não está pronto (sem client.info)`);
      }

      logger.info(`📤 Enviando mensagem...`);
      logger.info(`   De  : ${telefoneIdRemetente}`);
      logger.info(`   Para: ${numeroDestinatario}`);
      logger.info(`   Msg : "${texto}"`);

      const result = await client.sendMessage(numeroDestinatario, texto);

      logger.info(`✅ Mensagem enviada! ID: ${result?.id?._serialized ?? 'N/A'}`);
      TelefoneModel.incrementarMensagensEnviadas(telefoneIdRemetente);
      return true;

    } catch (error) {
      logger.error(`❌ Erro ao enviar mensagem: ${error.message}`);
      logger.error(`   De  : ${telefoneIdRemetente}`);
      logger.error(`   Para: ${numeroDestinatario}`);
      logger.error(error.stack);
      throw error;
    }
  }

  async marcarComoLida(telefoneId, numeroRemetente) {
    try {
      const client = this.getCliente(telefoneId);
      if (!client) return false;
      const chat = await client.getChatById(numeroRemetente);
      await chat.sendSeen();
      logger.debug(`👁️ [${telefoneId}] Marcou como lida: ${numeroRemetente}`);
      return true;
    } catch (error) {
      logger.debug(`⚠️ marcarComoLida falhou (ignorado): ${error.message}`);
      return false;
    }
  }

  async simularDigitacao(telefoneId, numeroDestinatario, duracao) {
    try {
      const client = this.getCliente(telefoneId);
      if (!client) return false;
      const chat = await client.getChatById(numeroDestinatario);
      await chat.sendStateTyping();
      await DelayUtils.sleep(duracao);
      await chat.clearState();
      logger.debug(`✍️ [${telefoneId}] Simulou digitação por ${duracao}ms`);
      return true;
    } catch (error) {
      logger.debug(`⚠️ simularDigitacao falhou (ignorado): ${error.message}`);
      // Mantém o delay mesmo falhando para preservar comportamento humano
      await DelayUtils.sleep(duracao);
      return false;
    }
  }

  listarConectados() {
    const conectados = [];
    this.clients.forEach((client, telefoneId) => {
      if (client.info) {
        conectados.push({
          telefoneId,
          numero: client.info.wid._serialized,
          nome: client.info.pushname
        });
      }
    });
    return conectados;
  }

  async desconectarTodos() {
    logger.info('📴 Desconectando todos os clientes...');
    const promessas = [];
    this.clients.forEach((client, telefoneId) => {
      promessas.push(this.desconectarCliente(telefoneId));
    });
    await Promise.all(promessas);
    logger.info('✅ Todos os clientes desconectados');
  }
}

module.exports = new WhatsAppService();
const assert = require('assert/strict');
const { EventEmitter } = require('events');

const TelefoneModel = require('../models/Telefone');
const WhatsAppService = require('../services/whatsappService');
const HealthMonitor = require('../services/healthMonitor');

function buildTelefone(id, nome, status = 'online') {
  return {
    id,
    nome,
    numero: '556199999999@c.us',
    numeroAlt: '556199999999',
    sessionName: `session-${id}`,
    status,
    configuracao: {
      podeIniciarConversa: true,
      podeReceberMensagens: true,
      quantidadeConversasDia: 5,
      conversasRealizadasHoje: 0,
      ultimaConversaEm: null,
      proximaConversaDisponivelEm: null
    },
    estatisticas: {
      totalConversas: 0,
      totalMensagensEnviadas: 0,
      totalMensagensRecebidas: 0,
      diasAtivo: 0,
      ultimoBanimento: null
    },
    sensibilidade: 'media',
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };
}

function cloneMap(map) {
  return new Map(map);
}

function createClient({ evaluate, getState, isClosed = false } = {}) {
  const client = new EventEmitter();
  client.info = {
    wid: {
      _serialized: '556199999999@c.us',
      user: '556199999999'
    },
    pushname: 'Teste'
  };
  client.destroyCount = 0;
  client.pupPage = {
    isClosed: () => isClosed,
    evaluate: evaluate || (async () => 'visible')
  };
  client.getState = getState || (async () => 'CONNECTED');
  client.destroy = async () => {
    client.destroyCount += 1;
  };
  return client;
}

function snapshotState() {
  return {
    telefones: JSON.parse(JSON.stringify(TelefoneModel.telefones)),
    controleDiario: JSON.parse(JSON.stringify(TelefoneModel.controleDiario)),
    salvar: TelefoneModel.salvar,
    clients: cloneMap(WhatsAppService.clients),
    clientMeta: cloneMap(WhatsAppService.clientMeta),
    scheduleReconnect: WhatsAppService._scheduleReconnect,
    destroyClient: WhatsAppService._destroyClient,
    checkPage: WhatsAppService._checkPage,
    estaOperacional: WhatsAppService.estaOperacional,
    keepAliveTimer: WhatsAppService._keepAliveTimer,
    healthTimer: HealthMonitor.timer,
    healthWhatsappService: HealthMonitor.whatsappService
  };
}

function restoreState(snapshot) {
  TelefoneModel.telefones = snapshot.telefones;
  TelefoneModel.controleDiario = snapshot.controleDiario;
  TelefoneModel.salvar = snapshot.salvar;
  WhatsAppService.clients = cloneMap(snapshot.clients);
  WhatsAppService.clientMeta = cloneMap(snapshot.clientMeta);
  WhatsAppService._scheduleReconnect = snapshot.scheduleReconnect;
  WhatsAppService._destroyClient = snapshot.destroyClient;
  WhatsAppService._checkPage = snapshot.checkPage;
  WhatsAppService.estaOperacional = snapshot.estaOperacional;

  if (WhatsAppService._keepAliveTimer) {
    clearInterval(WhatsAppService._keepAliveTimer);
  }
  WhatsAppService._keepAliveTimer = snapshot.keepAliveTimer;

  if (HealthMonitor.timer) {
    clearInterval(HealthMonitor.timer);
  }
  HealthMonitor.timer = snapshot.healthTimer;
  HealthMonitor.whatsappService = snapshot.healthWhatsappService;
}

function prepareState(telefoneId = 'tel_keepalive') {
  TelefoneModel.salvar = () => {};
  TelefoneModel.telefones = [buildTelefone(telefoneId, telefoneId)].map((telefone) => TelefoneModel._normalizarTelefone(telefone));
  TelefoneModel.controleDiario = { ultimoDiaReset: '2099-01-01' };

  WhatsAppService.clients.clear();
  WhatsAppService.clientMeta.clear();

  if (WhatsAppService._keepAliveTimer) {
    clearInterval(WhatsAppService._keepAliveTimer);
    WhatsAppService._keepAliveTimer = null;
  }

  if (HealthMonitor.timer) {
    clearInterval(HealthMonitor.timer);
    HealthMonitor.timer = null;
  }

  HealthMonitor.whatsappService = WhatsAppService;
}

async function runTest(name, fn) {
  const snapshot = snapshotState();

  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    restoreState(snapshot);
  }
}

async function testSingleTransientFailureDoesNotDropClient() {
  prepareState('tel_soft_once');

  const reconnects = [];
  const client = createClient({
    evaluate: async () => {
      throw new Error('Keepalive timeout');
    }
  });

  WhatsAppService._scheduleReconnect = (telefoneId, reason) => {
    reconnects.push({ telefoneId, reason });
    return true;
  };
  WhatsAppService._destroyClient = async () => {};
  WhatsAppService.clients.set('tel_soft_once', client);
  WhatsAppService._setWaState('tel_soft_once', 'CONNECTED');

  const ok = await WhatsAppService._checkPage('tel_soft_once', { recover: true });
  const meta = WhatsAppService.getClientMeta('tel_soft_once');

  assert.equal(ok, false);
  assert.equal(TelefoneModel.buscarPorId('tel_soft_once').status, 'online');
  assert.equal(meta.transientKeepAliveFailures, 1);
  assert.equal(reconnects.length, 0);
}

async function testSecondTransientFailureTriggersSingleReconnect() {
  prepareState('tel_soft_twice');

  const reconnects = [];
  const client = createClient({
    evaluate: async () => {
      throw new Error('Keepalive timeout');
    }
  });

  WhatsAppService._scheduleReconnect = (telefoneId, reason) => {
    reconnects.push({ telefoneId, reason });
    return true;
  };
  WhatsAppService._destroyClient = async () => {
    client.destroyCount += 1;
  };
  WhatsAppService.clients.set('tel_soft_twice', client);
  WhatsAppService._setWaState('tel_soft_twice', 'CONNECTED');

  await WhatsAppService._checkPage('tel_soft_twice', { recover: true });
  await WhatsAppService._checkPage('tel_soft_twice', { recover: true });

  assert.equal(TelefoneModel.buscarPorId('tel_soft_twice').status, 'offline');
  assert.equal(reconnects.length, 1);
  assert.match(reconnects[0].reason, /keepalive_failed:Keepalive timeout/);
  assert.equal(client.destroyCount, 1);
}

async function testHardFailureDropsClientImmediately() {
  prepareState('tel_hard');

  const reconnects = [];
  const client = createClient({ isClosed: true });

  WhatsAppService._scheduleReconnect = (telefoneId, reason) => {
    reconnects.push({ telefoneId, reason });
    return true;
  };
  WhatsAppService._destroyClient = async () => {
    client.destroyCount += 1;
  };
  WhatsAppService.clients.set('tel_hard', client);
  WhatsAppService._setWaState('tel_hard', 'CONNECTED');

  const ok = await WhatsAppService._checkPage('tel_hard', { recover: true });

  assert.equal(ok, false);
  assert.equal(TelefoneModel.buscarPorId('tel_hard').status, 'offline');
  assert.equal(reconnects.length, 1);
  assert.match(reconnects[0].reason, /keepalive_failed:Target closed/);
  assert.equal(client.destroyCount, 1);
}

async function testBusyProbeIsSkippedWithoutReconnect() {
  prepareState('tel_busy');

  const reconnects = [];
  const client = createClient({
    evaluate: async () => {
      throw new Error('Keepalive timeout');
    }
  });

  WhatsAppService._scheduleReconnect = (telefoneId, reason) => {
    reconnects.push({ telefoneId, reason });
    return true;
  };
  WhatsAppService.clients.set('tel_busy', client);
  WhatsAppService._setWaState('tel_busy', 'CONNECTED');

  const meta = WhatsAppService._meta('tel_busy');
  meta.busyOperations = 1;
  meta.busySince = new Date().toISOString();
  meta.lastBusyOperation = 'typing';

  const ok = await WhatsAppService._checkPage('tel_busy', { recover: true });

  assert.equal(ok, true);
  assert.equal(TelefoneModel.buscarPorId('tel_busy').status, 'online');
  assert.equal(meta.transientKeepAliveFailures, 0);
  assert.equal(reconnects.length, 0);
}

async function testHealthMonitorDoesNotProbeActiveClients() {
  prepareState('tel_monitor');

  const client = createClient();
  let probeCalls = 0;
  WhatsAppService.clients.set('tel_monitor', client);
  WhatsAppService._checkPage = async () => {
    probeCalls += 1;
    return false;
  };
  WhatsAppService.estaOperacional = () => true;

  await HealthMonitor._verificarTodos();

  assert.equal(probeCalls, 0);
}

async function main() {
  await runTest('single transient keepalive failure keeps client online', testSingleTransientFailureDoesNotDropClient);
  await runTest('second transient keepalive failure triggers single reconnect', testSecondTransientFailureTriggersSingleReconnect);
  await runTest('hard keepalive failure drops client immediately', testHardFailureDropsClientImmediately);
  await runTest('busy operation skips keepalive probe', testBusyProbeIsSkippedWithoutReconnect);
  await runTest('health monitor does not probe active clients', testHealthMonitorDoesNotProbeActiveClients);

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

const assert = require('assert/strict');
const { EventEmitter } = require('events');

const TelefoneModel = require('../models/Telefone');
const WhatsAppService = require('../services/whatsappService');
const HealthMonitor = require('../services/healthMonitor');
const BrowserRuntimeService = require('../services/browserRuntimeService');
const DelayUtils = require('../utils/delay');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildTelefone(id, nome, status = 'offline') {
  return {
    id,
    nome,
    numero: null,
    numeroAlt: null,
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

function createFakeClient(options = {}) {
  const client = new EventEmitter();
  const lid = options.lid || '128750956089430@lid';

  client.info = {
    wid: {
      _serialized: options.numero || '556992797588@c.us',
      user: options.numeroReal || '556992797588'
    },
    pushname: options.pushname || 'Telefone Teste'
  };
  client.currentState = options.state || 'CONNECTED';
  client.pupPage = {
    isClosed: () => false,
    evaluate: async () => 'visible'
  };
  client.getState = async () => client.currentState;
  client.destroyCount = 0;
  client.sendCount = 0;
  client.destroy = async () => {
    client.destroyCount += 1;
  };
  client.initialize = () => Promise.resolve();
  client.sendMessage = async () => {
    client.sendCount += 1;
    if (options.emitLid !== false) {
      setImmediate(() => {
        client.emit('message_create', { fromMe: true, to: lid });
      });
    }
    return { id: { _serialized: `msg_${client.sendCount}` } };
  };

  return client;
}

function cloneMap(map) {
  return new Map(map);
}

function snapshotState() {
  return {
    telefones: JSON.parse(JSON.stringify(TelefoneModel.telefones)),
    controleDiario: JSON.parse(JSON.stringify(TelefoneModel.controleDiario)),
    salvar: TelefoneModel.salvar,
    clients: cloneMap(WhatsAppService.clients),
    qrCodes: cloneMap(WhatsAppService.qrCodes),
    pairingCodes: cloneMap(WhatsAppService.pairingCodes),
    connectionRequesters: cloneMap(WhatsAppService.connectionRequesters),
    clientMeta: cloneMap(WhatsAppService.clientMeta),
    autoSavedContacts: cloneMap(WhatsAppService.autoSavedContacts),
    createClient: WhatsAppService._createClient,
    destroyClient: WhatsAppService._destroyClient,
    scheduleReconnect: WhatsAppService._scheduleReconnect,
    tentarReconectar: WhatsAppService.tentarReconectar,
    keepAliveTimer: WhatsAppService._keepAliveTimer,
    healthWhatsappService: HealthMonitor.whatsappService,
    delaySleep: DelayUtils.sleep,
    ensureOperationalRuntime: BrowserRuntimeService.ensureOperationalRuntime
  };
}

function restoreState(snapshot) {
  TelefoneModel.telefones = snapshot.telefones;
  TelefoneModel.controleDiario = snapshot.controleDiario;
  TelefoneModel.salvar = snapshot.salvar;
  WhatsAppService.clients = cloneMap(snapshot.clients);
  WhatsAppService.qrCodes = cloneMap(snapshot.qrCodes);
  WhatsAppService.pairingCodes = cloneMap(snapshot.pairingCodes);
  WhatsAppService.connectionRequesters = cloneMap(snapshot.connectionRequesters);
  WhatsAppService.clientMeta = cloneMap(snapshot.clientMeta);
  WhatsAppService.autoSavedContacts = cloneMap(snapshot.autoSavedContacts);
  WhatsAppService._createClient = snapshot.createClient;
  WhatsAppService._destroyClient = snapshot.destroyClient;
  WhatsAppService._scheduleReconnect = snapshot.scheduleReconnect;
  WhatsAppService.tentarReconectar = snapshot.tentarReconectar;
  DelayUtils.sleep = snapshot.delaySleep;
  HealthMonitor.whatsappService = snapshot.healthWhatsappService;
  BrowserRuntimeService.ensureOperationalRuntime = snapshot.ensureOperationalRuntime;
  WhatsAppService.removeAllListeners();

  if (WhatsAppService._keepAliveTimer) {
    clearInterval(WhatsAppService._keepAliveTimer);
  }
  WhatsAppService._keepAliveTimer = snapshot.keepAliveTimer;
}

function prepareState(telefones) {
  TelefoneModel.salvar = () => {};
  TelefoneModel.telefones = telefones.map((telefone) => TelefoneModel._normalizarTelefone(telefone));
  TelefoneModel.controleDiario = { ultimoDiaReset: '2099-01-01' };

  WhatsAppService.clients.clear();
  WhatsAppService.qrCodes.clear();
  WhatsAppService.pairingCodes.clear();
  WhatsAppService.connectionRequesters.clear();
  WhatsAppService.clientMeta.clear();
  WhatsAppService.autoSavedContacts.clear();
  WhatsAppService.removeAllListeners();

  if (WhatsAppService._keepAliveTimer) {
    clearInterval(WhatsAppService._keepAliveTimer);
    WhatsAppService._keepAliveTimer = null;
  }

  HealthMonitor.whatsappService = null;
  BrowserRuntimeService.ensureOperationalRuntime = async () => ({
    available: true,
    source: 'test:fake-browser',
    executablePath: '/test/chrome',
    platform: process.platform,
    message: 'Browser pronto (test)',
    checkedAt: new Date().toISOString()
  });
}

async function testChangeStateTriggersOffline(state) {
  const telefoneId = `tel_state_${state.toLowerCase()}`;
  prepareState([buildTelefone(telefoneId, `Teste ${state}`, 'offline')]);

  const fakeClient = createFakeClient();
  const scheduled = [];
  const offlineEvents = [];

  WhatsAppService._createClient = () => fakeClient;
  WhatsAppService._destroyClient = async (client) => {
    client.destroyCount += 1;
  };
  WhatsAppService._scheduleReconnect = (id, reason) => {
    scheduled.push({ id, reason });
    return true;
  };

  WhatsAppService.on('telefone:offline', (id, reason) => {
    offlineEvents.push({ id, reason });
  });

  await WhatsAppService.inicializarCliente(telefoneId, {
    allowQr: false,
    isReconnect: true,
    autoReconnect: true
  });

  WhatsAppService._updateStatus(telefoneId, 'online', {
    numero: '556992797588@c.us',
    numeroAlt: '556992797588'
  });
  WhatsAppService._setWaState(telefoneId, 'CONNECTED');
  WhatsAppService._meta(telefoneId).reconnectInFlight = false;

  fakeClient.emit('change_state', state);
  await flush();
  await flush();

  assert.equal(TelefoneModel.buscarPorId(telefoneId).status, 'offline');
  assert.equal(WhatsAppService.getClientMeta(telefoneId).waState, state);
  assert.equal(offlineEvents.length, 1);
  assert.equal(offlineEvents[0].reason, `state_changed:${state}`);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].reason, `state_changed:${state}`);
  assert.equal(WhatsAppService.clients.has(telefoneId), false);
  assert.equal(fakeClient.destroyCount, 1);
}

async function testStartupReconcileAndGhostOnline() {
  const telefoneId = 'tel_ghost_online';
  prepareState([
    buildTelefone(telefoneId, 'Ghost Online', 'online'),
    buildTelefone('tel_boot_1', 'Boot Online', 'online'),
    buildTelefone('tel_boot_2', 'Boot Reconnecting', 'reconnecting'),
    buildTelefone('tel_boot_3', 'Boot Connecting', 'conectando')
  ]);

  const corrigidos = WhatsAppService.reconciliarStatusPersistido();
  assert.deepEqual(
    corrigidos.sort(),
    ['Boot Connecting', 'Boot Online', 'Boot Reconnecting', 'Ghost Online'].sort()
  );
  assert.equal(TelefoneModel.buscarPorId(telefoneId).status, 'offline');

  TelefoneModel.buscarPorId(telefoneId).status = 'online';
  const reconnectCalls = [];
  WhatsAppService.tentarReconectar = async (id, options = {}) => {
    reconnectCalls.push({ id, auto: options.auto === true });
    return { status: 'reconnecting' };
  };

  HealthMonitor.whatsappService = WhatsAppService;
  await HealthMonitor._verificarTodos();

  assert.equal(TelefoneModel.buscarPorId(telefoneId).status, 'offline');
  assert.equal(WhatsAppService.getClientMeta(telefoneId).lastDisconnectReason, 'ghost_online');
  assert.deepEqual(reconnectCalls, [{ id: telefoneId, auto: true }]);
}

async function testReadyIsIdempotent() {
  const telefoneId = 'tel_ready_once';
  prepareState([buildTelefone(telefoneId, 'Ready Once', 'offline')]);

  const fakeClient = createFakeClient();
  const onlineEvents = [];

  DelayUtils.sleep = async () => {};
  WhatsAppService._createClient = () => fakeClient;
  WhatsAppService._destroyClient = async () => {};
  WhatsAppService.on('telefone:online', (id) => {
    onlineEvents.push(id);
  });

  await WhatsAppService.inicializarCliente(telefoneId, {
    allowQr: false,
    isReconnect: true,
    autoReconnect: true
  });

  fakeClient.emit('ready');
  fakeClient.emit('ready');
  await flush();
  await flush();
  await flush();

  const telefone = TelefoneModel.buscarPorId(telefoneId);
  const meta = WhatsAppService.getClientMeta(telefoneId);

  assert.equal(telefone.status, 'online');
  assert.equal(telefone.numero, '128750956089430@lid');
  assert.equal(fakeClient.sendCount, 1);
  assert.deepEqual(onlineEvents, [telefoneId]);
  assert.equal(meta.waState, 'CONNECTED');
  assert.ok(meta.lastReadyAt);
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

async function main() {
  await runTest('change_state TOS_BLOCK -> offline + reconnect', () => testChangeStateTriggersOffline('TOS_BLOCK'));
  await runTest('change_state UNPAIRED -> offline + reconnect', () => testChangeStateTriggersOffline('UNPAIRED'));
  await runTest('startup reconcile + ghost_online', testStartupReconcileAndGhostOnline);
  await runTest('ready duplicate is idempotent', testReadyIsIdempotent);

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

const assert = require('assert/strict');

const TelefoneController = require('../controllers/telefoneController');
const TelefoneModel = require('../models/Telefone');
const WhatsAppService = require('../services/whatsappService');
const BrowserRuntimeService = require('../services/browserRuntimeService');
const RealtimeService = require('../services/realtimeService');

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

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function snapshotState() {
  return {
    telefones: cloneValue(TelefoneModel.telefones),
    controleDiario: cloneValue(TelefoneModel.controleDiario),
    salvar: TelefoneModel.salvar,
    keepAliveTimer: WhatsAppService._keepAliveTimer,
    ensureOperationalRuntime: BrowserRuntimeService.ensureOperationalRuntime,
    getDiagnosis: BrowserRuntimeService.getDiagnosis,
    hasSocket: RealtimeService.hasSocket,
    inicializarCliente: WhatsAppService.inicializarCliente,
    tentarReconectar: WhatsAppService.tentarReconectar,
    getQRCode: WhatsAppService.getQRCode
  };
}

function restoreState(snapshot) {
  TelefoneModel.telefones = snapshot.telefones;
  TelefoneModel.controleDiario = snapshot.controleDiario;
  TelefoneModel.salvar = snapshot.salvar;
  if (WhatsAppService._keepAliveTimer) {
    clearInterval(WhatsAppService._keepAliveTimer);
  }
  WhatsAppService._keepAliveTimer = snapshot.keepAliveTimer;
  BrowserRuntimeService.ensureOperationalRuntime = snapshot.ensureOperationalRuntime;
  BrowserRuntimeService.getDiagnosis = snapshot.getDiagnosis;
  RealtimeService.hasSocket = snapshot.hasSocket;
  WhatsAppService.inicializarCliente = snapshot.inicializarCliente;
  WhatsAppService.tentarReconectar = snapshot.tentarReconectar;
  WhatsAppService.getQRCode = snapshot.getQRCode;
}

function prepareState() {
  TelefoneModel.salvar = () => {};
  TelefoneModel.telefones = [
    TelefoneModel._normalizarTelefone(buildTelefone('tel_browser_guard', 'Browser Guard'))
  ];
  TelefoneModel.controleDiario = { ultimoDiaReset: '2099-01-01' };
  if (WhatsAppService._keepAliveTimer) {
    clearInterval(WhatsAppService._keepAliveTimer);
    WhatsAppService._keepAliveTimer = null;
  }
}

function unavailableDiagnosis() {
  return {
    available: false,
    source: 'env:WHATSAPP_BROWSER_EXECUTABLE_PATH',
    executablePath: '/missing/chrome',
    platform: 'linux',
    message: 'Executavel do navegador nao encontrado em /missing/chrome',
    checkedAt: new Date().toISOString()
  };
}

async function testConnectReturns503WithoutInitializingClient() {
  prepareState();

  let initCalls = 0;
  BrowserRuntimeService.ensureOperationalRuntime = async () => unavailableDiagnosis();
  BrowserRuntimeService.getDiagnosis = () => unavailableDiagnosis();
  RealtimeService.hasSocket = () => true;
  WhatsAppService.inicializarCliente = async () => {
    initCalls += 1;
  };

  const req = {
    params: { id: 'tel_browser_guard' },
    body: { method: 'qr', requesterSocketId: 'socket-1' }
  };
  const res = createMockResponse();

  await TelefoneController.conectar(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.codigo, 'browser_runtime_unavailable');
  assert.equal(initCalls, 0);
  console.log('PASS conectar -> 503 without initialize');
}

async function testReconnectReturns503WithoutReconnectAttempt() {
  prepareState();

  let reconnectCalls = 0;
  BrowserRuntimeService.ensureOperationalRuntime = async () => unavailableDiagnosis();
  BrowserRuntimeService.getDiagnosis = () => unavailableDiagnosis();
  WhatsAppService.tentarReconectar = async () => {
    reconnectCalls += 1;
    return { status: 'reconnecting' };
  };

  const req = { params: { id: 'tel_browser_guard' } };
  const res = createMockResponse();

  await TelefoneController.reconectar(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.codigo, 'browser_runtime_unavailable');
  assert.equal(reconnectCalls, 0);
  console.log('PASS reconectar -> 503 without reconnect');
}

async function testQRCodeReturns503BeforeLookup() {
  prepareState();

  let qrLookups = 0;
  BrowserRuntimeService.ensureOperationalRuntime = async () => unavailableDiagnosis();
  BrowserRuntimeService.getDiagnosis = () => unavailableDiagnosis();
  WhatsAppService.getQRCode = () => {
    qrLookups += 1;
    return 'fake-qr';
  };

  const req = { params: { id: 'tel_browser_guard' } };
  const res = createMockResponse();

  await TelefoneController.obterQRCode(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.codigo, 'browser_runtime_unavailable');
  assert.equal(qrLookups, 0);
  console.log('PASS qrcode -> 503 before lookup');
}

async function main() {
  const snapshot = snapshotState();

  try {
    await testConnectReturns503WithoutInitializingClient();
    await testReconnectReturns503WithoutReconnectAttempt();
    await testQRCodeReturns503BeforeLookup();
  } finally {
    restoreState(snapshot);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

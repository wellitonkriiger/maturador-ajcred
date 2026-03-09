const assert = require('assert/strict');

const TelefoneModel = require('../models/Telefone');
const WhatsAppService = require('../services/whatsappService');

function buildTelefone(id, nome, numero, numeroAlt = null) {
  return {
    id,
    nome,
    numero,
    numeroAlt,
    sessionName: `session-${id}`,
    status: 'online',
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

function snapshotState() {
  return {
    telefones: JSON.parse(JSON.stringify(TelefoneModel.telefones)),
    controleDiario: JSON.parse(JSON.stringify(TelefoneModel.controleDiario)),
    salvar: TelefoneModel.salvar,
    clients: cloneMap(WhatsAppService.clients),
    autoSavedContacts: cloneMap(WhatsAppService.autoSavedContacts),
    keepAliveTimer: WhatsAppService._keepAliveTimer
  };
}

function restoreState(snapshot) {
  TelefoneModel.telefones = snapshot.telefones;
  TelefoneModel.controleDiario = snapshot.controleDiario;
  TelefoneModel.salvar = snapshot.salvar;
  WhatsAppService.clients = cloneMap(snapshot.clients);
  WhatsAppService.autoSavedContacts = cloneMap(snapshot.autoSavedContacts);

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
  WhatsAppService.autoSavedContacts.clear();

  if (WhatsAppService._keepAliveTimer) {
    clearInterval(WhatsAppService._keepAliveTimer);
    WhatsAppService._keepAliveTimer = null;
  }
}

async function runTest(name, fn) {
  const snapshot = snapshotState();

  try {
    prepareState([
      buildTelefone('tel_receiver', 'Receiver', '123456789012345@lid', '556999999999'),
      buildTelefone('tel_sender', 'Sender', '987654321098765@lid', '556988888888')
    ]);

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

async function testFindManagedTelefoneByNumeroAlt() {
  const found = WhatsAppService._findManagedTelefoneByContact('556988888888@c.us', 'tel_receiver');
  assert.equal(found?.id, 'tel_sender');
}

async function testAutoSaveManagedContactNameWithNumeroAlt() {
  const calls = [];
  const fakeClient = {
    saveOrEditAddressbookContact: async (...args) => {
      calls.push(args);
    }
  };

  WhatsAppService.clients.set('tel_receiver', fakeClient);

  await WhatsAppService._autoSaveManagedContactName('tel_receiver', '556988888888@c.us');

  assert.deepEqual(calls, [['556988888888', 'Sender', '', true]]);
  assert.equal(WhatsAppService.autoSavedContacts.get('tel_receiver::tel_sender'), '556988888888|Sender');
}

async function main() {
  await runTest('find managed telefone by numeroAlt', testFindManagedTelefoneByNumeroAlt);
  await runTest('auto save managed contact by numeroAlt', testAutoSaveManagedContactNameWithNumeroAlt);

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

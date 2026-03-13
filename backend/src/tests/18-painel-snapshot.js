const assert = require('assert/strict');

const PainelController = require('../controllers/painelController');
const TelefoneModel = require('../models/Telefone');
const MaturacaoService = require('../services/maturacaoService');
const BrowserRuntimeService = require('../services/browserRuntimeService');

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
    listar: TelefoneModel.listar,
    getStatus: MaturacaoService.getStatus,
    getConversasAtivas: MaturacaoService.getConversasAtivas,
    getServiceHealth: BrowserRuntimeService.getServiceHealth
  };
}

function restoreState(snapshot) {
  TelefoneModel.listar = snapshot.listar;
  MaturacaoService.getStatus = snapshot.getStatus;
  MaturacaoService.getConversasAtivas = snapshot.getConversasAtivas;
  BrowserRuntimeService.getServiceHealth = snapshot.getServiceHealth;
}

async function testSnapshotPayloadShape() {
  TelefoneModel.listar = () => ([{ id: 'tel_1', nome: 'Linha 1' }]);
  MaturacaoService.getStatus = () => ({ emExecucao: true, conversas: { ativas: 1 } });
  MaturacaoService.getConversasAtivas = () => ([{ conversaExecucaoId: 'exec_1' }]);
  BrowserRuntimeService.getServiceHealth = () => ({
    status: 'ok',
    services: {
      whatsappBrowser: {
        available: true,
        executablePath: '/usr/bin/chromium'
      }
    }
  });

  const res = createMockResponse();

  await PainelController.snapshot({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.telefones, [{ id: 'tel_1', nome: 'Linha 1' }]);
  assert.deepEqual(res.body.maturacaoStatus, { emExecucao: true, conversas: { ativas: 1 } });
  assert.deepEqual(res.body.conversasAtivas, [{ conversaExecucaoId: 'exec_1' }]);
  assert.equal(res.body.health.status, 'ok');
  assert.ok(typeof res.body.health.timestamp === 'string');
  assert.equal(res.body.health.services.whatsappBrowser.available, true);
  console.log('PASS painel snapshot -> aggregated payload');
}

async function main() {
  const snapshot = snapshotState();

  try {
    await testSnapshotPayloadShape();
  } finally {
    restoreState(snapshot);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

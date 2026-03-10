const assert = require('assert/strict');

const RuntimeDiagnosticsService = require('../services/runtimeDiagnosticsService');

function snapshotState() {
  return {
    events: [...RuntimeDiagnosticsService.events],
    startedAt: RuntimeDiagnosticsService.startedAt,
    getProcessSnapshot: RuntimeDiagnosticsService._getProcessSnapshot,
    getOsSnapshot: RuntimeDiagnosticsService._getOsSnapshot,
    getCgroupSnapshot: RuntimeDiagnosticsService._getCgroupSnapshot,
    collectEnvSnapshot: RuntimeDiagnosticsService._collectEnvSnapshot,
    env: {
      PORT: process.env.PORT,
      NOBRE_HEALTHCHECK_TIMEOUT: process.env.NOBRE_HEALTHCHECK_TIMEOUT,
      SESSION_SECRET: process.env.SESSION_SECRET,
      API_KEY: process.env.API_KEY
    }
  };
}

function restoreState(snapshot) {
  RuntimeDiagnosticsService.events = snapshot.events;
  RuntimeDiagnosticsService.startedAt = snapshot.startedAt;
  RuntimeDiagnosticsService._getProcessSnapshot = snapshot.getProcessSnapshot;
  RuntimeDiagnosticsService._getOsSnapshot = snapshot.getOsSnapshot;
  RuntimeDiagnosticsService._getCgroupSnapshot = snapshot.getCgroupSnapshot;
  RuntimeDiagnosticsService._collectEnvSnapshot = snapshot.collectEnvSnapshot;

  for (const [key, value] of Object.entries(snapshot.env)) {
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function resetState() {
  RuntimeDiagnosticsService.events = [];
  RuntimeDiagnosticsService.startedAt = '2026-03-10T00:00:00.000Z';
}

function testEnvSnapshotRedactsSensitiveKeys() {
  resetState();
  process.env.PORT = '3001';
  process.env.NOBRE_HEALTHCHECK_TIMEOUT = '30';
  process.env.SESSION_SECRET = 'secret';
  process.env.API_KEY = 'api-key';

  const snapshot = RuntimeDiagnosticsService._collectEnvSnapshot();

  assert.equal(snapshot.PORT, '3001');
  assert.equal(snapshot.NOBRE_HEALTHCHECK_TIMEOUT, '30');
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'SESSION_SECRET'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'API_KEY'), false);
  console.log('PASS runtime env snapshot redacts sensitive keys');
}

function testRecentEventsRespectRingBuffer() {
  resetState();

  for (let index = 1; index <= 65; index += 1) {
    RuntimeDiagnosticsService.record('test', `event_${index}`, { index });
  }

  const events = RuntimeDiagnosticsService.getRecentEvents(60);
  assert.equal(events.length, 60);
  assert.equal(events[0].name, 'event_6');
  assert.equal(events[59].name, 'event_65');
  console.log('PASS runtime recent events keep rolling window');
}

function testSignalContextIncludesRecentEvents() {
  resetState();
  RuntimeDiagnosticsService.record('maturacao', 'started', { planoAtivo: true });
  RuntimeDiagnosticsService.record('whatsapp', 'keepalive_failed', { telefoneId: 'tel_1' });

  RuntimeDiagnosticsService._getProcessSnapshot = () => ({
    pid: 123,
    uptimeSec: 45,
    memory: { rss: '100 MB' },
    activeHandles: { Socket: 2 }
  });
  RuntimeDiagnosticsService._getCgroupSnapshot = () => ({
    available: true,
    version: 'v2',
    memory: { limit: '512 MB' }
  });
  RuntimeDiagnosticsService._getOsSnapshot = () => ({ hostname: 'nobre' });
  RuntimeDiagnosticsService._collectEnvSnapshot = () => ({ PORT: '3001' });

  const context = RuntimeDiagnosticsService.getSignalLogContext('SIGTERM', {
    health: { status: 'ok' }
  });

  assert.equal(context.signal, 'SIGTERM');
  assert.equal(context.classification, 'external_sigterm');
  assert.equal(context.process.pid, 123);
  assert.equal(context.recentEvents.length, 2);
  assert.equal(context.recentEvents[1].name, 'keepalive_failed');
  console.log('PASS runtime signal context includes recent events');
}

function main() {
  const snapshot = snapshotState();

  try {
    testEnvSnapshotRedactsSensitiveKeys();
    testRecentEventsRespectRingBuffer();
    testSignalContextIncludesRecentEvents();
  } finally {
    restoreState(snapshot);
  }
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}

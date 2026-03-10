const assert = require('assert/strict');

const BrowserRuntimeService = require('../services/browserRuntimeService');

function cloneDiagnosis(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function createFakeBrowser() {
  return {
    newPage: async () => ({
      goto: async () => {}
    }),
    close: async () => {}
  };
}

function snapshotState() {
  return {
    diagnosis: cloneDiagnosis(BrowserRuntimeService.getDiagnosis()),
    validationInFlight: BrowserRuntimeService.validationInFlight,
    getPlatform: BrowserRuntimeService.getPlatform,
    pathExists: BrowserRuntimeService._pathExists,
    findWindows: BrowserRuntimeService._findWindowsExecutableCandidates,
    findLinux: BrowserRuntimeService._findLinuxExecutableCandidates,
    findManaged: BrowserRuntimeService._findManagedExecutableCandidate,
    launchBrowser: BrowserRuntimeService._launchBrowser,
    env: {
      WHATSAPP_BROWSER_EXECUTABLE_PATH: process.env.WHATSAPP_BROWSER_EXECUTABLE_PATH,
      PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
      CHROME_PATH: process.env.CHROME_PATH
    }
  };
}

function restoreState(snapshot) {
  BrowserRuntimeService.diagnosis = cloneDiagnosis(snapshot.diagnosis);
  BrowserRuntimeService.validationInFlight = snapshot.validationInFlight;
  BrowserRuntimeService.getPlatform = snapshot.getPlatform;
  BrowserRuntimeService._pathExists = snapshot.pathExists;
  BrowserRuntimeService._findWindowsExecutableCandidates = snapshot.findWindows;
  BrowserRuntimeService._findLinuxExecutableCandidates = snapshot.findLinux;
  BrowserRuntimeService._findManagedExecutableCandidate = snapshot.findManaged;
  BrowserRuntimeService._launchBrowser = snapshot.launchBrowser;

  for (const [key, value] of Object.entries(snapshot.env)) {
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function resetBaseState() {
  delete process.env.WHATSAPP_BROWSER_EXECUTABLE_PATH;
  delete process.env.PUPPETEER_EXECUTABLE_PATH;
  delete process.env.CHROME_PATH;

  BrowserRuntimeService.setDiagnosis({
    available: false,
    source: null,
    executablePath: null,
    message: 'reset'
  });
  BrowserRuntimeService.validationInFlight = null;
  BrowserRuntimeService.getPlatform = () => process.platform;
  BrowserRuntimeService._pathExists = () => true;
  BrowserRuntimeService._findWindowsExecutableCandidates = () => [];
  BrowserRuntimeService._findLinuxExecutableCandidates = () => [];
  BrowserRuntimeService._findManagedExecutableCandidate = () => null;
  BrowserRuntimeService._launchBrowser = async () => createFakeBrowser();
}

async function testEnvPrecedence() {
  resetBaseState();
  process.env.WHATSAPP_BROWSER_EXECUTABLE_PATH = '/custom/whatsapp-chrome';
  process.env.PUPPETEER_EXECUTABLE_PATH = '/custom/pptr-chrome';
  process.env.CHROME_PATH = '/custom/chrome';

  const diagnosis = await BrowserRuntimeService.validateBrowserRuntime({ force: true, staleMs: 0 });

  assert.equal(diagnosis.available, true);
  assert.equal(diagnosis.source, 'env:WHATSAPP_BROWSER_EXECUTABLE_PATH');
  assert.equal(diagnosis.executablePath, '/custom/whatsapp-chrome');
  console.log('PASS env precedence -> WHATSAPP_BROWSER_EXECUTABLE_PATH');
}

async function testWindowsResolution() {
  resetBaseState();
  BrowserRuntimeService.getPlatform = () => 'win32';
  BrowserRuntimeService._findWindowsExecutableCandidates = () => ([
    { source: 'system:chrome', executablePath: 'C:\\Chrome\\Application\\chrome.exe' }
  ]);

  const diagnosis = await BrowserRuntimeService.validateBrowserRuntime({ force: true, staleMs: 0 });

  assert.equal(diagnosis.available, true);
  assert.equal(diagnosis.source, 'system:chrome');
  assert.equal(diagnosis.executablePath, 'C:\\Chrome\\Application\\chrome.exe');
  console.log('PASS windows resolution -> default Chrome path');
}

async function testLinuxResolution() {
  resetBaseState();
  BrowserRuntimeService.getPlatform = () => 'linux';
  BrowserRuntimeService._findLinuxExecutableCandidates = () => ([
    { source: 'system:chromium', executablePath: '/usr/bin/chromium' }
  ]);

  const diagnosis = await BrowserRuntimeService.validateBrowserRuntime({ force: true, staleMs: 0 });

  assert.equal(diagnosis.available, true);
  assert.equal(diagnosis.source, 'system:chromium');
  assert.equal(diagnosis.executablePath, '/usr/bin/chromium');
  console.log('PASS linux resolution -> which chromium');
}

async function testManagedFallback() {
  resetBaseState();
  BrowserRuntimeService.getPlatform = () => 'linux';
  BrowserRuntimeService._findManagedExecutableCandidate = () => ({
    source: 'puppeteer:managed',
    executablePath: '/cache/puppeteer/chrome'
  });

  const diagnosis = await BrowserRuntimeService.validateBrowserRuntime({ force: true, staleMs: 0 });

  assert.equal(diagnosis.available, true);
  assert.equal(diagnosis.source, 'puppeteer:managed');
  assert.equal(diagnosis.executablePath, '/cache/puppeteer/chrome');
  console.log('PASS fallback -> managed Puppeteer browser');
}

async function testMissingExecutableDegrades() {
  resetBaseState();
  process.env.WHATSAPP_BROWSER_EXECUTABLE_PATH = '/missing/chrome';
  BrowserRuntimeService._pathExists = () => false;

  const diagnosis = await BrowserRuntimeService.validateBrowserRuntime({ force: true, staleMs: 0 });
  const health = BrowserRuntimeService.getServiceHealth();

  assert.equal(diagnosis.available, false);
  assert.equal(diagnosis.source, 'env:WHATSAPP_BROWSER_EXECUTABLE_PATH');
  assert.match(diagnosis.message, /Executavel do navegador nao encontrado/i);
  assert.equal(health.status, 'degraded');
  console.log('PASS degraded diagnosis -> missing executable');
}

async function main() {
  const snapshot = snapshotState();

  try {
    await testEnvPrecedence();
    await testWindowsResolution();
    await testLinuxResolution();
    await testManagedFallback();
    await testMissingExecutableDegrades();
  } finally {
    restoreState(snapshot);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

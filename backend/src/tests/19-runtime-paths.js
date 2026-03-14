const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtimeRoot = path.join(os.tmpdir(), `maturador-runtime-test-${Date.now()}`);
process.env.MATURADOR_RUNTIME_ROOT = runtimeRoot;

const { buildBrowserLaunchOptions } = require('../utils/browserLaunch');
const { getRuntimePaths, prepareRuntimeEnvironment } = require('../utils/runtimePaths');

async function main() {
  const runtimePaths = prepareRuntimeEnvironment();
  const launchOptions = buildBrowserLaunchOptions({ executablePath: '/usr/bin/chromium', platform: 'linux' });

  assert.equal(runtimePaths.root, path.resolve(runtimeRoot));
  assert.equal(process.env.HOME, runtimePaths.home);
  assert.equal(process.env.XDG_CONFIG_HOME, runtimePaths.xdgConfig);
  assert.equal(process.env.XDG_CACHE_HOME, runtimePaths.xdgCache);
  assert.equal(process.env.PUPPETEER_CACHE_DIR, runtimePaths.puppeteerCache);
  assert.equal(process.env.TMPDIR, runtimePaths.tmp);

  assert.equal(launchOptions.env.HOME, runtimePaths.home);
  assert.equal(launchOptions.env.XDG_CONFIG_HOME, runtimePaths.xdgConfig);
  assert.equal(launchOptions.env.XDG_CACHE_HOME, runtimePaths.xdgCache);
  assert.equal(launchOptions.env.PUPPETEER_CACHE_DIR, runtimePaths.puppeteerCache);
  assert.equal(launchOptions.env.TMPDIR, runtimePaths.tmp);
  assert.equal(launchOptions.executablePath, '/usr/bin/chromium');

  for (const target of Object.values(getRuntimePaths())) {
    assert.equal(fs.existsSync(target), true, `Diretorio nao criado: ${target}`);
  }

  console.log('PASS runtime paths -> browser env fixed inside project');
}

main().catch((error) => {
  console.error('FAIL runtime paths:', error.message);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');

function resolveProjectRoot() {
  return path.resolve(__dirname, '../..');
}

function resolveRuntimeRoot() {
  const configuredRoot = String(process.env.MATURADOR_RUNTIME_ROOT || '').trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  return path.join(resolveProjectRoot(), 'data', 'runtime');
}

function getRuntimePaths() {
  const root = resolveRuntimeRoot();
  return {
    root,
    home: path.join(root, 'home'),
    tmp: path.join(root, 'tmp'),
    xdgConfig: path.join(root, 'xdg-config'),
    xdgCache: path.join(root, 'xdg-cache'),
    puppeteerCache: path.join(root, 'xdg-cache', 'puppeteer')
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

let preparedKey = null;

function prepareRuntimeEnvironment() {
  const paths = getRuntimePaths();
  const key = JSON.stringify(paths);
  if (preparedKey === key) {
    return paths;
  }

  [
    paths.root,
    paths.home,
    paths.tmp,
    paths.xdgConfig,
    paths.xdgCache,
    paths.puppeteerCache
  ].forEach(ensureDir);

  process.env.HOME = paths.home;
  process.env.XDG_CONFIG_HOME = paths.xdgConfig;
  process.env.XDG_CACHE_HOME = paths.xdgCache;
  process.env.PUPPETEER_CACHE_DIR = paths.puppeteerCache;
  process.env.TMPDIR = paths.tmp;
  process.env.TMP = paths.tmp;
  process.env.TEMP = paths.tmp;

  preparedKey = key;
  return paths;
}

function getBrowserProcessEnv() {
  const paths = prepareRuntimeEnvironment();
  return {
    ...process.env,
    HOME: paths.home,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_CACHE_HOME: paths.xdgCache,
    PUPPETEER_CACHE_DIR: paths.puppeteerCache,
    TMPDIR: paths.tmp,
    TMP: paths.tmp,
    TEMP: paths.tmp
  };
}

module.exports = {
  getRuntimePaths,
  prepareRuntimeEnvironment,
  getBrowserProcessEnv
};

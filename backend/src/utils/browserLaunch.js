const { getBrowserProcessEnv } = require('./runtimePaths');

const BASE_BROWSER_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--disable-gpu',
  '--headless=new'
];

const LINUX_BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--no-zygote'
];

function getBrowserLaunchArgs(platform = process.platform) {
  return platform === 'linux'
    ? [...BASE_BROWSER_ARGS, ...LINUX_BROWSER_ARGS]
    : [...BASE_BROWSER_ARGS];
}

function buildBrowserLaunchOptions({ executablePath = null, platform = process.platform } = {}) {
  const options = {
    headless: true,
    args: getBrowserLaunchArgs(platform),
    env: getBrowserProcessEnv()
  };

  if (executablePath) {
    options.executablePath = executablePath;
  }

  return options;
}

module.exports = {
  BASE_BROWSER_ARGS,
  LINUX_BROWSER_ARGS,
  getBrowserLaunchArgs,
  buildBrowserLaunchOptions
};

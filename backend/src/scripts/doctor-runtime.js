require('dotenv').config();

const BrowserRuntimeService = require('../services/browserRuntimeService');
const RuntimeDiagnosticsService = require('../services/runtimeDiagnosticsService');

async function main() {
  let browserRuntime = null;

  try {
    browserRuntime = await BrowserRuntimeService.validateBrowserRuntime({ force: true, staleMs: 0 });
  } catch (error) {
    browserRuntime = {
      available: false,
      source: null,
      executablePath: null,
      platform: process.platform,
      message: error?.message ?? String(error),
      checkedAt: new Date().toISOString()
    };
  }

  const payload = RuntimeDiagnosticsService.buildRuntimeReport({
    browserRuntime,
    health: BrowserRuntimeService.getServiceHealth()
  });

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    error: error?.message ?? String(error),
    report: RuntimeDiagnosticsService.buildRuntimeReport()
  }, null, 2));
  process.exit(1);
});

require('dotenv').config();

const BrowserRuntimeService = require('../services/browserRuntimeService');

async function main() {
  const diagnostico = await BrowserRuntimeService.validateBrowserRuntime({
    force: true,
    staleMs: 0
  });

  const payload = {
    status: diagnostico.available ? 'ok' : 'degraded',
    services: {
      whatsappBrowser: diagnostico
    }
  };

  console.log(JSON.stringify(payload, null, 2));
  process.exit(diagnostico.available ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: 'degraded',
    services: {
      whatsappBrowser: {
        available: false,
        source: null,
        executablePath: null,
        platform: process.platform,
        message: error?.message ?? String(error),
        checkedAt: new Date().toISOString()
      }
    }
  }, null, 2));
  process.exit(1);
});

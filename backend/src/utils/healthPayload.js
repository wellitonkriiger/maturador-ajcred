const BrowserRuntimeService = require('../services/browserRuntimeService');

function buildHealthPayload() {
  const health = BrowserRuntimeService.getServiceHealth();

  return {
    status: health.status,
    timestamp: new Date().toISOString(),
    services: health.services
  };
}

module.exports = {
  buildHealthPayload
};

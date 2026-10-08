// Run image integration tests with the same fallback used on older VPS CPUs:
// node -r ./apps/api/tests/sharp-wasm-preload.cjs apps/api/tests/chat-media.integration.cjs
if (require('node:worker_threads').isMainThread) {
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (
      /^@img\/sharp-.*\/sharp\.node$/.test(request) &&
      request !== '@img/sharp-wasm32/sharp.node'
    ) {
      const error = new Error(
        'Native sharp intentionally disabled for Wasm test',
      );
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return originalLoad.call(this, request, ...args);
  };
  try {
    require('sharp');
  } finally {
    Module._load = originalLoad;
  }
}

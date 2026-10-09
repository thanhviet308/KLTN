// Check resolution from the compiled API, including workspace-local packages.
// The experimental native image deliberately excludes the unused Wasm fallback.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const apiRequire = createRequire(resolve(__dirname, '../dist/main.js'));
const manifest = require('../package.json');
apiRequire('reflect-metadata');
for (const name of Object.keys(manifest.dependencies)) {
  if (name === '@img/sharp-wasm32') continue;
  const location = apiRequire.resolve(name);
  apiRequire(name);
  console.log(`${name}: load OK (${location})`);
}
assert.equal(typeof apiRequire('@nestjs/typeorm').TypeOrmModule, 'function');
console.log('API production dependency resolution OK');

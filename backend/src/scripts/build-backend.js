const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const srcDir = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['tests']);

function collectJavaScriptFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...collectJavaScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = collectJavaScriptFiles(srcDir);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`[build:backend] Falha ao verificar ${file}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`[build:backend] ${files.length} arquivo(s) verificados com sucesso.`);

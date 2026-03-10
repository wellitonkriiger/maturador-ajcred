const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = process.cwd();
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const stampFileName = '.ajcred-deps-hash';
const projects = [
  { name: 'raiz', dir: rootDir },
  { name: 'backend', dir: path.join(rootDir, 'backend') },
  { name: 'frontend', dir: path.join(rootDir, 'frontend') }
];

function manifestHash(dir) {
  const hash = crypto.createHash('sha256');

  for (const file of ['package.json', 'package-lock.json']) {
    const fullPath = path.join(dir, file);
    if (!fs.existsSync(fullPath)) continue;
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(fullPath));
    hash.update('\0');
  }

  return hash.digest('hex');
}

function stampPath(dir) {
  return path.join(dir, 'node_modules', stampFileName);
}

function installDependencies(project) {
  console.log(`[deps] Instalando dependencias de ${project.name}...`);

  const result = spawnSync(npmCmd, ['install'], {
    cwd: project.dir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.error) {
    console.error(`[deps] Falha ao executar npm em ${project.name}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  fs.mkdirSync(path.join(project.dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(stampPath(project.dir), `${manifestHash(project.dir)}\n`, 'utf8');
  console.log(`[deps] ${project.name} pronto.`);
}

function ensureDependencies(project) {
  const packageJsonPath = path.join(project.dir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.log(`[deps] Pulando ${project.name}: package.json nao encontrado.`);
    return;
  }

  const expectedHash = manifestHash(project.dir);
  const nodeModulesPath = path.join(project.dir, 'node_modules');
  const stamp = stampPath(project.dir);

  if (!fs.existsSync(nodeModulesPath)) {
    installDependencies(project);
    return;
  }

  if (!fs.existsSync(stamp)) {
    installDependencies(project);
    return;
  }

  const currentHash = fs.readFileSync(stamp, 'utf8').trim();
  if (currentHash !== expectedHash) {
    installDependencies(project);
    return;
  }

  console.log(`[deps] ${project.name} ja esta atualizado.`);
}

for (const project of projects) {
  ensureDependencies(project);
}

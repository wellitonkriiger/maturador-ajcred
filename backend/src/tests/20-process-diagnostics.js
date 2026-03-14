const assert = require('assert/strict');

const {
  parseProcStatus,
  parseProcCgroup,
  parseMemoryValue,
  readCgroupMemorySnapshot,
  collectBrowserDescendantsFromProcessTable,
  collectProcessDiagnostics
} = require('../utils/processDiagnostics');

function testParseProcStatus() {
  const parsed = parseProcStatus([
    'Name:\tnode',
    'PPid:\t12',
    'Threads:\t19',
    'VmRSS:\t  41234 kB',
    'VmHWM:\t  52345 kB'
  ].join('\n'));

  assert.equal(parsed.Name, 'node');
  assert.equal(parsed.PPid, '12');
  assert.equal(parsed.Threads, '19');
  assert.equal(parseMemoryValue(parsed.VmRSS), 41234 * 1024);
  assert.equal(parseMemoryValue(parsed.VmHWM), 52345 * 1024);
  console.log('PASS process diagnostics -> parse /proc/self/status');
}

function testParseCgroupAndMemorySnapshot() {
  const cgroupRaw = '0::/system.slice/maturador.service';
  const files = new Map([
    ['/proc/321/cgroup', cgroupRaw],
    ['/sys/fs/cgroup/system.slice/maturador.service/memory.current', '104857600'],
    ['/sys/fs/cgroup/system.slice/maturador.service/memory.max', 'max']
  ]);

  const snapshot = readCgroupMemorySnapshot({
    pid: 321,
    readFile: (target) => files.get(target) || null
  });

  const parsed = parseProcCgroup(cgroupRaw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].path, '/system.slice/maturador.service');
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.source, 'cgroup-v2');
  assert.equal(snapshot.currentBytes, 104857600);
  assert.equal(snapshot.maxBytes, null);
  console.log('PASS process diagnostics -> parse cgroup memory');
}

function testBrowserDescendantsCollection() {
  const snapshot = collectBrowserDescendantsFromProcessTable([
    { pid: 100, ppid: 50, name: 'node', command: 'node backend/src/server.js' },
    { pid: 101, ppid: 100, name: 'chromium', command: '/usr/bin/chromium --headless' },
    { pid: 102, ppid: 101, name: 'chrome_crashpad', command: '/opt/google/chrome/chrome --type=renderer' },
    { pid: 200, ppid: 1, name: 'sshd', command: 'sshd: root@pts/0' }
  ], 100);

  assert.equal(snapshot.count, 2);
  assert.deepEqual(snapshot.pids, [101, 102]);
  console.log('PASS process diagnostics -> browser descendants');
}

function testNonLinuxFallback() {
  const snapshot = collectProcessDiagnostics({ platform: 'win32' });
  assert.equal(snapshot.platform, 'win32');
  assert.equal(snapshot.linuxProc.available, false);
  assert.equal(snapshot.cgroupMemory.available, false);
  assert.equal(snapshot.descendantBrowsers.available, false);
  assert.equal(typeof snapshot.memoryUsage.rss, 'number');
  console.log('PASS process diagnostics -> non-linux fallback');
}

async function main() {
  testParseProcStatus();
  testParseCgroupAndMemorySnapshot();
  testBrowserDescendantsCollection();
  testNonLinuxFallback();
}

main().catch((error) => {
  console.error('FAIL process diagnostics:', error.message);
  process.exit(1);
});

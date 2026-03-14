const fs = require('fs');
const path = require('path');

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function normalizeCmdline(raw) {
  if (!raw) return null;
  const normalized = raw.replace(/\0+/g, ' ').trim();
  return normalized || null;
}

function parseProcStatus(raw) {
  const values = {};
  if (!raw) return values;

  for (const line of String(raw).split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      values[key] = value;
    }
  }

  return values;
}

function parseProcCgroup(raw) {
  if (!raw) return [];

  return String(raw)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hierarchyId = '', controllerText = '', groupPath = ''] = line.split(':');
      return {
        hierarchyId,
        controllers: controllerText ? controllerText.split(',').filter(Boolean) : [],
        path: groupPath || '/'
      };
    });
}

function parseMemoryValue(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (text === 'max') return null;

  const kbMatch = text.match(/^(\d+)\s*kB$/i);
  if (kbMatch) {
    return Number(kbMatch[1]) * 1024;
  }

  const bytes = Number(text);
  return Number.isFinite(bytes) ? bytes : null;
}

function joinUnixPath(rootPath, childPath) {
  const segments = String(childPath || '/')
    .split('/')
    .filter(Boolean);
  return path.posix.join(rootPath, ...segments);
}

function readProcStatusEntry(pid, { procRoot = '/proc', readFile = safeReadFile } = {}) {
  const raw = readFile(path.posix.join(procRoot, String(pid), 'status'));
  if (!raw) return null;

  const parsed = parseProcStatus(raw);
  return {
    pid: Number(pid),
    ppid: Number(parsed.PPid) || 0,
    name: parsed.Name || null,
    threads: Number(parsed.Threads) || null,
    vmRssBytes: parseMemoryValue(parsed.VmRSS),
    vmHwmBytes: parseMemoryValue(parsed.VmHWM),
    uid: parsed.Uid || null
  };
}

function readProcCmdline(pid, { procRoot = '/proc', readFile = safeReadFile } = {}) {
  return normalizeCmdline(readFile(path.posix.join(procRoot, String(pid), 'cmdline')));
}

function readCgroupMemorySnapshot({
  pid = process.pid,
  procRoot = '/proc',
  cgroupRoot = '/sys/fs/cgroup',
  readFile = safeReadFile
} = {}) {
  const procCgroupPath = path.posix.join(procRoot, String(pid), 'cgroup');
  const cgroupData = readFile(procCgroupPath);
  const entries = parseProcCgroup(cgroupData);
  if (entries.length === 0) {
    return {
      available: false,
      source: null,
      currentBytes: null,
      maxBytes: null
    };
  }

  const unifiedEntry = entries.find((entry) => entry.hierarchyId === '0' && entry.controllers.length === 0);
  if (unifiedEntry) {
    const basePath = joinUnixPath(cgroupRoot, unifiedEntry.path);
    return {
      available: true,
      source: 'cgroup-v2',
      currentBytes: parseMemoryValue(readFile(path.posix.join(basePath, 'memory.current'))),
      maxBytes: parseMemoryValue(readFile(path.posix.join(basePath, 'memory.max')))
    };
  }

  const memoryEntry = entries.find((entry) => entry.controllers.includes('memory'));
  if (!memoryEntry) {
    return {
      available: false,
      source: null,
      currentBytes: null,
      maxBytes: null
    };
  }

  const basePath = joinUnixPath(path.posix.join(cgroupRoot, 'memory'), memoryEntry.path);
  return {
    available: true,
    source: 'cgroup-v1',
    currentBytes: parseMemoryValue(readFile(path.posix.join(basePath, 'memory.usage_in_bytes'))),
    maxBytes: parseMemoryValue(readFile(path.posix.join(basePath, 'memory.limit_in_bytes')))
  };
}

function listProcPids({ procRoot = '/proc', readdir = fs.readdirSync } = {}) {
  try {
    return readdir(procRoot).filter((entry) => /^\d+$/.test(String(entry)));
  } catch {
    return [];
  }
}

function buildLinuxProcessTable({
  procRoot = '/proc',
  readFile = safeReadFile,
  readdir = fs.readdirSync
} = {}) {
  const processes = [];

  for (const pid of listProcPids({ procRoot, readdir })) {
    const status = readProcStatusEntry(pid, { procRoot, readFile });
    if (!status) continue;

    processes.push({
      pid: status.pid,
      ppid: status.ppid,
      name: status.name || null,
      command: readProcCmdline(pid, { procRoot, readFile }),
      threads: status.threads,
      vmRssBytes: status.vmRssBytes
    });
  }

  return processes;
}

function collectBrowserDescendantsFromProcessTable(processes, rootPid = process.pid) {
  const byParent = new Map();
  for (const processEntry of processes) {
    const siblings = byParent.get(processEntry.ppid) || [];
    siblings.push(processEntry);
    byParent.set(processEntry.ppid, siblings);
  }

  const descendants = [];
  const stack = [...(byParent.get(rootPid) || [])];

  while (stack.length > 0) {
    const current = stack.pop();
    descendants.push(current);
    stack.push(...(byParent.get(current.pid) || []));
  }

  const browserMatches = descendants.filter((entry) => {
    const haystack = `${entry.name || ''} ${entry.command || ''}`.toLowerCase();
    return haystack.includes('chromium') || haystack.includes('chrome') || haystack.includes('headless');
  });

  return {
    count: browserMatches.length,
    pids: browserMatches.map((entry) => entry.pid),
    sample: browserMatches.slice(0, 12)
  };
}

function buildProcessMemorySnapshot(memoryUsage = process.memoryUsage()) {
  return {
    rss: Number(memoryUsage?.rss) || 0,
    heapUsed: Number(memoryUsage?.heapUsed) || 0,
    heapTotal: Number(memoryUsage?.heapTotal) || 0,
    external: Number(memoryUsage?.external) || 0,
    arrayBuffers: Number(memoryUsage?.arrayBuffers) || 0
  };
}

function collectProcessDiagnostics({
  platform = process.platform,
  pid = process.pid,
  ppid = process.ppid,
  uptimeSec = Math.round(process.uptime()),
  procRoot = '/proc',
  cgroupRoot = '/sys/fs/cgroup',
  readFile = safeReadFile,
  readdir = fs.readdirSync
} = {}) {
  const snapshot = {
    pid,
    ppid,
    uptimeSec,
    platform,
    memoryUsage: buildProcessMemorySnapshot(),
    linuxProc: {
      available: false,
      threads: null,
      vmRssBytes: null,
      vmHwmBytes: null
    },
    cgroupMemory: {
      available: false,
      source: null,
      currentBytes: null,
      maxBytes: null
    },
    descendantBrowsers: {
      available: false,
      count: 0,
      pids: [],
      sample: []
    }
  };

  if (platform !== 'linux') {
    return snapshot;
  }

  const selfStatus = readProcStatusEntry(pid, { procRoot, readFile });
  if (selfStatus) {
    snapshot.linuxProc = {
      available: true,
      threads: selfStatus.threads,
      vmRssBytes: selfStatus.vmRssBytes,
      vmHwmBytes: selfStatus.vmHwmBytes
    };
  }

  snapshot.cgroupMemory = readCgroupMemorySnapshot({
    pid,
    procRoot,
    cgroupRoot,
    readFile
  });

  const processTable = buildLinuxProcessTable({
    procRoot,
    readFile,
    readdir
  });
  const descendants = collectBrowserDescendantsFromProcessTable(processTable, pid);
  snapshot.descendantBrowsers = {
    available: true,
    count: descendants.count,
    pids: descendants.pids,
    sample: descendants.sample
  };

  return snapshot;
}

module.exports = {
  parseProcStatus,
  parseProcCgroup,
  parseMemoryValue,
  readCgroupMemorySnapshot,
  collectBrowserDescendantsFromProcessTable,
  collectProcessDiagnostics
};

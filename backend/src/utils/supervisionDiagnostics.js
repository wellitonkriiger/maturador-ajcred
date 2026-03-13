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

function readProcStatus(pid) {
  const raw = safeReadFile(`/proc/${pid}/status`);
  if (!raw) return null;

  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return {
    name: values.Name || null,
    ppid: Number(values.PPid) || 0,
    uid: values.Uid || null
  };
}

function readProcCmdline(pid) {
  return normalizeCmdline(safeReadFile(`/proc/${pid}/cmdline`));
}

function readProcComm(pid) {
  return safeReadFile(`/proc/${pid}/comm`)?.trim() || null;
}

function readProcCgroup(pid = process.pid) {
  return safeReadFile(`/proc/${pid}/cgroup`);
}

function readProcessEntry(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  const status = readProcStatus(pid);
  if (!status) return null;

  return {
    pid,
    ppid: status.ppid || 0,
    name: status.name || readProcComm(pid),
    command: readProcCmdline(pid),
    uid: status.uid
  };
}

function readProcessChain(startPid = process.pid, maxDepth = 8) {
  const entries = [];
  const seen = new Set();
  let currentPid = startPid;

  while (Number.isInteger(currentPid) && currentPid > 0 && entries.length < maxDepth && !seen.has(currentPid)) {
    seen.add(currentPid);
    const entry = readProcessEntry(currentPid);
    if (!entry) break;
    entries.push(entry);

    if (!entry.ppid || entry.ppid === currentPid) {
      break;
    }

    currentPid = entry.ppid;
  }

  return entries;
}

function extractSystemdUnit(cgroup) {
  if (!cgroup) return null;

  const match = cgroup.match(/([A-Za-z0-9_.@-]+\.service)/);
  return match?.[1] || null;
}

function inferSupervisor(chain, cgroup) {
  const reasons = [];
  const invocationId = process.env.INVOCATION_ID || null;
  const journalStream = process.env.JOURNAL_STREAM || null;
  const notifySocket = process.env.NOTIFY_SOCKET || null;
  const systemdUnit = extractSystemdUnit(cgroup);

  if (invocationId) reasons.push('env:INVOCATION_ID');
  if (journalStream) reasons.push('env:JOURNAL_STREAM');
  if (notifySocket) reasons.push('env:NOTIFY_SOCKET');
  if (systemdUnit) reasons.push('cgroup:.service');

  const hasSystemdAncestor = chain.some((entry) => {
    const name = String(entry?.name || '').toLowerCase();
    const command = String(entry?.command || '').toLowerCase();
    return name === 'systemd' || command.includes('systemd');
  });

  if (hasSystemdAncestor) {
    reasons.push('ancestor:systemd');
  }

  if (reasons.length > 0) {
    return {
      manager: 'systemd',
      confidence: 'inferred',
      reasons,
      unit: systemdUnit
    };
  }

  return {
    manager: 'other_or_unknown',
    confidence: 'unknown',
    reasons,
    unit: systemdUnit
  };
}

function findGitRoot(startDir = process.cwd()) {
  let currentDir = startDir;

  while (true) {
    if (fs.existsSync(path.join(currentDir, '.git'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function readGitRevision() {
  try {
    const gitRoot = findGitRoot();
    if (!gitRoot) return null;

    const headPath = path.join(gitRoot, '.git', 'HEAD');
    const headContent = safeReadFile(headPath)?.trim();
    if (!headContent) return null;

    if (!headContent.startsWith('ref:')) {
      return headContent.slice(0, 12);
    }

    const refPath = headContent.replace(/^ref:\s*/, '').trim();
    const refContent = safeReadFile(path.join(gitRoot, '.git', refPath))?.trim();
    return refContent ? refContent.slice(0, 12) : null;
  } catch {
    return null;
  }
}

function buildCommonRuntimeMeta() {
  const chain = readProcessChain();
  const cgroup = readProcCgroup();
  const supervisor = inferSupervisor(chain, cgroup);

  return {
    pid: process.pid,
    ppid: process.ppid,
    nodeVersion: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    uptimeSec: Math.round(process.uptime()),
    revision: readGitRevision(),
    supervisor,
    ancestry: chain,
    systemdEnv: {
      invocationId: process.env.INVOCATION_ID || null,
      hasJournalStream: Boolean(process.env.JOURNAL_STREAM),
      hasNotifySocket: Boolean(process.env.NOTIFY_SOCKET)
    },
    cgroup: cgroup ? cgroup.trim().split(/\r?\n/).slice(0, 6) : null
  };
}

function buildStartupDiagnostics() {
  return {
    event: 'startup',
    ...buildCommonRuntimeMeta()
  };
}

function buildSignalDiagnostics(signal) {
  return {
    event: 'signal',
    signal,
    sender: 'unknown_from_node_runtime',
    senderConfidence: 'unknown',
    note: 'O Node.js nao expoe o PID de quem enviou o SIGTERM/SIGINT. Os dados abaixo mostram o contexto de supervisao do processo.',
    ...buildCommonRuntimeMeta()
  };
}

module.exports = {
  buildStartupDiagnostics,
  buildSignalDiagnostics
};

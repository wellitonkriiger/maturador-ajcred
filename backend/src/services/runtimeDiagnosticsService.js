const fs = require('fs');
const os = require('os');

const MAX_RECENT_EVENTS = 60;
const EXACT_ENV_KEYS = new Set([
  'PORT',
  'HOST',
  'HOSTNAME',
  'NODE_ENV',
  'SERVE_FRONTEND',
  'DAILY_RESET_TIMEZONE',
  'TZ',
  'WHATSAPP_BROWSER_EXECUTABLE_PATH',
  'PUPPETEER_EXECUTABLE_PATH',
  'CHROME_PATH',
  'npm_lifecycle_event',
  'npm_execpath',
  'npm_node_execpath'
]);
const ENV_PATTERNS = [
  /HEALTH/i,
  /PROBE/i,
  /RESTART/i,
  /GRACE/i,
  /TIMEOUT/i,
  /MEMORY/i,
  /CPU/i,
  /NOBRE_/i,
  /CONTAINER/i,
  /DOCKER/i,
  /KUBERNETES/i,
  /RAILWAY_/i,
  /RENDER_/i
];
const SENSITIVE_ENV_PATTERN = /(SECRET|TOKEN|PASSWORD|PASS|PWD|PRIVATE|CERT|COOKIE|SESSION|AUTH|KEY)/i;

function firstErrorLine(error) {
  const text = error?.message ?? String(error ?? '');
  return text.split('\n')[0];
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(size >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

class RuntimeDiagnosticsService {
  constructor() {
    this.events = [];
    this.startedAt = new Date().toISOString();
  }

  _nowIso() {
    return new Date().toISOString();
  }

  _truncate(value, maxLength = 240) {
    const text = String(value ?? '');
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
  }

  _sanitizeForJson(value) {
    if (value === null || typeof value === 'undefined') return value ?? null;
    if (value instanceof Error) return firstErrorLine(value);
    if (Array.isArray(value)) return value.map((item) => this._sanitizeForJson(item));
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this._sanitizeForJson(item)])
      );
    }
    if (typeof value === 'string') return this._truncate(value, 400);
    return value;
  }

  toLogString(payload) {
    try {
      return JSON.stringify(this._sanitizeForJson(payload));
    } catch (error) {
      return JSON.stringify({ error: firstErrorLine(error) });
    }
  }

  record(category, name, details = {}) {
    const event = {
      at: this._nowIso(),
      uptimeSec: Math.round(process.uptime()),
      category,
      name,
      details: this._sanitizeForJson(details)
    };

    this.events.push(event);
    if (this.events.length > MAX_RECENT_EVENTS) {
      this.events.splice(0, this.events.length - MAX_RECENT_EVENTS);
    }

    return event;
  }

  getRecentEvents(limit = 12) {
    const cappedLimit = Math.max(1, Math.min(Number(limit) || 12, MAX_RECENT_EVENTS));
    return this.events.slice(-cappedLimit);
  }

  _shouldExposeEnvKey(key) {
    if (!key) return false;
    if (SENSITIVE_ENV_PATTERN.test(key)) return false;
    if (EXACT_ENV_KEYS.has(key)) return true;
    return ENV_PATTERNS.some((pattern) => pattern.test(key));
  }

  _collectEnvSnapshot() {
    const snapshot = {};

    for (const key of Object.keys(process.env).sort()) {
      if (!this._shouldExposeEnvKey(key)) continue;
      snapshot[key] = this._truncate(process.env[key], 240);
    }

    return snapshot;
  }

  _readTextFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch {
      return null;
    }
  }

  _readNumericFile(filePath) {
    const raw = this._readTextFile(filePath);
    if (!raw) return null;
    if (raw === 'max') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  _readCpuMax(filePath) {
    const raw = this._readTextFile(filePath);
    if (!raw) return null;

    const [quotaRaw, periodRaw] = raw.split(/\s+/);
    if (!quotaRaw || !periodRaw) return null;

    const quotaMicros = quotaRaw === 'max' ? null : Number(quotaRaw);
    const periodMicros = Number(periodRaw);
    const cpuCountLimit = Number.isFinite(quotaMicros) && Number.isFinite(periodMicros) && periodMicros > 0
      ? Number((quotaMicros / periodMicros).toFixed(2))
      : null;

    return {
      raw,
      quotaMicros: Number.isFinite(quotaMicros) ? quotaMicros : null,
      periodMicros: Number.isFinite(periodMicros) ? periodMicros : null,
      cpuCountLimit
    };
  }

  _normalizeUnlimitedMemory(value) {
    if (!Number.isFinite(value) || value <= 0) return null;
    if (value >= Number.MAX_SAFE_INTEGER / 4) return null;
    return value;
  }

  _getCgroupSnapshot() {
    if (process.platform !== 'linux') {
      return {
        available: false,
        reason: `cgroup_unsupported_${process.platform}`
      };
    }

    const proc1Cmdline = this._readTextFile('/proc/1/cmdline');
    const procSelfCgroup = this._readTextFile('/proc/self/cgroup');
    const cgroupV2MemoryCurrent = this._readNumericFile('/sys/fs/cgroup/memory.current');
    const cgroupV2MemoryMax = this._normalizeUnlimitedMemory(this._readNumericFile('/sys/fs/cgroup/memory.max'));
    const cgroupV2CpuMax = this._readCpuMax('/sys/fs/cgroup/cpu.max');
    const cgroupV2Cpuset = this._readTextFile('/sys/fs/cgroup/cpuset.cpus.effective');

    if (
      cgroupV2MemoryCurrent !== null ||
      cgroupV2MemoryMax !== null ||
      cgroupV2CpuMax ||
      cgroupV2Cpuset
    ) {
      return {
        available: true,
        version: 'v2',
        initProcess: proc1Cmdline ? proc1Cmdline.split('\u0000').filter(Boolean) : null,
        selfCgroup: procSelfCgroup ? procSelfCgroup.split('\n').filter(Boolean) : null,
        memory: {
          currentBytes: cgroupV2MemoryCurrent,
          current: formatBytes(cgroupV2MemoryCurrent),
          limitBytes: cgroupV2MemoryMax,
          limit: formatBytes(cgroupV2MemoryMax)
        },
        cpu: cgroupV2CpuMax,
        cpuset: cgroupV2Cpuset || null
      };
    }

    const v1Limit = this._normalizeUnlimitedMemory(
      this._readNumericFile('/sys/fs/cgroup/memory/memory.limit_in_bytes')
    );
    const v1Current = this._readNumericFile('/sys/fs/cgroup/memory/memory.usage_in_bytes');
    const quotaMicros = this._readNumericFile('/sys/fs/cgroup/cpu/cpu.cfs_quota_us');
    const periodMicros = this._readNumericFile('/sys/fs/cgroup/cpu/cpu.cfs_period_us');
    const cpuset = this._readTextFile('/sys/fs/cgroup/cpuset/cpuset.cpus');

    if (v1Limit !== null || v1Current !== null || quotaMicros !== null || periodMicros !== null || cpuset) {
      return {
        available: true,
        version: 'v1',
        initProcess: proc1Cmdline ? proc1Cmdline.split('\u0000').filter(Boolean) : null,
        selfCgroup: procSelfCgroup ? procSelfCgroup.split('\n').filter(Boolean) : null,
        memory: {
          currentBytes: v1Current,
          current: formatBytes(v1Current),
          limitBytes: v1Limit,
          limit: formatBytes(v1Limit)
        },
        cpu: {
          quotaMicros,
          periodMicros,
          cpuCountLimit: Number.isFinite(quotaMicros) && Number.isFinite(periodMicros) && quotaMicros > 0 && periodMicros > 0
            ? Number((quotaMicros / periodMicros).toFixed(2))
            : null
        },
        cpuset: cpuset || null
      };
    }

    return {
      available: false,
      reason: 'cgroup_not_detected',
      initProcess: proc1Cmdline ? proc1Cmdline.split('\u0000').filter(Boolean) : null,
      selfCgroup: procSelfCgroup ? procSelfCgroup.split('\n').filter(Boolean) : null
    };
  }

  _getActiveHandlesSummary() {
    if (typeof process._getActiveHandles !== 'function') {
      return null;
    }

    try {
      const summary = {};
      for (const handle of process._getActiveHandles()) {
        const name = handle?.constructor?.name || 'UnknownHandle';
        summary[name] = (summary[name] || 0) + 1;
      }
      return summary;
    } catch {
      return null;
    }
  }

  _getProcessSnapshot() {
    const memoryUsage = process.memoryUsage();
    const resourceUsage = typeof process.resourceUsage === 'function' ? process.resourceUsage() : null;

    return {
      pid: process.pid,
      ppid: process.ppid,
      startedAt: this.startedAt,
      uptimeSec: Math.round(process.uptime()),
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: {
        rssBytes: memoryUsage.rss,
        rss: formatBytes(memoryUsage.rss),
        heapTotalBytes: memoryUsage.heapTotal,
        heapTotal: formatBytes(memoryUsage.heapTotal),
        heapUsedBytes: memoryUsage.heapUsed,
        heapUsed: formatBytes(memoryUsage.heapUsed),
        externalBytes: memoryUsage.external,
        external: formatBytes(memoryUsage.external),
        arrayBuffersBytes: memoryUsage.arrayBuffers,
        arrayBuffers: formatBytes(memoryUsage.arrayBuffers)
      },
      resourceUsage,
      activeHandles: this._getActiveHandlesSummary()
    };
  }

  _getOsSnapshot() {
    return {
      hostname: os.hostname(),
      release: os.release(),
      totalMemoryBytes: os.totalmem(),
      totalMemory: formatBytes(os.totalmem()),
      freeMemoryBytes: os.freemem(),
      freeMemory: formatBytes(os.freemem()),
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg()
    };
  }

  buildRuntimeReport(extra = {}) {
    const sanitizedExtra = this._sanitizeForJson(extra);
    const normalizedExtra = sanitizedExtra && typeof sanitizedExtra === 'object' && !Array.isArray(sanitizedExtra)
      ? sanitizedExtra
      : { extra: sanitizedExtra };

    return {
      generatedAt: this._nowIso(),
      process: this._getProcessSnapshot(),
      os: this._getOsSnapshot(),
      cgroup: this._getCgroupSnapshot(),
      environment: this._collectEnvSnapshot(),
      recentEvents: this.getRecentEvents(),
      ...normalizedExtra
    };
  }

  getStartupLogContext(extra = {}) {
    const report = this.buildRuntimeReport(extra);
    return {
      process: {
        pid: report.process.pid,
        ppid: report.process.ppid,
        uptimeSec: report.process.uptimeSec,
        argv: report.process.argv
      },
      environment: report.environment,
      cgroup: report.cgroup,
      os: {
        hostname: report.os.hostname,
        cpuCount: report.os.cpuCount,
        totalMemory: report.os.totalMemory,
        freeMemory: report.os.freeMemory
      }
    };
  }

  getSignalLogContext(signal, extra = {}) {
    const report = this.buildRuntimeReport(extra);
    return {
      signal,
      classification: signal === 'SIGTERM' ? 'external_sigterm' : signal,
      process: {
        pid: report.process.pid,
        uptimeSec: report.process.uptimeSec,
        memory: report.process.memory,
        activeHandles: report.process.activeHandles
      },
      cgroup: report.cgroup,
      recentEvents: report.recentEvents
    };
  }
}

module.exports = new RuntimeDiagnosticsService();

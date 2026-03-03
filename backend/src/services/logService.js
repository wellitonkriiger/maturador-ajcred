const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../data/logs');
const FILES = {
  combined: 'combined.log',
  error: 'error.log'
};

class LogService {
  _resolveFile(fileKey = 'combined') {
    const safeKey = FILES[fileKey] ? fileKey : 'combined';
    return {
      key: safeKey,
      filename: FILES[safeKey],
      fullpath: path.join(LOG_DIR, FILES[safeKey])
    };
  }

  listFiles() {
    return Object.entries(FILES).map(([key, filename]) => ({ key, filename }));
  }

  _parseLine(line) {
    try {
      const parsed = JSON.parse(line);
      return {
        timestamp: parsed.timestamp ?? null,
        level: parsed.level ?? 'info',
        message: parsed.message ?? '',
        meta: parsed.meta ?? null,
        raw: line
      };
    } catch {
      return {
        timestamp: null,
        level: 'info',
        message: line,
        meta: null,
        raw: line
      };
    }
  }

  read({ file = 'combined', limit = 200, level, search } = {}) {
    const resolved = this._resolveFile(file);
    if (!fs.existsSync(resolved.fullpath)) {
      return {
        file: resolved.key,
        filename: resolved.filename,
        total: 0,
        items: []
      };
    }

    const raw = fs.readFileSync(resolved.fullpath, 'utf8');
    let lines = raw.split(/\r?\n/).filter(Boolean);

    if (search) {
      const lowered = String(search).toLowerCase();
      lines = lines.filter(line => line.toLowerCase().includes(lowered));
    }

    let items = lines.map(line => this._parseLine(line));

    if (level) {
      items = items.filter(item => item.level === level);
    }

    const cappedLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
    const sliced = items.slice(-cappedLimit).reverse();

    return {
      file: resolved.key,
      filename: resolved.filename,
      total: items.length,
      items: sliced
    };
  }
}

module.exports = new LogService();

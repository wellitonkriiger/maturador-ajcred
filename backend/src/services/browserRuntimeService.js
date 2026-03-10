const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');

const { buildBrowserLaunchOptions } = require('../utils/browserLaunch');

const DIAGNOSIS_TTL_MS = 5 * 60 * 1000;
const VALIDATION_TIMEOUT_MS = 15 * 1000;
const ENV_EXECUTABLE_KEYS = [
  'WHATSAPP_BROWSER_EXECUTABLE_PATH',
  'PUPPETEER_EXECUTABLE_PATH',
  'CHROME_PATH'
];

function firstErrorLine(error) {
  const text = error?.message ?? String(error ?? '');
  return text.split('\n')[0];
}

function normalizeExecutablePath(filePath) {
  const normalized = String(filePath || '').trim();
  return normalized || null;
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  const result = [];

  for (const candidate of candidates) {
    const executablePath = normalizeExecutablePath(candidate?.executablePath);
    if (!executablePath || seen.has(executablePath)) continue;
    seen.add(executablePath);
    result.push({
      ...candidate,
      executablePath
    });
  }

  return result;
}

class BrowserRuntimeService {
  constructor() {
    this.diagnosis = this._buildDiagnosis({
      available: false,
      source: null,
      executablePath: null,
      message: 'Runtime do navegador ainda nao validado'
    });
    this.validationInFlight = null;
  }

  getPlatform() {
    return process.platform;
  }

  _nowIso() {
    return new Date().toISOString();
  }

  _pathExists(filePath) {
    return fs.existsSync(filePath);
  }

  _buildDiagnosis({
    available = false,
    source = null,
    executablePath = null,
    message = 'Runtime do navegador indisponivel'
  } = {}) {
    return {
      available,
      source,
      executablePath,
      platform: this.getPlatform(),
      message,
      checkedAt: this._nowIso()
    };
  }

  getDiagnosis() {
    return this.diagnosis;
  }

  setDiagnosis(diagnosis) {
    this.diagnosis = this._buildDiagnosis(diagnosis);
    return this.diagnosis;
  }

  isDiagnosisStale(staleMs = DIAGNOSIS_TTL_MS) {
    const checkedAt = this.diagnosis?.checkedAt;
    if (!checkedAt) return true;

    const checkedTime = new Date(checkedAt).getTime();
    if (Number.isNaN(checkedTime)) return true;

    return Date.now() - checkedTime > staleMs;
  }

  _getConfiguredExecutableCandidate() {
    for (const envKey of ENV_EXECUTABLE_KEYS) {
      const executablePath = normalizeExecutablePath(process.env[envKey]);
      if (!executablePath) continue;

      return {
        source: `env:${envKey}`,
        executablePath
      };
    }

    return null;
  }

  _findWindowsExecutableCandidates() {
    const programFiles = normalizeExecutablePath(process.env.ProgramFiles);
    const programFilesX86 = normalizeExecutablePath(process.env['ProgramFiles(x86)']);
    const localAppData = normalizeExecutablePath(process.env.LOCALAPPDATA);

    return uniqueCandidates([
      programFiles ? {
        source: 'system:chrome',
        executablePath: path.win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')
      } : null,
      programFilesX86 ? {
        source: 'system:chrome',
        executablePath: path.win32.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')
      } : null,
      localAppData ? {
        source: 'system:chrome',
        executablePath: path.win32.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
      } : null
    ].filter(Boolean));
  }

  _resolveCommandPath(command) {
    try {
      const output = execFileSync('which', [command], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const executablePath = normalizeExecutablePath(output.split(/\r?\n/).find(Boolean));
      return executablePath || null;
    } catch (_) {
      return null;
    }
  }

  _findLinuxExecutableCandidates() {
    const binaries = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'];

    return uniqueCandidates(
      binaries.map((command) => {
        const executablePath = this._resolveCommandPath(command);
        if (!executablePath) return null;

        return {
          source: `system:${command}`,
          executablePath
        };
      }).filter(Boolean)
    );
  }

  _findManagedExecutableCandidate() {
    try {
      const executablePath = normalizeExecutablePath(puppeteer.executablePath());
      if (!executablePath) return null;

      return {
        source: 'puppeteer:managed',
        executablePath
      };
    } catch (error) {
      return {
        source: 'puppeteer:managed',
        executablePath: null,
        resolutionError: firstErrorLine(error)
      };
    }
  }

  resolveExecutableCandidate() {
    const configured = this._getConfiguredExecutableCandidate();
    if (configured) return configured;

    if (this.getPlatform() === 'win32') {
      const windowsCandidate = this._findWindowsExecutableCandidates()
        .find((candidate) => this._pathExists(candidate.executablePath));
      if (windowsCandidate) return windowsCandidate;
    }

    if (this.getPlatform() === 'linux') {
      const linuxCandidate = this._findLinuxExecutableCandidates()
        .find((candidate) => this._pathExists(candidate.executablePath));
      if (linuxCandidate) return linuxCandidate;
    }

    const managed = this._findManagedExecutableCandidate();
    if (managed) return managed;

    return null;
  }

  getLaunchOptions() {
    const candidate = this.resolveExecutableCandidate();
    return buildBrowserLaunchOptions({
      executablePath: candidate?.executablePath || null,
      platform: this.getPlatform()
    });
  }

  async _launchBrowser(launchOptions) {
    return puppeteer.launch({
      ...launchOptions,
      timeout: VALIDATION_TIMEOUT_MS
    });
  }

  async _performValidation() {
    const candidate = this.resolveExecutableCandidate();

    if (!candidate) {
      return this.setDiagnosis({
        available: false,
        source: null,
        executablePath: null,
        message: 'Nenhum Chrome/Chromium encontrado. Defina WHATSAPP_BROWSER_EXECUTABLE_PATH ou instale um navegador suportado.'
      });
    }

    if (!candidate.executablePath) {
      return this.setDiagnosis({
        available: false,
        source: candidate.source,
        executablePath: null,
        message: candidate.resolutionError || 'Nao foi possivel localizar o browser gerenciado pelo Puppeteer.'
      });
    }

    if (!this._pathExists(candidate.executablePath)) {
      return this.setDiagnosis({
        available: false,
        source: candidate.source,
        executablePath: candidate.executablePath,
        message: `Executavel do navegador nao encontrado em ${candidate.executablePath}`
      });
    }

    let browser = null;

    try {
      browser = await this._launchBrowser(
        buildBrowserLaunchOptions({
          executablePath: candidate.executablePath,
          platform: this.getPlatform()
        })
      );

      const page = await browser.newPage();
      await page.goto('about:blank');

      return this.setDiagnosis({
        available: true,
        source: candidate.source,
        executablePath: candidate.executablePath,
        message: `Browser pronto (${candidate.source})`
      });
    } catch (error) {
      return this.setDiagnosis({
        available: false,
        source: candidate.source,
        executablePath: candidate.executablePath,
        message: firstErrorLine(error)
      });
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (_) {}
      }
    }
  }

  async validateBrowserRuntime({ force = false, staleMs = DIAGNOSIS_TTL_MS } = {}) {
    if (!force && this.diagnosis && !this.isDiagnosisStale(staleMs)) {
      return this.diagnosis;
    }

    if (this.validationInFlight) {
      return this.validationInFlight;
    }

    this.validationInFlight = this._performValidation()
      .finally(() => {
        this.validationInFlight = null;
      });

    return this.validationInFlight;
  }

  async ensureOperationalRuntime({ staleMs = DIAGNOSIS_TTL_MS } = {}) {
    const diagnosis = this.getDiagnosis();
    const force = !diagnosis || diagnosis.available !== true || this.isDiagnosisStale(staleMs);
    return this.validateBrowserRuntime({ force, staleMs });
  }

  getServiceHealth() {
    const diagnosis = this.getDiagnosis();

    return {
      status: diagnosis?.available === true ? 'ok' : 'degraded',
      services: {
        whatsappBrowser: diagnosis
      }
    };
  }
}

module.exports = new BrowserRuntimeService();

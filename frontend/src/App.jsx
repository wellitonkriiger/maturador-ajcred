import { useEffect, useState } from 'react';
import { CheckCircle2, FileJson, LayoutDashboard, Logs, Moon, Phone, Settings2, Sun, TriangleAlert } from 'lucide-react';
import DashboardPage from './DashboardPage';
import TelefonesPage from './TelefonesPage';
import ConversasPage from './ConversasPage';
import PlanoPage from './PlanoPage';
import LogsPage from './LogsPage';
import { api, BACKEND_ROOT, POLL_INTERVAL, removeExecucao, upsertById, upsertExecucao, useSocketEvents, useToasts } from './lib';

const THEME_STORAGE_KEY = 'ajcred-theme';

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');
  :root {
    --bg-layer-1: radial-gradient(circle at top right, rgba(255,106,0,.18), transparent 26%);
    --bg-layer-2: radial-gradient(circle at bottom left, rgba(255,106,0,.1), transparent 24%);
    --bg-layer-3: linear-gradient(180deg, #f7f7f7 0%, #ececec 100%);
    --text-primary: #1f2329;
    --text-muted: #5a6068;
    --surface-sidebar: rgba(255,255,255,.94);
    --surface-panel: rgba(255,255,255,.94);
    --surface-list: #ffffff;
    --surface-chip: #ffffff;
    --surface-soft: #f7f7f7;
    --border-main: #d8dde3;
    --border-soft: #e4e7eb;
    --border-table: #e6eaee;
    --shadow-panel: rgba(20,20,20,.05);
    --nav-text: #5a6068;
    --nav-active-bg: #ffffff;
    --nav-active-border: rgba(255,106,0,.22);
    --nav-active-shadow: inset 0 0 0 1px rgba(255,106,0,.08);
    --status-bg: #ffffff;
    --status-text: #5a6068;
    --btn-secondary-bg: #ffffff;
    --btn-secondary-text: #1f2329;
    --btn-secondary-border: #d8dde3;
    --btn-danger-bg: #fff1f2;
    --btn-danger-text: #b91c1c;
    --btn-danger-border: #fecdd3;
    --pill-border: #d8dde3;
    --pill-bg: #f7f7f7;
    --pill-text: #4a5059;
    --progress-bg: #eceff2;
    --empty-border: #d8dde3;
    --modal-backdrop: rgba(15,23,42,.4);
    --modal-bg: #ffffff;
    --code-bg: #f7f7f7;
    --code-text: #4a5059;
  }
  [data-theme='dark'] {
    --bg-layer-1: radial-gradient(circle at top right, rgba(255,255,255,.03), transparent 34%);
    --bg-layer-2: radial-gradient(circle at bottom left, rgba(255,255,255,.02), transparent 32%);
    --bg-layer-3: linear-gradient(180deg, #0f1012 0%, #08090a 100%);
    --text-primary: #f3f4f6;
    --text-muted: #aeb4bc;
    --surface-sidebar: rgba(12,13,15,.96);
    --surface-panel: rgba(16,17,20,.95);
    --surface-list: #16181b;
    --surface-chip: #14161a;
    --surface-soft: #17191d;
    --border-main: #2a2d33;
    --border-soft: #272a30;
    --border-table: #24272d;
    --shadow-panel: rgba(0,0,0,.35);
    --nav-text: #b8bec7;
    --nav-active-bg: #181b1f;
    --nav-active-border: rgba(255,106,0,.35);
    --nav-active-shadow: inset 0 0 0 1px rgba(255,106,0,.2);
    --status-bg: #16181b;
    --status-text: #c0c5cd;
    --btn-secondary-bg: #17191d;
    --btn-secondary-text: #f3f4f6;
    --btn-secondary-border: #2a2d33;
    --btn-danger-bg: #2a161a;
    --btn-danger-text: #ffb8c0;
    --btn-danger-border: #67313a;
    --pill-border: #2f333a;
    --pill-bg: #1b1e23;
    --pill-text: #d2d6de;
    --progress-bg: #20242a;
    --empty-border: #2b2f36;
    --modal-backdrop: rgba(0,0,0,.56);
    --modal-bg: #121417;
    --code-bg: #1a1d22;
    --code-text: #d5d9e0;
  }
  * { box-sizing: border-box; }
  html, body, #root { width: 100%; height: 100%; min-height: 100%; }
  body { margin: 0; font-family: 'Montserrat', sans-serif; background:
    var(--bg-layer-1),
    var(--bg-layer-2),
    var(--bg-layer-3);
    color: var(--text-primary);
    overflow: hidden;
  }
  .app { width: 100%; height: 100vh; font-size: 13px; }
  .sidebar { padding: 14px; border-right: 1px solid var(--border-main); background: var(--surface-sidebar); backdrop-filter: blur(14px); display: flex; flex-direction: column; gap: 12px; }
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: 224px;
    height: 100vh;
    overflow-y: auto;
    z-index: 5;
  }
  .brand {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2px 0 8px;
  }
  .brand-logo {
    width: 100%;
    max-width: 140px;
    height: auto;
    display: block;
    object-fit: contain;
    transition: background .25s ease, padding .25s ease, border-radius .25s ease, box-shadow .25s ease;
  }
  [data-theme='dark'] .brand-logo {
    filter: brightness(0) invert(1);
    opacity: .92;
    background: transparent;
    padding: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .nav { display: grid; gap: 7px; }
  .nav button, .btn { display: inline-flex; align-items: center; gap: 7px; border: 1px solid transparent; border-radius: 12px; padding: 8px 11px; cursor: pointer; font: inherit; font-weight: 600; }
  .nav button { background: transparent; color: var(--nav-text); }
  .nav button.active, .nav button:hover { background: var(--nav-active-bg); color: var(--text-primary); border-color: var(--nav-active-border); box-shadow: var(--nav-active-shadow); }
  .status { margin-top: auto; padding: 10px 12px; border: 1px solid var(--border-main); border-radius: 14px; background: var(--status-bg); display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--status-text); }
  .main {
    margin-left: 224px;
    padding: clamp(10px, 1.25vw, 20px);
    min-width: 0;
    width: calc(100vw - 224px);
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 16px; }
  .topbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .topbar h2, .section-head h3, .panel h3 { margin: 0; }
  .topbar h2 { font-size: clamp(35px, 1.6vw, 50px); }
  .section-head h3, .panel h3 { font-size: clamp(14px, 1vw, 17px); }
  .muted { color: var(--text-muted); }
  .chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 11px; border: 1px solid var(--border-main); border-radius: 999px; background: var(--surface-chip); font-size: 11px; color: var(--text-muted); }
  .stack { display: grid; gap: 12px; }
  .compact { gap: 8px; }
  .grid { display: grid; gap: 12px; }
  .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .panel, .card { background: var(--surface-panel); border: 1px solid var(--border-main); border-radius: 18px; padding: clamp(12px, 1vw, 16px); box-shadow: 0 12px 28px var(--shadow-panel); }
  .card.stat { display: grid; gap: 6px; }
  .card.stat strong { font-size: 21px; }
  .stats { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .section-head, .between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .small-gap { gap: 8px; }
  .list-card { border: 1px solid var(--border-soft); border-radius: 14px; padding: 10px; background: var(--surface-list); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .actions.end { justify-content: flex-end; }
  .actions.spaced-from-progress { margin-top: 10px; }
  .btn.primary { background: linear-gradient(135deg, #ff6a00, #ff8a32); color: white; box-shadow: 0 12px 24px rgba(255,106,0,.2); }
  .btn.secondary { background: var(--btn-secondary-bg); color: var(--btn-secondary-text); border-color: var(--btn-secondary-border); }
  .btn.danger { background: var(--btn-danger-bg); color: var(--btn-danger-text); border-color: var(--btn-danger-border); }
  .btn.sm { padding: 6px 8px; border-radius: 10px; font-size: 11px; }
  .btn:disabled { opacity: .6; cursor: not-allowed; }
  .label { display: grid; gap: 6px; font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .08em; }
  .input, .textarea { width: 100%; padding: 9px 11px; border: 1px solid var(--border-main); border-radius: 12px; font: inherit; color: var(--text-primary); background: var(--surface-list); }
  .textarea { min-height: 220px; resize: vertical; font-family: 'IBM Plex Mono', monospace; font-size: 10px; }
  .check { display: flex; align-items: center; gap: 8px; color: var(--text-primary); font-size: 12px; }
  .badge, .pill { display: inline-flex; align-items: center; gap: 7px; padding: 4px 8px; border: 1px solid; border-radius: 999px; font-size: 10px; font-weight: 700; }
  .pill { border-color: var(--pill-border); background: var(--pill-bg); color: var(--pill-text); }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .mono { font-family: 'IBM Plex Mono', monospace; font-size: 10px; }
  .progress { width: 100%; height: 7px; border-radius: 999px; overflow: hidden; background: var(--progress-bg); }
  .progress span { display: block; height: 100%; background: linear-gradient(135deg, #ff6a00, #ff8a32); }
  .empty { display: grid; gap: 10px; place-items: center; padding: 22px; border: 1px dashed var(--empty-border); border-radius: 16px; color: var(--text-muted); }
  .table-wrap { overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border-table); font-size: 11px; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); }
  .modal-backdrop { position: fixed; inset: 0; background: var(--modal-backdrop); display: grid; place-items: center; padding: 18px; z-index: 10; }
  .modal { width: min(700px, calc(100vw - 24px)); max-height: 90vh; overflow: auto; background: var(--modal-bg); border-radius: 20px; padding: 16px; border: 1px solid var(--border-main); }
  .modal.small { width: min(420px, 100%); }
  .modal-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
  .code { margin: 10px 0 0; padding: 11px; border-radius: 12px; background: var(--code-bg); color: var(--code-text); overflow: auto; font-family: 'IBM Plex Mono', monospace; font-size: 10px; }
  .center { justify-items: center; }
  .center-text { text-align: center; }
  .toast-wrap { position: fixed; right: 16px; bottom: 16px; display: grid; gap: 8px; z-index: 20; }
  .toast { min-width: 210px; max-width: 300px; padding: 10px 12px; color: white; border-radius: 14px; box-shadow: 0 16px 40px rgba(15,23,42,.16); font-size: 11px; }
  .toast.info { background: #ff6a00; } .toast.success { background: #ff7a1a; } .toast.error { background: #b91c1c; }
  @media (max-width: 1100px) {
    body { overflow: auto; }
    .stats, .grid.two { grid-template-columns: 1fr; }
    .sidebar {
      position: static;
      width: 100%;
      height: auto;
      overflow: visible;
      border-right: 0;
      border-bottom: 1px solid var(--border-main);
    }
    .main {
      margin-left: 0;
      width: 100%;
      height: auto;
      overflow: visible;
    }
  }
  @media (max-width: 720px) {
    .sidebar { padding: 14px; }
    .main { padding: 12px; }
    .topbar { flex-direction: column; align-items: flex-start; margin-bottom: 14px; }
    .topbar-actions { width: 100%; }
    .chip { width: 100%; justify-content: center; }
    .nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .nav button { justify-content: center; }
    .panel, .card { border-radius: 18px; padding: 14px; }
  }
`;

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light';
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  });
  const [page, setPage] = useState('dashboard');
  const [backendState, setBackendState] = useState('checking');
  const [browserRuntime, setBrowserRuntime] = useState(null);
  const [telefones, setTelefones] = useState([]);
  const [status, setStatus] = useState(null);
  const [ativas, setAtivas] = useState([]);
  const [liveLog, setLiveLog] = useState(null);
  const { toasts, push } = useToasts();

  function applyHealthPayload(payload) {
    setBrowserRuntime(payload?.services?.whatsappBrowser || null);
    setBackendState(payload?.status === 'degraded' ? 'degraded' : 'online');
  }

  async function refreshHealth() {
    try {
      const response = await fetch(`${BACKEND_ROOT}/health`);
      if (!response.ok) {
        throw new Error(`health_http_${response.status}`);
      }
      const payload = await response.json();
      applyHealthPayload(payload);
      return payload;
    } catch {
      setBackendState('offline');
      setBrowserRuntime(null);
      return null;
    }
  }

  async function refreshSnapshot() {
    try {
      const [phoneList, maturacaoStatus, activeList, healthPayload] = await Promise.all([
        api('/telefones'),
        api('/maturacao/status'),
        api('/maturacao/conversas-ativas'),
        refreshHealth()
      ]);
      setTelefones(Array.isArray(phoneList) ? phoneList : []);
      setStatus(maturacaoStatus);
      setAtivas(Array.isArray(activeList) ? activeList : []);
      if (healthPayload) {
        applyHealthPayload(healthPayload);
      }
    } catch {
      await refreshHealth();
    }
  }

  useEffect(() => {
    refreshSnapshot();
    const poll = window.setInterval(refreshSnapshot, POLL_INTERVAL);
    const health = window.setInterval(refreshHealth, 8000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(health);
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  useSocketEvents({
    onTelefoneStatus: (payload) => {
      if (payload?.deleted) {
        setTelefones((current) => current.filter((item) => item.id !== payload.telefoneId));
        return;
      }
      if (payload?.telefone) setTelefones((current) => upsertById(current, payload.telefone));
    },
    onMaturacaoStatus: (payload) => {
      setStatus(payload);
      if (Array.isArray(payload?.ativas)) setAtivas(payload.ativas);
    },
    onConversaStarted: (payload) => setAtivas((current) => upsertExecucao(current, payload)),
    onConversaUpdated: (payload) => setAtivas((current) => upsertExecucao(current, payload)),
    onConversaFinished: (payload) => setAtivas((current) => removeExecucao(current, payload.conversaExecucaoId)),
    onLog: (payload) => setLiveLog(payload)
  });

  const nav = [
    { id: 'dashboard', label: 'Dashboard', description: 'Informações gerais', icon: LayoutDashboard },
    { id: 'telefones', label: 'Telefones', description: 'Gerenciamento de sessões', icon: Phone },
    { id: 'conversas', label: 'Conversas', description: 'Manutenção de Conversas', icon: FileJson },
    { id: 'plano', label: 'Plano de maturação', description: 'Estratégia de maturação', icon: Settings2 },
    { id: 'logs', label: 'Logs', description: 'registros operacionais', icon: Logs }
  ];
  const activeNav = nav.find((item) => item.id === page) || nav[0];

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-logo" src="/logo.png" alt="AJCred" />
          </div>
          <nav className="nav">
            {nav.map((item) => {
              const Icon = item.icon;
              return <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><Icon size={17} />{item.label}</button>;
            })}
          </nav>
          <div className="status">
            {backendState === 'online' ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
            {backendState === 'checking'
              ? 'verificando backend'
              : backendState === 'degraded'
                ? 'backend degradado'
                : backendState === 'online'
                  ? 'backend online'
                  : 'backend offline'}
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <div>
              <h2>{activeNav.label}</h2>
              <div className="muted">{activeNav.description}</div>
            </div>
            <div className="topbar-actions">
              <button
                className="btn secondary sm"
                onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
              </button>
              <div className="chip">{new Date().toLocaleString('pt-BR')}</div>
            </div>
          </div>

          {page === 'dashboard' && <DashboardPage telefones={telefones} status={status} ativas={ativas} toast={push} refreshSnapshot={refreshSnapshot} />}
          {page === 'telefones' && <TelefonesPage telefones={telefones} toast={push} refreshSnapshot={refreshSnapshot} browserRuntime={browserRuntime} />}
          {page === 'conversas' && <ConversasPage toast={push} />}
          {page === 'plano' && <PlanoPage toast={push} status={status} />}
          {page === 'logs' && <LogsPage liveLog={liveLog} toast={push} />}
        </main>
      </div>

      <div className="toast-wrap">
        {toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}>{item.message}</div>)}
      </div>
    </>
  );
}

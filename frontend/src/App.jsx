import { useEffect, useState } from 'react';
import { CheckCircle2, FileJson, LayoutDashboard, Logs, Moon, Phone, Settings2, Sun, TriangleAlert } from 'lucide-react';
import './App.css';
import DashboardPage from './DashboardPage';
import TelefonesPage from './TelefonesPage';
import ConversasPage from './ConversasPage';
import PlanoPage from './PlanoPage';
import LogsPage from './LogsPage';
import { api, POLL_INTERVAL, removeExecucao, upsertById, upsertExecucao, useSocketEvents, useToasts } from './lib';

const THEME_STORAGE_KEY = 'ajcred-theme';

const NAV_GROUPS = [
  {
    label: 'Visão Geral',
    items: [
      { id: 'dashboard', label: 'Dashboard', description: 'Indicadores, operação e fila ativa', icon: LayoutDashboard }
    ]
  },
  {
    label: 'Gestão',
    items: [
      { id: 'telefones', label: 'Telefones', description: 'Sessões, conexão e capacidade', icon: Phone },
      { id: 'conversas', label: 'Conversas', description: 'Catálogo JSON validado pelo backend', icon: FileJson },
      { id: 'plano', label: 'Plano', description: 'Regras, horários e estratégia', icon: Settings2 }
    ]
  },
  {
    label: 'Sistema',
    items: [
      { id: 'logs', label: 'Logs', description: 'Registros operacionais e auditoria', icon: Logs }
    ]
  }
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

function backendStatusLabel(state) {
  if (state === 'checking') return 'Verificando backend';
  if (state === 'degraded') return 'Backend degradado';
  if (state === 'online') return 'Backend online';
  return 'Backend offline';
}

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
      const response = await fetch('/health');
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
    return () => {
      window.clearInterval(poll);
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

  const activeNav = NAV_ITEMS.find((item) => item.id === page) || NAV_ITEMS[0];
  const runtimeLabel = browserRuntime?.available === false
    ? browserRuntime.message
    : 'Status de sincronização';

  return (
    <>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="brand-lockup">
              <img className="brand-icon brand-icon-light" src="/Arte logo.png" alt="" />
              <img className="brand-icon brand-icon-dark" src="/Arte logo.svg" alt="" />
              <div className="brand-copy">
                <span className="brand-name">AJCred</span>
                <span className="brand-subtitle">Maturador</span>
              </div>
            </div>
          </div>

          <div className="sidebar-scroll">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="nav-group">
                <div className="nav-group-label">{group.label}</div>
                <nav className="nav">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        className={page === item.id ? 'active' : ''}
                        onClick={() => setPage(item.id)}
                      >
                        <Icon size={15} />
                        {item.label}
                      </button>
                    );
                  })}
                </nav>
              </div>
            ))}

            <div className="status">
              <span className={`status-dot ${backendState}`} />
              <div className="status-copy">
                <strong>{backendStatusLabel(backendState)}</strong>
                <span>{runtimeLabel}</span>
              </div>
              {backendState === 'online' ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />}
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <div className="topbar-copy">
              <div className="topbar-title">{activeNav.label}</div>
              <div className="topbar-badge">{activeNav.description}</div>
            </div>

            <div className="topbar-actions">
              <div className="topbar-clock">{new Date().toLocaleString('pt-BR')}</div>
              <button
                className="theme-toggle"
                onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
                title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
                aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </div>
          </div>

          <div className="content-shell">
            {page === 'dashboard' && <DashboardPage telefones={telefones} status={status} ativas={ativas} toast={push} refreshSnapshot={refreshSnapshot} />}
            {page === 'telefones' && <TelefonesPage telefones={telefones} toast={push} refreshSnapshot={refreshSnapshot} browserRuntime={browserRuntime} />}
            {page === 'conversas' && <ConversasPage toast={push} />}
            {page === 'plano' && <PlanoPage toast={push} status={status} />}
            {page === 'logs' && <LogsPage liveLog={liveLog} toast={push} />}
          </div>
        </main>
      </div>

      <div className="toast-wrap">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.tone}`}>
            {item.message}
          </div>
        ))}
      </div>
    </>
  );
}

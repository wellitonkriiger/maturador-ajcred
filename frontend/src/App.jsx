import { useEffect, useState } from 'react';
import { CheckCircle2, FileJson, LayoutDashboard, Logs, Phone, Settings2, TriangleAlert } from 'lucide-react';
import DashboardPage from './DashboardPage';
import TelefonesPage from './TelefonesPage';
import ConversasPage from './ConversasPage';
import PlanoPage from './PlanoPage';
import LogsPage from './LogsPage';
import { api, BACKEND_ROOT, POLL_INTERVAL, removeExecucao, upsertById, upsertExecucao, useSocketEvents, useToasts } from './lib';

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; }
  html, body, #root { width: 100%; height: 100%; min-height: 100%; }
  body { margin: 0; font-family: 'Montserrat', sans-serif; background:
    radial-gradient(circle at top right, rgba(255,106,0,.18), transparent 26%),
    radial-gradient(circle at bottom left, rgba(255,106,0,.1), transparent 24%),
    linear-gradient(180deg, #f7f7f7 0%, #ececec 100%);
    color: #1f2329;
    overflow: hidden;
  }
  .app { width: 100%; height: 100vh; font-size: 14px; }
  .sidebar { padding: 16px; border-right: 1px solid #d8dde3; background: rgba(255,255,255,.94); backdrop-filter: blur(14px); display: flex; flex-direction: column; gap: 14px; }
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: 248px;
    height: 100vh;
    overflow-y: auto;
    z-index: 5;
  }
  .brand {
    position: relative;
    background: linear-gradient(180deg, #ffffff 0%, #f7f7f7 100%);
    border: 1px solid #e2e5e9;
    border-radius: 22px;
    padding: 16px;
    overflow: hidden;
    box-shadow: 0 18px 38px rgba(20, 20, 20, .08);
  }
  .brand::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 4px;
    background: linear-gradient(90deg, #ff6a00, #ff9147, #ff6a00);
  }
  .brand-logo {
    width: 100%;
    max-width: 154px;
    height: auto;
    display: block;
    object-fit: contain;
  }
  .brand p { margin: 12px 0 0; font-size: 11px; color: #4f5560; text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
  .nav { display: grid; gap: 8px; }
  .nav button, .btn { display: inline-flex; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 13px; padding: 9px 12px; cursor: pointer; font: inherit; font-weight: 600; }
  .nav button { background: transparent; color: #5a6068; }
  .nav button.active, .nav button:hover { background: #ffffff; color: #1f2329; border-color: rgba(255,106,0,.22); box-shadow: inset 0 0 0 1px rgba(255,106,0,.08); }
  .status { margin-top: auto; padding: 12px 14px; border: 1px solid #d8dde3; border-radius: 16px; background: white; display: flex; align-items: center; gap: 10px; font-size: 13px; color: #5a6068; }
  .main {
    margin-left: 248px;
    padding: clamp(12px, 1.5vw, 24px);
    min-width: 0;
    width: calc(100vw - 248px);
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  .topbar h2, .section-head h3, .panel h3 { margin: 0; }
  .topbar h2 { font-size: clamp(20px, 1.8vw, 28px); }
  .section-head h3, .panel h3 { font-size: clamp(15px, 1.1vw, 18px); }
  .muted { color: #5a6068; }
  .chip { display: inline-flex; align-items: center; gap: 8px; padding: 9px 12px; border: 1px solid #d8dde3; border-radius: 999px; background: white; font-size: 12px; color: #5a6068; }
  .stack { display: grid; gap: 14px; }
  .compact { gap: 8px; }
  .grid { display: grid; gap: 14px; }
  .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .panel, .card { background: rgba(255,255,255,.94); border: 1px solid #d8dde3; border-radius: 20px; padding: clamp(14px, 1.2vw, 18px); box-shadow: 0 14px 34px rgba(20,20,20,.05); }
  .card.stat { display: grid; gap: 6px; }
  .card.stat strong { font-size: 24px; }
  .stats { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .section-head, .between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .small-gap { gap: 8px; }
  .list-card { border: 1px solid #e4e7eb; border-radius: 15px; padding: 12px; background: white; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .actions.end { justify-content: flex-end; }
  .btn.primary { background: linear-gradient(135deg, #ff6a00, #ff8a32); color: white; box-shadow: 0 12px 24px rgba(255,106,0,.2); }
  .btn.secondary { background: white; color: #1f2329; border-color: #d8dde3; }
  .btn.danger { background: #fff1f2; color: #b91c1c; border-color: #fecdd3; }
  .btn.sm { padding: 7px 9px; border-radius: 11px; font-size: 12px; }
  .btn:disabled { opacity: .6; cursor: not-allowed; }
  .label { display: grid; gap: 7px; font-size: 11px; font-weight: 700; color: #5a6068; text-transform: uppercase; letter-spacing: .08em; }
  .input, .textarea { width: 100%; padding: 10px 12px; border: 1px solid #d8dde3; border-radius: 13px; font: inherit; color: #1f2329; background: white; }
  .textarea { min-height: 240px; resize: vertical; font-family: 'IBM Plex Mono', monospace; font-size: 11px; }
  .check { display: flex; align-items: center; gap: 8px; color: #1f2329; font-size: 13px; }
  .badge, .pill { display: inline-flex; align-items: center; gap: 8px; padding: 5px 9px; border: 1px solid; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .pill { border-color: #d8dde3; background: #f7f7f7; color: #4a5059; }
  .dot { width: 9px; height: 9px; border-radius: 50%; }
  .mono { font-family: 'IBM Plex Mono', monospace; font-size: 10px; }
  .progress { width: 100%; height: 8px; border-radius: 999px; overflow: hidden; background: #eceff2; }
  .progress span { display: block; height: 100%; background: linear-gradient(135deg, #ff6a00, #ff8a32); }
  .empty { display: grid; gap: 10px; place-items: center; padding: 28px; border: 1px dashed #d8dde3; border-radius: 18px; color: #5a6068; }
  .table-wrap { overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 11px 9px; border-bottom: 1px solid #e6eaee; font-size: 12px; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #5a6068; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.4); display: grid; place-items: center; padding: 18px; z-index: 10; }
  .modal { width: min(760px, calc(100vw - 24px)); max-height: 90vh; overflow: auto; background: white; border-radius: 22px; padding: 18px; border: 1px solid #d8dde3; }
  .modal.small { width: min(420px, 100%); }
  .modal-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
  .code { margin: 10px 0 0; padding: 12px; border-radius: 14px; background: #f7f7f7; color: #4a5059; overflow: auto; font-family: 'IBM Plex Mono', monospace; font-size: 11px; }
  .center { justify-items: center; }
  .center-text { text-align: center; }
  .toast-wrap { position: fixed; right: 18px; bottom: 18px; display: grid; gap: 8px; z-index: 20; }
  .toast { min-width: 220px; max-width: 320px; padding: 11px 13px; color: white; border-radius: 15px; box-shadow: 0 16px 40px rgba(15,23,42,.16); font-size: 12px; }
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
      border-bottom: 1px solid #d8dde3;
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
    .chip { width: 100%; justify-content: center; }
    .nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .nav button { justify-content: center; }
    .panel, .card { border-radius: 18px; padding: 14px; }
  }
`;

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [backendOk, setBackendOk] = useState(null);
  const [telefones, setTelefones] = useState([]);
  const [status, setStatus] = useState(null);
  const [ativas, setAtivas] = useState([]);
  const [liveLog, setLiveLog] = useState(null);
  const { toasts, push } = useToasts();

  async function refreshSnapshot() {
    try {
      const [phoneList, maturacaoStatus, activeList] = await Promise.all([
        api('/telefones'),
        api('/maturacao/status'),
        api('/maturacao/conversas-ativas')
      ]);
      setTelefones(Array.isArray(phoneList) ? phoneList : []);
      setStatus(maturacaoStatus);
      setAtivas(Array.isArray(activeList) ? activeList : []);
      setBackendOk(true);
    } catch {
      setBackendOk(false);
    }
  }

  useEffect(() => {
    refreshSnapshot();
    const poll = window.setInterval(refreshSnapshot, POLL_INTERVAL);
    const health = window.setInterval(async () => {
      try {
        await fetch(`${BACKEND_ROOT}/health`);
        setBackendOk(true);
      } catch {
        setBackendOk(false);
      }
    }, 8000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(health);
    };
  }, []);

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
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'telefones', label: 'Telefones', icon: Phone },
    { id: 'conversas', label: 'Conversas', icon: FileJson },
    { id: 'plano', label: 'Plano', icon: Settings2 },
    { id: 'logs', label: 'Logs', icon: Logs }
  ];

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-logo" src="/logo.png" alt="AJCred" />
            <p>Loja de credito</p>
          </div>
          <nav className="nav">
            {nav.map((item) => {
              const Icon = item.icon;
              return <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><Icon size={17} />{item.label}</button>;
            })}
          </nav>
          <div className="status">
            {backendOk ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
            {backendOk === null ? 'verificando backend' : backendOk ? 'backend online' : 'backend offline'}
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <div>
              <h2>{nav.find((item) => item.id === page)?.label}</h2>
              <div className="muted">Atualizacao principal por Socket.IO com polling de ressincronizacao.</div>
            </div>
            <div className="chip">{new Date().toLocaleString('pt-BR')}</div>
          </div>

          {page === 'dashboard' && <DashboardPage telefones={telefones} status={status} ativas={ativas} toast={push} refreshSnapshot={refreshSnapshot} />}
          {page === 'telefones' && <TelefonesPage telefones={telefones} toast={push} refreshSnapshot={refreshSnapshot} />}
          {page === 'conversas' && <ConversasPage toast={push} />}
          {page === 'plano' && <PlanoPage toast={push} />}
          {page === 'logs' && <LogsPage liveLog={liveLog} toast={push} />}
        </main>
      </div>

      <div className="toast-wrap">
        {toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}>{item.message}</div>)}
      </div>
    </>
  );
}

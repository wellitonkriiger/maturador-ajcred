import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const API = "http://localhost:3001/api";
const POLL_INTERVAL = 4000;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function statusColor(s) {
  return { online: "#22c55e", conectando: "#f59e0b", erro: "#ef4444", offline: "#999" }[s] ?? "#999";
}

function sensibilidadeBadge(s) {
  const map = { alta: { label: "Alta", bg: "#fff1ec", color: "#FF7324", border: "#ffd4b8" }, media: { label: "Média", bg: "#fffbeb", color: "#d97706", border: "#fde68a" }, baixa: { label: "Baixa", bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0" } };
  return map[s] ?? map.baixa;
}

function timeAgo(iso) {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  if (m < 1440) return `${Math.floor(m / 60)}h atrás`;
  return `${Math.floor(m / 1440)}d atrás`;
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body, #root {
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  body {
    background: #f4f5f7;
    color: #1c1c28;
    font-family: 'Inter', sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: #f0f0f2; }
  ::-webkit-scrollbar-thumb { background: #e0d5cc; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #FF7324; }

  /* ── APP LAYOUT: sidebar + main, full viewport ── */
  .app {
    display: flex;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  /* ── SIDEBAR ── */
  .sidebar {
    width: 248px;
    min-width: 248px;
    height: 100vh;
    background: #ffffff;
    border-right: 1px solid #ececf0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    box-shadow: 2px 0 12px rgba(0,0,0,.04);
  }

  /* orange top accent stripe */
  .sidebar::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: linear-gradient(90deg, #FF7324 0%, #ffb380 50%, #FF7324 100%);
    background-size: 200% 100%;
    animation: shimmer 4s linear infinite;
    z-index: 1;
  }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .sidebar-logo {
    padding: 20px 22px 18px;
    border-bottom: 1px solid #f0f0f3;
    background: #1c1c1c;
    border-radius: 0;
  }

  .sidebar-logo img {
    width: 148px;
    object-fit: contain;
    filter: none;
  }

  .sidebar-logo .sub {
    font-size: 9.5px;
    color: #888;
    letter-spacing: .16em;
    text-transform: uppercase;
    font-weight: 600;
    margin-top: 8px;
  }

  .nav-section {
    padding: 20px 18px 6px;
    font-size: 9px;
    letter-spacing: .2em;
    color: #c8c8d8;
    text-transform: uppercase;
    font-weight: 700;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    margin: 2px 10px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 13.5px;
    color: #8888a0;
    transition: all .16s;
    font-weight: 400;
    border: 1px solid transparent;
    position: relative;
    user-select: none;
  }

  .nav-item:hover {
    background: #fdf5f0;
    color: #FF7324;
  }

  .nav-item.active {
    background: linear-gradient(135deg, #fff3ec 0%, #fff8f4 100%);
    color: #FF7324;
    border-color: rgba(255,115,36,.18);
    font-weight: 600;
  }

  /* left accent bar on active item */
  .nav-item.active::before {
    content: '';
    position: absolute;
    left: -10px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 55%;
    background: linear-gradient(180deg, #FF7324, #ffb380);
    border-radius: 0 3px 3px 0;
  }

  .nav-item .icon { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }

  .sidebar-status {
    margin-top: auto;
    padding: 14px 16px;
    border-top: 1px solid #f0f0f3;
  }

  .sys-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 13px;
    background: #fafafa;
    border-radius: 10px;
    font-size: 11.5px;
    color: #aaa;
    border: 1px solid #ececf0;
  }

  .sys-pill .dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-pulse { animation: pulse 1.8s ease-in-out infinite; }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: .45; transform: scale(.8); }
  }

  /* ── MAIN AREA ── */
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: #f4f5f7;
    min-width: 0;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 36px;
    height: 60px;
    min-height: 60px;
    flex-shrink: 0;
    background: #ffffff;
    border-bottom: 1px solid #ececf0;
    box-shadow: 0 1px 6px rgba(0,0,0,.05);
  }

  .page-title {
    font-size: 15px;
    font-weight: 700;
    color: #1c1c28;
    letter-spacing: -.02em;
  }

  .topbar-actions { display: flex; gap: 10px; align-items: center; }

  .topbar-time {
    font-size: 12px;
    color: #b0b0be;
    font-family: 'Space Mono', monospace;
    background: #f8f8fb;
    padding: 5px 11px;
    border-radius: 7px;
    border: 1px solid #ececf0;
  }

  /* scrollable content area */
  .content {
    flex: 1;
    padding: 26px 36px;
    overflow-y: auto;
    min-height: 0;
  }

  /* ── CARDS ── */
  .card {
    background: #ffffff;
    border: 1px solid #ececf0;
    border-radius: 14px;
    padding: 22px;
    position: relative;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0,0,0,.04);
    transition: box-shadow .2s;
  }

  /* subtle top-left orange glow on hover */
  .card::after {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2.5px;
    background: linear-gradient(90deg, #FF7324 0%, rgba(255,115,36,0) 60%);
    opacity: 0;
    transition: opacity .2s;
  }
  .card:hover::after { opacity: 1; }
  .card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.07); }

  .card-title {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: .14em;
    color: #c0c0cc;
    font-weight: 700;
    margin-bottom: 14px;
  }

  /* ── GRID ── */
  .grid   { display: grid; gap: 18px; }
  .grid-4 { grid-template-columns: repeat(4, 1fr); }
  .grid-3 { grid-template-columns: repeat(3, 1fr); }
  .grid-2 { grid-template-columns: repeat(2, 1fr); }

  /* ── STAT CARD ── */
  .stat-val {
    font-family: 'Space Mono', monospace;
    font-size: 36px;
    font-weight: 700;
    color: #1c1c28;
    line-height: 1;
    margin-bottom: 6px;
  }
  .stat-label { font-size: 12px; color: #b0b0be; }
  .stat-accent { color: #FF7324; }

  /* ── BUTTONS ── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 18px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all .15s;
    font-family: 'Inter', sans-serif;
    letter-spacing: -.01em;
    white-space: nowrap;
  }

  .btn-primary {
    background: linear-gradient(135deg, #FF7324 0%, #ff9550 100%);
    color: #fff;
    border-color: #e8621a;
    box-shadow: 0 2px 10px rgba(255,115,36,.28);
  }
  .btn-primary:hover {
    background: linear-gradient(135deg, #e8621a 0%, #FF7324 100%);
    box-shadow: 0 4px 14px rgba(255,115,36,.38);
    transform: translateY(-1px);
  }

  .btn-success {
    background: #f0faf3;
    color: #16a34a;
    border-color: #c6f0d4;
  }
  .btn-success:hover { background: #dcfce7; }

  .btn-danger {
    background: #fff5f5;
    color: #dc2626;
    border-color: #fecaca;
  }
  .btn-danger:hover { background: #fee2e2; }

  .btn-ghost {
    background: transparent;
    color: #888;
    border-color: #e4e4ec;
  }
  .btn-ghost:hover { background: #f5f5f8; color: #444; }

  .btn-sm { padding: 5px 12px; font-size: 11.5px; border-radius: 8px; }

  .btn:disabled { opacity: .38; cursor: not-allowed; transform: none !important; box-shadow: none !important; }

  /* ── BADGE ── */
  .badge {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 20px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
    border: 1px solid transparent;
  }

  /* ── STATUS DOT ── */
  .status-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }

  /* ── TABLE ── */
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    padding: 10px 14px;
    text-align: left;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: #c0c0cc;
    font-weight: 700;
    border-bottom: 2px solid #f0f0f4;
    background: #fafafa;
  }
  td {
    padding: 12px 14px;
    border-bottom: 1px solid #f4f4f8;
    color: #606070;
    vertical-align: middle;
  }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fdf7f3; }

  /* ── PROGRESS ── */
  .progress { height: 5px; background: #f0f0f4; border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 3px; transition: width .45s cubic-bezier(.4,0,.2,1); }

  /* ── FORM ── */
  .form-group { margin-bottom: 16px; }
  .form-label {
    display: block;
    font-size: 10.5px;
    color: #a0a0b8;
    margin-bottom: 6px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .1em;
  }
  .form-input {
    width: 100%;
    background: #fafafa;
    border: 1.5px solid #e8e8f0;
    border-radius: 10px;
    padding: 9px 13px;
    color: #1c1c28;
    font-size: 13.5px;
    font-family: 'Inter', sans-serif;
    transition: border-color .15s, box-shadow .15s;
    outline: none;
  }
  .form-input:focus {
    border-color: #FF7324;
    box-shadow: 0 0 0 3px rgba(255,115,36,.1);
    background: #fff;
  }
  .form-input::placeholder { color: #d0d0dc; }

  .form-select {
    width: 100%;
    background: #fafafa;
    border: 1.5px solid #e8e8f0;
    border-radius: 10px;
    padding: 9px 13px;
    color: #1c1c28;
    font-size: 13.5px;
    font-family: 'Inter', sans-serif;
    outline: none;
    cursor: pointer;
  }
  .form-select:focus { border-color: #FF7324; box-shadow: 0 0 0 3px rgba(255,115,36,.1); }

  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .range-pair { display: grid; grid-template-columns: 1fr 28px 1fr; gap: 6px; align-items: center; }
  .range-sep { text-align: center; color: #ccc; font-size: 12px; }

  /* ── TOGGLE ── */
  .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f4f4f8; }
  .toggle-row:last-child { border-bottom: none; }
  .toggle-label { font-size: 13px; color: #404050; font-weight: 500; }
  .toggle-desc { font-size: 11px; color: #b8b8c8; margin-top: 2px; }
  .toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; inset: 0;
    background: #e4e4ec;
    border-radius: 22px;
    cursor: pointer;
    transition: .2s;
  }
  .toggle-slider::after {
    content: '';
    position: absolute;
    width: 16px; height: 16px;
    left: 3px; top: 3px;
    background: #fff;
    border-radius: 50%;
    transition: .2s;
    box-shadow: 0 1px 4px rgba(0,0,0,.18);
  }
  .toggle input:checked + .toggle-slider { background: linear-gradient(135deg, #FF7324, #ff9550); }
  .toggle input:checked + .toggle-slider::after { transform: translateX(18px); }

  /* ── PHONE CARD ── */
  .phone-card {
    background: #fff;
    border: 1.5px solid #ececf0;
    border-radius: 14px;
    padding: 20px;
    transition: all .2s;
    box-shadow: 0 1px 4px rgba(0,0,0,.04);
  }
  .phone-card:hover {
    border-color: rgba(255,115,36,.3);
    box-shadow: 0 6px 20px rgba(255,115,36,.09);
    transform: translateY(-2px);
  }
  .phone-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
  .phone-name { font-size: 14px; font-weight: 700; color: #1c1c28; }
  .phone-id { font-family: 'Space Mono', monospace; font-size: 10px; color: #c8c8d8; margin-top: 2px; }

  /* ── MODAL ── */
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(28,28,40,.38);
    display: flex; align-items: center; justify-content: center;
    z-index: 100;
    backdrop-filter: blur(7px);
  }
  .modal {
    background: #fff;
    border: 1px solid #e8e8f0;
    border-radius: 20px;
    padding: 32px;
    width: 490px;
    max-width: 96vw;
    max-height: 88vh;
    overflow-y: auto;
    position: relative;
    box-shadow: 0 28px 70px rgba(0,0,0,.14);
  }
  .modal-title { font-size: 16px; font-weight: 700; color: #1c1c28; margin-bottom: 24px; }
  .modal-close {
    position: absolute; top: 24px; right: 24px;
    background: #f5f5f8; border: none; color: #999;
    cursor: pointer; font-size: 14px;
    width: 30px; height: 30px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    transition: background .15s;
  }
  .modal-close:hover { background: #ebebef; color: #444; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }

  /* ── LOG ── */
  .log-entry {
    display: flex; gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid #f4f4f8;
    font-size: 12.5px;
    align-items: flex-start;
  }
  .log-entry:last-child { border-bottom: none; }
  .log-time { font-family: 'Space Mono', monospace; font-size: 10px; color: #c8c8d8; flex-shrink: 0; margin-top: 1px; width: 58px; }
  .log-icon { flex-shrink: 0; }
  .log-body { flex: 1; }
  .log-msg { color: #606070; }
  .log-detail { font-size: 11px; color: #c0c0cc; margin-top: 2px; }

  /* ── CONVERSA ATIVA ── */
  .conv-active {
    background: linear-gradient(135deg, #fff8f4 0%, #fff 100%);
    border: 1.5px solid rgba(255,115,36,.18);
    border-radius: 12px;
    padding: 14px;
    margin-bottom: 10px;
  }
  .conv-active-title { font-size: 13px; color: #1c1c28; font-weight: 600; margin-bottom: 8px; }
  .conv-participants { font-size: 11px; color: #b0b0be; margin-bottom: 10px; }

  /* ── EMPTY STATE ── */
  .empty { text-align: center; padding: 52px 24px; }
  .empty-icon { font-size: 38px; margin-bottom: 14px; }
  .empty-text { font-size: 14px; color: #b8b8c8; }
  .empty-sub { font-size: 12px; color: #d0d0dc; margin-top: 4px; }

  /* ── TOAST ── */
  .toast-container { position: fixed; bottom: 26px; right: 26px; z-index: 200; display: flex; flex-direction: column; gap: 9px; }
  .toast {
    background: #fff;
    border: 1px solid #ececf0;
    border-radius: 12px;
    padding: 12px 17px;
    font-size: 13px;
    color: #606070;
    max-width: 310px;
    animation: slideIn .22s ease;
    box-shadow: 0 8px 28px rgba(0,0,0,.1);
  }
  .toast.success { border-left: 3px solid #22c55e; color: #16a34a; }
  .toast.error   { border-left: 3px solid #ef4444; color: #dc2626; }
  @keyframes slideIn { from { transform: translateX(18px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

  /* ── QR ── */
  .qr-container { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 16px; }
  .qr-img { background: white; padding: 14px; border-radius: 12px; box-shadow: 0 4px 18px rgba(0,0,0,.08); border: 1px solid #ececf0; }
  .qr-hint { font-size: 12px; color: #b0b0be; text-align: center; line-height: 1.6; }

  /* ── DIAS SEMANA ── */
  .dias-semana { display: flex; gap: 7px; flex-wrap: wrap; }
  .dia-btn {
    width: 40px; height: 40px;
    border-radius: 10px;
    border: 1.5px solid #e8e8f0;
    background: #fafafa;
    color: #b0b0be;
    font-size: 11px;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    font-weight: 700;
    transition: all .15s;
  }
  .dia-btn:hover { border-color: rgba(255,115,36,.4); color: #FF7324; background: #fff8f4; }
  .dia-btn.ativo {
    background: linear-gradient(135deg, #FF7324, #ff9550);
    color: #fff;
    border-color: #e8621a;
    box-shadow: 0 2px 8px rgba(255,115,36,.3);
  }

  /* ── SECTION HEADER ── */
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
  .section-title { font-size: 17px; font-weight: 700; color: #1c1c28; letter-spacing: -.03em; }

  /* ── INFO ROWS ── */
  .info-row { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #f4f4f8; font-size: 13px; }
  .info-row:last-child { border-bottom: none; }
  .info-key { color: #b0b0be; }
  .info-val { color: #404050; font-weight: 600; font-family: 'Space Mono', monospace; font-size: 11.5px; }

  /* ── MATURACAO STATUS BAR ── */
  .maturacao-status {
    display: flex; align-items: center; gap: 16px;
    padding: 16px 22px;
    background: #fff;
    border-radius: 14px;
    border: 1.5px solid #ececf0;
    margin-bottom: 22px;
    box-shadow: 0 1px 4px rgba(0,0,0,.04);
    transition: all .2s;
  }
  .maturacao-status.ativo {
    background: linear-gradient(135deg, #fff9f5 0%, #fff 100%);
    border-color: rgba(255,115,36,.25);
    box-shadow: 0 2px 14px rgba(255,115,36,.08);
  }

  /* ── SCROLLABLE ── */
  .scrollable { max-height: 400px; overflow-y: auto; padding-right: 4px; }

  /* ── TAGS ── */
  .tag {
    display: inline-block;
    padding: 3px 9px;
    background: #f5f5f8;
    border-radius: 6px;
    font-size: 10.5px;
    color: #9898a8;
    margin: 2px;
    border: 1px solid #ebebf0;
  }
`;

// ─── TOAST ────────────────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);
  return { toasts, toast };
}

// ─── SECTION: DASHBOARD ───────────────────────────────────────────────────────
function Dashboard({ toast }) {
  const [status, setStatus] = useState(null);
  const [ativas, setAtivas] = useState([]);
  const [telefones, setTelefones] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, a, t] = await Promise.all([
        api("/maturacao/status"),
        api("/maturacao/conversas-ativas"),
        api("/telefones"),
      ]);
      setStatus(s);
      setAtivas(Array.isArray(a) ? a : []);
      setTelefones(Array.isArray(t) ? t : []);
    } catch {
      /* offline */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [load]);

  const toggleMaturacao = async () => {
    try {
      if (status?.ativo) {
        await api("/maturacao/parar", { method: "POST" });
        toast("Maturação pausada", "success");
      } else {
        await api("/maturacao/iniciar", { method: "POST" });
        toast("Maturação iniciada", "success");
      }
      await load();
    } catch (e) {
      toast("Erro ao alterar estado: " + e.message, "error");
    }
  };

  const online = telefones.filter(t => t.status === "online").length;
  const totalConversasHoje = telefones.reduce((s, t) => s + (t.configuracao?.conversasRealizadasHoje ?? 0), 0);
  const metaDia = telefones.reduce((s, t) => s + (t.configuracao?.quantidadeConversasDia ?? 0), 0);

  return (
    <div>
      <div className={`maturacao-status ${status?.ativo ? "ativo" : ""}`}>
        <div className="dot" style={{ width: 10, height: 10, borderRadius: "50%", background: status?.ativo ? "#22c55e" : "#888", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: status?.ativo ? "#22c55e" : "#999" }}>
            {status?.ativo ? "Sistema Ativo" : "Sistema Pausado"}
          </div>
          {status?.proximaConversa && (
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
              Próxima conversa em ~{status.proximaConversa}
            </div>
          )}
        </div>
        <button
          className={`btn btn-sm ${status?.ativo ? "btn-danger" : "btn-success"}`}
          onClick={toggleMaturacao}
        >
          {status?.ativo ? "⏸ Pausar" : "▶ Iniciar"}
        </button>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-title">Telefones Online</div>
          <div className="stat-val stat-accent">{loading ? "—" : online}</div>
          <div className="stat-label">de {telefones.length} cadastrados</div>
        </div>
        <div className="card">
          <div className="card-title">Conversas Hoje</div>
          <div className="stat-val">{loading ? "—" : totalConversasHoje}</div>
          <div className="stat-label">meta: {metaDia}</div>
        </div>
        <div className="card">
          <div className="card-title">Conversas Ativas</div>
          <div className="stat-val">{loading ? "—" : ativas.length}</div>
          <div className="stat-label">em andamento agora</div>
        </div>
        <div className="card">
          <div className="card-title">Status</div>
          <div className="stat-val" style={{ fontSize: 20, marginTop: 4 }}>
            {status?.ativo ? "🟢" : "⚫"}
          </div>
          <div className="stat-label">{status?.ativo ? "maturando" : "inativo"}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Telefones</div>
          <div className="scrollable">
            {loading ? (
              <div className="empty"><div className="empty-text">Carregando...</div></div>
            ) : telefones.length === 0 ? (
              <div className="empty"><div className="empty-icon">📱</div><div className="empty-text">Nenhum telefone</div></div>
            ) : telefones.map(tel => (
              <div key={tel.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #0a1628" }}>
                <div className="dot" style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(tel.status), flexShrink: 0, ...(tel.status === "online" ? { animation: "pulse 1.8s infinite" } : {}) }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#1a1a2e" }}>{tel.nome}</div>
                  <div style={{ fontSize: 10, color: "#aaa", fontFamily: "Space Mono" }}>{tel.id}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "#999" }}>
                    {tel.configuracao?.conversasRealizadasHoje ?? 0}/{tel.configuracao?.quantidadeConversasDia ?? 0}
                  </div>
                  <div style={{ marginTop: 4, width: 60 }}>
                    <div className="progress">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${Math.min(100, ((tel.configuracao?.conversasRealizadasHoje ?? 0) / (tel.configuracao?.quantidadeConversasDia || 1)) * 100)}%`,
                          background: "#FF7324"
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Conversas Ativas</div>
          {loading ? (
            <div className="empty"><div className="empty-text">Carregando...</div></div>
          ) : ativas.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">💬</div>
              <div className="empty-text">Nenhuma conversa ativa</div>
              <div className="empty-sub">O sistema iniciará automaticamente</div>
            </div>
          ) : ativas.map((c, i) => (
            <div key={i} className="conv-active">
              <div className="conv-active-title">{c.conversaNome || c.conversaId}</div>
              <div className="conv-participants">
                {(c.participantes || []).join(" ↔ ")}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888" }}>
                <span>Msg {c.mensagemAtual || 0}/{c.totalMensagens || "?"}</span>
                <span>iniciou {timeAgo(c.iniciouEm)}</span>
              </div>
              <div className="progress" style={{ marginTop: 8 }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${c.totalMensagens ? Math.min(100, (c.mensagemAtual / c.totalMensagens) * 100) : 0}%`,
                    background: "#22c55e"
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SECTION: TELEFONES ───────────────────────────────────────────────────────
function Telefones({ toast }) {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showQR, setShowQR] = useState(null);          // { id, qrCode, nome }
  const [aguardandoQR, setAguardandoQR] = useState(null); // id aguardando
  const pollRef = useRef(null);
  const [form, setForm] = useState({
    nome: "",
    sensibilidade: "media",
    quantidadeConversasDia: 5,
    podeIniciarConversa: true,
    podeReceberMensagens: true,
  });

  const load = useCallback(async () => {
    try {
      const t = await api("/telefones");
      setLista(Array.isArray(t) ? t : []);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const criar = async () => {
    try {
      await api("/telefones", {
        method: "POST",
        body: JSON.stringify({
          nome: form.nome,
          sensibilidade: form.sensibilidade,
          quantidadeConversasDia: Number(form.quantidadeConversasDia),
          podeIniciarConversa: form.podeIniciarConversa,
          podeReceberMensagens: form.podeReceberMensagens,
        }),
      });
      toast("Telefone criado!", "success");
      setShowModal(false);
      setForm({ nome: "", sensibilidade: "media", quantidadeConversasDia: 5, podeIniciarConversa: true, podeReceberMensagens: true });
      await load();
    } catch (e) { toast("Erro: " + e.message, "error"); }
  };

  const iniciarPollQR = (id, nome) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setAguardandoQR(id);
    let attempts = 0;
    const MAX = 30; // 30 × 3s = 90s

    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        // Usa fetch direto pra não lançar exceção em 404
        const res = await fetch(`${API}/telefones/${id}/qrcode`);
        if (res.ok) {
          const data = await res.json();
          if (data?.qrCode) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setAguardandoQR(null);
            setShowQR({ id, qrCode: data.qrCode, nome });
            return;
          }
        }
        // 404 = ainda inicializando, continua esperando silenciosamente
      } catch { /* sem conexão, tenta novamente */ }

      if (attempts >= MAX) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setAguardandoQR(null);
        toast("Tempo esgotado aguardando QR Code. Tente conectar novamente.", "error");
      }
    }, 3000);
  };

  const conectar = async (id) => {
    const tel = lista.find(t => t.id === id);
    try {
      await api(`/telefones/${id}/conectar`, { method: "POST" });
      toast("WhatsApp inicializando... QR Code aparecerá em instantes", "success");
      await load();
      iniciarPollQR(id, tel?.nome ?? id);
    } catch (e) { toast("Erro ao conectar: " + e.message, "error"); }
  };

  const verQRManual = async (id) => {
    if (aguardandoQR === id) return; // já aguardando, nada a fazer
    const tel = lista.find(t => t.id === id);
    try {
      const res = await fetch(`${API}/telefones/${id}/qrcode`);
      if (res.ok) {
        const data = await res.json();
        if (data?.qrCode) {
          setShowQR({ id, qrCode: data.qrCode, nome: tel?.nome ?? id });
          return;
        }
      }
    } catch { /* ignora */ }
    toast("QR ainda não disponível, aguardando...", "info");
    iniciarPollQR(id, tel?.nome ?? id);
  };

  const cancelarAguardo = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setAguardandoQR(null);
  };

  const desconectar = async (id) => {
    try {
      await api(`/telefones/${id}/desconectar`, { method: "POST" });
      toast("Desconectado", "success");
      await load();
    } catch (e) { toast("Erro: " + e.message, "error"); }
  };

  const deletar = async (id) => {
    if (!confirm("Deletar telefone?")) return;
    try {
      await api(`/telefones/${id}`, { method: "DELETE" });
      toast("Telefone deletado", "success");
      await load();
    } catch (e) { toast("Erro: " + e.message, "error"); }
  };

  const sb = sensibilidadeBadge;

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Gerenciar Telefones</div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Adicionar Telefone</button>
      </div>

      {loading ? (
        <div className="empty"><div className="empty-text">Carregando...</div></div>
      ) : lista.length === 0 ? (
        <div className="empty" style={{ marginTop: 48 }}>
          <div className="empty-icon">📱</div>
          <div className="empty-text">Nenhum telefone cadastrado</div>
          <div className="empty-sub">Adicione um telefone para começar</div>
        </div>
      ) : (
        <div className="grid grid-2">
          {lista.map(tel => {
            const sens = sb(tel.sensibilidade);
            const progresso = Math.min(100, ((tel.configuracao?.conversasRealizadasHoje ?? 0) / (tel.configuracao?.quantidadeConversasDia || 1)) * 100);
            const esteAguardando = aguardandoQR === tel.id;
            return (
              <div key={tel.id} className="phone-card">
                <div className="phone-header">
                  <div>
                    <div className="phone-name">{tel.nome}</div>
                    <div className="phone-id">{tel.id}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <div className="status-row">
                      <div className="dot" style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor(tel.status), ...(tel.status === "conectando" || esteAguardando ? { animation: "pulse 1s infinite" } : {}) }} />
                      <span style={{ fontSize: 11, color: "#999", textTransform: "capitalize" }}>
                        {esteAguardando ? "aguardando QR..." : tel.status}
                      </span>
                    </div>
                    <span className="badge" style={{ background: sens.bg, color: sens.color, border: `1px solid ${sens.border}` }}>{sens.label}</span>
                  </div>
                </div>

                {/* Banner de aguardando QR */}
                {esteAguardando && (
                  <div style={{
                    background: "linear-gradient(135deg, #fff9f5, #fff3ec)",
                    border: "1.5px solid rgba(255,115,36,.25)",
                    borderRadius: 10,
                    padding: "12px 14px",
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}>
                    <div style={{ fontSize: 18 }}>⏳</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#FF7324" }}>Inicializando WhatsApp...</div>
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>O QR Code abrirá automaticamente</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={cancelarAguardo} style={{ fontSize: 10, padding: "3px 8px" }}>Cancelar</button>
                  </div>
                )}

                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginBottom: 6 }}>
                    <span>Conversas hoje</span>
                    <span>{tel.configuracao?.conversasRealizadasHoje ?? 0} / {tel.configuracao?.quantidadeConversasDia ?? 0}</span>
                  </div>
                  <div className="progress">
                    <div className="progress-fill" style={{ width: `${progresso}%`, background: progresso >= 100 ? "#22c55e" : "#FF7324" }} />
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div className="info-row">
                    <span className="info-key">Número</span>
                    <span className="info-val">{tel.numero ?? "—"}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-key">Total conversas</span>
                    <span className="info-val">{tel.estatisticas?.totalConversas ?? 0}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-key">Msgs enviadas</span>
                    <span className="info-val">{tel.estatisticas?.totalMensagensEnviadas ?? 0}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-key">Pode iniciar</span>
                    <span className="info-val">{tel.configuracao?.podeIniciarConversa ? "sim" : "não"}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-key">Pode receber</span>
                    <span className="info-val">{tel.configuracao?.podeReceberMensagens ? "sim" : "não"}</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {tel.status === "offline" || tel.status === "erro" ? (
                    <button className="btn btn-success btn-sm" onClick={() => conectar(tel.id)} disabled={esteAguardando}>
                      ⚡ Conectar
                    </button>
                  ) : tel.status === "online" ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => desconectar(tel.id)}>Desconectar</button>
                  ) : (
                    // status = conectando
                    <button className="btn btn-primary btn-sm" onClick={() => verQRManual(tel.id)} disabled={esteAguardando}>
                      {esteAguardando ? "⏳ Aguardando..." : "📷 Ver QR Code"}
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => deletar(tel.id)}>Deletar</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL CRIAR */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-title">Adicionar Telefone</div>
            <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>

            <div className="form-group">
              <label className="form-label">Nome / Identificador *</label>
              <input className="form-input" placeholder="Ex: Telefone Loja 1" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Sensibilidade</label>
                <select className="form-select" value={form.sensibilidade} onChange={e => setForm(f => ({ ...f, sensibilidade: e.target.value }))}>
                  <option value="baixa">Baixa</option>
                  <option value="media">Média</option>
                  <option value="alta">Alta</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Conversas / dia</label>
                <input className="form-input" type="number" min={1} max={50} value={form.quantidadeConversasDia} onChange={e => setForm(f => ({ ...f, quantidadeConversasDia: e.target.value }))} />
              </div>
            </div>

            <div className="toggle-row">
              <div><div className="toggle-label">Pode iniciar conversa</div></div>
              <label className="toggle">
                <input type="checkbox" checked={form.podeIniciarConversa} onChange={e => setForm(f => ({ ...f, podeIniciarConversa: e.target.checked }))} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="toggle-row">
              <div><div className="toggle-label">Pode receber mensagens</div></div>
              <label className="toggle">
                <input type="checkbox" checked={form.podeReceberMensagens} onChange={e => setForm(f => ({ ...f, podeReceberMensagens: e.target.checked }))} />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={criar} disabled={!form.nome.trim()}>Criar Telefone</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL QR */}
      {showQR && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowQR(null)}>
          <div className="modal" style={{ width: 360, textAlign: "center" }}>
            <div className="modal-title">📱 {showQR.nome}</div>
            <button className="modal-close" onClick={() => setShowQR(null)}>✕</button>
            <div className="qr-container">
              <div className="qr-img">
                <img src={showQR.qrCode} alt="QR Code" style={{ width: 230, height: 230 }} />
              </div>
              <div className="qr-hint">
                Abra o WhatsApp no celular<br />
                <strong>Dispositivos vinculados → Vincular dispositivo</strong><br />
                <span style={{ color: "#f59e0b", fontSize: 11, marginTop: 4, display: "block" }}>⚠️ O QR expira em ~20 segundos</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SECTION: CONVERSAS ───────────────────────────────────────────────────────
function Conversas({ toast }) {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [detalhe, setDetalhe] = useState(null);

  const load = useCallback(async () => {
    try {
      const c = await api("/conversas");
      setLista(Array.isArray(c) ? c : []);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deletar = async (id) => {
    if (!confirm("Deletar conversa?")) return;
    try {
      await api(`/conversas/${id}`, { method: "DELETE" });
      toast("Conversa deletada", "success");
      await load();
    } catch (e) { toast("Erro: " + e.message, "error"); }
  };

  const recarregar = async () => {
    try {
      await api("/conversas/recarregar", { method: "POST" });
      toast("Conversas recarregadas", "success");
      await load();
    } catch (e) { toast("Erro: " + e.message, "error"); }
  };

  const filtradas = lista.filter(c =>
    !busca || c.nome?.toLowerCase().includes(busca.toLowerCase()) || c.categoria?.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Gerenciar Conversas</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={recarregar}>↻ Recarregar</button>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <input className="form-input" placeholder="🔍 Buscar conversa..." value={busca} onChange={e => setBusca(e.target.value)} style={{ maxWidth: 300 }} />
      </div>

      {loading ? (
        <div className="empty"><div className="empty-text">Carregando...</div></div>
      ) : filtradas.length === 0 ? (
        <div className="empty" style={{ marginTop: 48 }}>
          <div className="empty-icon">💬</div>
          <div className="empty-text">{busca ? "Nenhum resultado" : "Nenhuma conversa cadastrada"}</div>
          <div className="empty-sub">Adicione arquivos JSON em /data/conversas/ e recarregue</div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Categoria</th>
                  <th>Participantes</th>
                  <th>Mensagens</th>
                  <th>Usos</th>
                  <th>Último uso</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ color: "#1a1a2e", fontWeight: 500 }}>{c.nome}</div>
                      <div style={{ fontSize: 10, color: "#aaa", fontFamily: "Space Mono" }}>{c.id}</div>
                    </td>
                    <td>
                      <span className="badge" style={{ background: "#f5f5f5", color: "#999" }}>{c.categoria || "—"}</span>
                    </td>
                    <td style={{ fontFamily: "Space Mono", fontSize: 11 }}>
                      {c.participantesMinimos ?? "?"}-{c.participantesMaximos ?? "?"}
                    </td>
                    <td style={{ fontFamily: "Space Mono", fontSize: 12 }}>{c.mensagens?.length ?? "?"}</td>
                    <td style={{ fontFamily: "Space Mono", fontSize: 12 }}>{c.metadados?.vezesUsada ?? 0}</td>
                    <td style={{ fontSize: 11 }}>{timeAgo(c.metadados?.ultimoUso)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetalhe(c)}>Ver</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deletar(c.id)}>Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL DETALHE */}
      {detalhe && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDetalhe(null)}>
          <div className="modal" style={{ width: 560 }}>
            <div className="modal-title">{detalhe.nome}</div>
            <button className="modal-close" onClick={() => setDetalhe(null)}>✕</button>

            <div style={{ marginBottom: 14 }}>
              {(detalhe.tags ?? []).map(tag => <span key={tag} className="tag">{tag}</span>)}
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <div className="info-row"><span className="info-key">ID</span><span className="info-val">{detalhe.id}</span></div>
              <div className="info-row"><span className="info-key">Categoria</span><span className="info-val">{detalhe.categoria}</span></div>
              <div className="info-row"><span className="info-key">Participantes</span><span className="info-val">{detalhe.participantesMinimos}-{detalhe.participantesMaximos}</span></div>
              <div className="info-row"><span className="info-key">Duração est.</span><span className="info-val">{detalhe["duracao estimada"] ?? detalhe.duracaoEstimada ?? "—"}</span></div>
              <div className="info-row"><span className="info-key">Vezes usada</span><span className="info-val">{detalhe.metadados?.vezesUsada ?? 0}</span></div>
            </div>

            <div style={{ fontSize: 11, color: "#999", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".08em" }}>Mensagens ({detalhe.mensagens?.length ?? 0})</div>
            <div className="scrollable">
              {(detalhe.mensagens ?? []).map((m, i) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #0a1628", fontSize: 12 }}>
                  {m.tipo === "pausa_longa" ? (
                    <span style={{ color: "#888", fontStyle: "italic" }}>⏸ Pausa longa: {m.duracao?.min}-{m.duracao?.max}s</span>
                  ) : (
                    <>
                      <span style={{ color: "#aaa", fontFamily: "Space Mono", fontSize: 10 }}>#{m.ordem} rem:{m.remetente}</span>
                      <div style={{ color: "#555", marginTop: 3 }}>{m.texto}</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SECTION: PLANO ───────────────────────────────────────────────────────────
function PlanoMaturacao({ toast }) {
  const [plano, setPlano] = useState(null);
  const [saving, setSaving] = useState(false);
  const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const load = useCallback(async () => {
    try {
      const p = await api("/maturacao/plano");
      setPlano(p);
    } catch { /* offline */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const salvar = async () => {
    setSaving(true);
    try {
      await api("/maturacao/plano", { method: "PUT", body: JSON.stringify(plano) });
      toast("Plano salvo!", "success");
    } catch (e) { toast("Erro: " + e.message, "error"); }
    finally { setSaving(false); }
  };

  const upd = (path, value) => {
    setPlano(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const toggleDia = (d) => {
    if (!plano) return;
    const dias = [...(plano.horarioFuncionamento?.diasSemana ?? [])];
    const idx = dias.indexOf(d);
    if (idx >= 0) dias.splice(idx, 1); else dias.push(d);
    upd("horarioFuncionamento.diasSemana", dias.sort((a, b) => a - b));
  };

  if (!plano) return <div className="empty"><div className="empty-text">Carregando plano...</div></div>;

  const dias = plano.horarioFuncionamento?.diasSemana ?? [];

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Plano de Maturação</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge" style={{ background: plano.ativo ? "#052e16" : "#1e293b", color: plano.ativo ? "#22c55e" : "#999" }}>
            {plano.ativo ? "Ativo" : "Inativo"}
          </span>
          <button className="btn btn-primary btn-sm" onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : "💾 Salvar"}
          </button>
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 16 }}>
        {/* Horário */}
        <div className="card">
          <div className="card-title">⏰ Horário de Funcionamento</div>
          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Início</label>
              <input className="form-input" type="time" value={plano.horarioFuncionamento?.inicio ?? "08:00"} onChange={e => upd("horarioFuncionamento.inicio", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Fim</label>
              <input className="form-input" type="time" value={plano.horarioFuncionamento?.fim ?? "22:00"} onChange={e => upd("horarioFuncionamento.fim", e.target.value)} />
            </div>
          </div>
          <div className="form-label" style={{ marginBottom: 8 }}>Dias da Semana</div>
          <div className="dias-semana">
            {DIAS.map((d, i) => (
              <button key={i} className={`dia-btn ${dias.includes(i) ? "ativo" : ""}`} onClick={() => toggleDia(i)}>{d}</button>
            ))}
          </div>
        </div>

        {/* Metas */}
        <div className="card">
          <div className="card-title">📊 Metas</div>
          <div className="form-group">
            <label className="form-label">Conversas por telefone / dia</label>
            <input className="form-input" type="number" min={1} value={plano.metas?.conversasPorTelefoneDia ?? 5} onChange={e => upd("metas.conversasPorTelefoneDia", Number(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">Total conversas / dia</label>
            <input className="form-input" type="number" min={1} value={plano.metas?.totalConversasDia ?? 25} onChange={e => upd("metas.totalConversasDia", Number(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">Duração do plano</label>
            <input className="form-input" value={plano.metas?.duracaoPlano ?? "30 dias"} onChange={e => upd("metas.duracaoPlano", e.target.value)} />
          </div>
        </div>

        {/* Intervalos */}
        <div className="card">
          <div className="card-title">⏱️ Intervalos Globais</div>

          <div className="form-label" style={{ marginBottom: 6 }}>Entre conversas (seg)</div>
          <div className="range-pair" style={{ marginBottom: 14 }}>
            <input className="form-input" type="number" value={plano.intervalosGlobais?.entreConversas?.min ?? 1800} onChange={e => upd("intervalosGlobais.entreConversas.min", Number(e.target.value))} placeholder="mín" />
            <div className="range-sep">—</div>
            <input className="form-input" type="number" value={plano.intervalosGlobais?.entreConversas?.max ?? 3600} onChange={e => upd("intervalosGlobais.entreConversas.max", Number(e.target.value))} placeholder="máx" />
          </div>

          <div className="form-label" style={{ marginBottom: 6 }}>Pausa longa (seg)</div>
          <div className="range-pair" style={{ marginBottom: 14 }}>
            <input className="form-input" type="number" value={plano.intervalosGlobais?.pausaLonga?.min ?? 300} onChange={e => upd("intervalosGlobais.pausaLonga.min", Number(e.target.value))} />
            <div className="range-sep">—</div>
            <input className="form-input" type="number" value={plano.intervalosGlobais?.pausaLonga?.max ?? 900} onChange={e => upd("intervalosGlobais.pausaLonga.max", Number(e.target.value))} />
          </div>

          <div className="form-label" style={{ marginBottom: 6 }}>Leitura mín (seg)</div>
          <div className="range-pair" style={{ marginBottom: 14 }}>
            <input className="form-input" type="number" value={plano.intervalosGlobais?.leituraMinima?.min ?? 1} onChange={e => upd("intervalosGlobais.leituraMinima.min", Number(e.target.value))} />
            <div className="range-sep">—</div>
            <input className="form-input" type="number" value={plano.intervalosGlobais?.leituraMinima?.max ?? 3} onChange={e => upd("intervalosGlobais.leituraMinima.max", Number(e.target.value))} />
          </div>
        </div>

        {/* Estratégia */}
        <div className="card">
          <div className="card-title">🎯 Estratégia</div>

          <div className="toggle-row">
            <div>
              <div className="toggle-label">Priorizar alta sensibilidade</div>
              <div className="toggle-desc">Focar nos telefones marcados como alta sensibilidade</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={plano.estrategia?.prioridadeTelefonesAltaSensibilidade ?? false} onChange={e => upd("estrategia.prioridadeTelefonesAltaSensibilidade", e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-label">Evitar repetição</div>
              <div className="toggle-desc">Não repetir conversas recentes</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={plano.estrategia?.evitarRepeticaoConversas ?? true} onChange={e => upd("estrategia.evitarRepeticaoConversas", e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-label">Distribuição uniforme</div>
              <div className="toggle-desc">Equilibrar carga entre todos os telefones</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={plano.estrategia?.distribuirUniformemente ?? true} onChange={e => upd("estrategia.distribuirUniformemente", e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-label">Randomizar participantes</div>
              <div className="toggle-desc">Variar quem conversa com quem</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={plano.estrategia?.randomizarParticipantes ?? true} onChange={e => upd("estrategia.randomizarParticipantes", e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SECTION: LOGS ────────────────────────────────────────────────────────────
function Logs({ toast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const endRef = useRef(null);

  const parseLog = (raw) => {
    const lines = raw.split("\n").filter(Boolean);
    return lines.slice(-200).reverse().map((line, i) => {
      let parsed = { time: "", level: "info", msg: line };
      try {
        const obj = JSON.parse(line);
        parsed = {
          time: obj.timestamp ? new Date(obj.timestamp).toLocaleTimeString("pt-BR") : "",
          level: obj.level || "info",
          msg: obj.message || line,
          meta: obj.meta,
        };
      } catch { /* raw line */ }
      return { ...parsed, id: i };
    });
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("http://localhost:3001/api/maturacao/status");
      if (!r.ok) throw new Error("offline");
      // Logs API não existe no backend, então simularemos com status
      const status = await r.json();
      setEntries([
        { id: 0, time: new Date().toLocaleTimeString("pt-BR"), level: "info", msg: `Sistema ${status.ativo ? "ativo" : "inativo"}` },
        ...entries.slice(0, 49),
      ]);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_INTERVAL);
    return () => clearInterval(t);
  }, []);

  const levelIcon = { info: "ℹ️", warn: "⚠️", error: "❌", debug: "🔍" };
  const levelColor = { info: "#999", warn: "#f59e0b", error: "#f87171", debug: "#aaa" };

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Logs e Monitoramento</div>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#aaa", alignSelf: "center" }}>
            Auto-refresh {POLL_INTERVAL / 1000}s
          </span>
        </div>
      </div>

      <div className="card">
        {loading && entries.length === 0 ? (
          <div className="empty"><div className="empty-text">Conectando ao backend...</div></div>
        ) : entries.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📋</div>
            <div className="empty-text">Nenhum log disponível</div>
            <div className="empty-sub">Os logs aparecem aqui em tempo real</div>
          </div>
        ) : (
          <div className="scrollable">
            {entries.map(e => (
              <div key={e.id} className="log-entry">
                <div className="log-time">{e.time}</div>
                <div className="log-icon">{levelIcon[e.level] ?? "•"}</div>
                <div className="log-body">
                  <div className="log-msg" style={{ color: levelColor[e.level] ?? "#555" }}>{e.msg}</div>
                  {e.meta && <div className="log-detail">{JSON.stringify(e.meta)}</div>}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title">ℹ️ Localização dos Logs</div>
          <div style={{ fontFamily: "Space Mono", fontSize: 12, color: "#999", padding: "4px 0" }}>
            backend/data/logs/combined.log
          </div>
          <div style={{ fontFamily: "Space Mono", fontSize: 12, color: "#888", padding: "4px 0" }}>
            backend/data/logs/error.log
          </div>
          <div style={{ fontSize: 12, color: "#aaa", marginTop: 8 }}>
            Para visualização completa de logs, utilize um endpoint dedicado no backend ou leia os arquivos diretamente.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const { toasts, toast } = useToast();
  const [backendOk, setBackendOk] = useState(null);

  useEffect(() => {
    const check = async () => {
      try {
        await fetch("http://localhost:3001/health");
        setBackendOk(true);
      } catch {
        setBackendOk(false);
      }
    };
    check();
    const t = setInterval(check, 8000);
    return () => clearInterval(t);
  }, []);

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: "◈" },
    { id: "telefones", label: "Telefones", icon: "📱" },
    { id: "conversas", label: "Conversas", icon: "💬" },
    { id: "plano", label: "Plano", icon: "⚙️" },
    { id: "logs", label: "Logs", icon: "📋" },
  ];

  const titles = {
    dashboard: "Dashboard",
    telefones: "Telefones",
    conversas: "Conversas",
    plano: "Plano de Maturação",
    logs: "Logs & Monitor",
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <img src="/Logo_AJcred.png" alt="AJcred" />
            <div className="sub">Maturador de Números</div>
          </div>

          <div className="nav-section">Navegação</div>
          {nav.map(n => (
            <div key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
              <span className="icon">{n.icon}</span>
              {n.label}
            </div>
          ))}

          <div className="sidebar-status">
            <div className="sys-pill">
              <div
                className={`dot ${backendOk ? "dot-pulse" : ""}`}
                style={{ background: backendOk === null ? "#888" : backendOk ? "#22c55e" : "#ef4444" }}
              />
              <span>{backendOk === null ? "verificando..." : backendOk ? "backend online" : "backend offline"}</span>
            </div>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <div className="page-title">{titles[page]}</div>
            <div className="topbar-actions">
              <span className="topbar-time">
                {new Date().toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
              </span>
            </div>
          </header>

          <div className="content">
            {page === "dashboard" && <Dashboard toast={toast} />}
            {page === "telefones" && <Telefones toast={toast} />}
            {page === "conversas" && <Conversas toast={toast} />}
            {page === "plano" && <PlanoMaturacao toast={toast} />}
            {page === "logs" && <Logs toast={toast} />}
          </div>
        </main>
      </div>

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </>
  );
}
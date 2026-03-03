import { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { api, formatDateTime } from './lib';

export default function LogsPage({ liveLog, toast }) {
  const [files, setFiles] = useState([]);
  const [fileKey, setFileKey] = useState('combined');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState([]);

  async function loadFiles() {
    try {
      setFiles(await api('/logs/files'));
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function loadLogs() {
    try {
      const params = new URLSearchParams({ file: fileKey, limit: '200' });
      if (level) params.set('level', level);
      if (search.trim()) params.set('search', search.trim());
      const data = await api(`/logs?${params.toString()}`);
      setEntries(data.items || []);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  useEffect(() => { loadFiles(); }, []);
  useEffect(() => { loadLogs(); }, [fileKey, level]);

  useEffect(() => {
    if (!liveLog) return;
    if (fileKey === 'error' && liveLog.level !== 'error') return;
    if (level && liveLog.level !== level) return;
    if (search.trim() && !String(liveLog.message || '').toLowerCase().includes(search.trim().toLowerCase())) return;
    setEntries((current) => [liveLog, ...current].slice(0, 200));
  }, [fileKey, level, liveLog, search]);

  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <h3>Logs reais do backend</h3>
          <p className="muted">Leitura de combined.log e error.log com atualizacao incremental.</p>
        </div>
        <button className="btn secondary" onClick={loadLogs}><RefreshCcw size={16} />Atualizar</button>
      </div>

      <div className="panel stack">
        <div className="grid two">
          <label className="label">Arquivo
            <select className="input" value={fileKey} onChange={(event) => setFileKey(event.target.value)}>
              {(files.length ? files : [{ key: 'combined', filename: 'combined.log' }, { key: 'error', filename: 'error.log' }]).map((item) => (
                <option key={item.key} value={item.key}>{item.filename}</option>
              ))}
            </select>
          </label>
          <label className="label">Nivel
            <select className="input" value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">Todos</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
              <option value="debug">debug</option>
            </select>
          </label>
        </div>
        <label className="label">Texto
          <div className="actions">
            <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtro livre" />
            <button className="btn secondary" onClick={loadLogs}>Aplicar</button>
          </div>
        </label>
      </div>

      <div className="panel stack">
        {entries.length === 0 ? <div className="empty">Nenhum log para os filtros atuais.</div> : entries.map((entry, index) => (
          <div key={`${entry.timestamp || 'raw'}_${index}`} className="list-card">
            <div className="between small-gap">
              <span className="pill">{entry.level || 'info'}</span>
              <span className="mono muted">{formatDateTime(entry.timestamp)}</span>
            </div>
            <div>{entry.message || entry.raw}</div>
            {entry.meta && <pre className="code">{JSON.stringify(entry.meta, null, 2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

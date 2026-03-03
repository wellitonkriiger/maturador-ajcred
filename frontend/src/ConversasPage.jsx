import { useEffect, useMemo, useRef, useState } from 'react';
import { FileCode2, FileJson, FolderSync, Pencil, Save, Trash2, Upload } from 'lucide-react';
import { api } from './lib';
import { Modal } from './components';

export default function ConversasPage({ toast }) {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [jsonDraft, setJsonDraft] = useState('');
  const inputRef = useRef(null);

  async function load() {
    try {
      const data = await api('/conversas');
      setLista(Array.isArray(data) ? data : []);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(item) {
    if (!window.confirm(`Deletar ${item.nome}?`)) return;
    try {
      await api(`/conversas/${item.id}`, { method: 'DELETE' });
      toast('Conversa removida', 'success');
      load();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function reload() {
    try {
      await api('/conversas/recarregar', { method: 'POST' });
      toast('Conversas recarregadas', 'success');
      load();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      toast('Somente arquivos .json', 'error');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      await api('/conversas/validar', { method: 'POST', body: JSON.stringify(parsed) });
      await api('/conversas/importar', { method: 'POST', body: JSON.stringify(parsed) });
      toast('Conversa importada', 'success');
      load();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function saveEdit() {
    try {
      const parsed = JSON.parse(jsonDraft);
      await api('/conversas/validar', { method: 'POST', body: JSON.stringify(parsed) });
      await api(`/conversas/${editing.id}`, { method: 'PUT', body: JSON.stringify(parsed) });
      toast('Conversa atualizada', 'success');
      setEditing(null);
      setJsonDraft('');
      load();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const filtradas = useMemo(() => {
    const search = busca.trim().toLowerCase();
    if (!search) return lista;
    return lista.filter((item) => [item.nome, item.id, item.categoria].some((value) => String(value || '').toLowerCase().includes(search)));
  }, [busca, lista]);

  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <h3>Gerenciar conversas</h3>
          <p className="muted">Importe e edite roteiros JSON sem tocar na pasta manualmente.</p>
        </div>
        <div className="actions">
          <input ref={inputRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
          <button className="btn secondary" onClick={() => inputRef.current?.click()}><Upload size={16} />Importar JSON</button>
          <button className="btn secondary" onClick={reload}><FolderSync size={16} />Recarregar</button>
        </div>
      </div>

      <div className="panel">
        <label className="label">Busca<input className="input" value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Nome, id ou categoria" /></label>
      </div>

      <div className="panel">
        {loading ? <div className="empty">Carregando conversas...</div> : filtradas.length === 0 ? <div className="empty">Nenhuma conversa encontrada.</div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nome</th><th>Categoria</th><th>Participantes</th><th>Mensagens</th><th>Acoes</th></tr>
              </thead>
              <tbody>
                {filtradas.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.nome}</strong><div className="mono muted">{item.id}</div></td>
                    <td>{item.categoria || '-'}</td>
                    <td className="mono">{item.participantesMinimos || 2}-{item.participantesMaximos || 2}</td>
                    <td>{item.mensagens?.length || 0}</td>
                    <td>
                      <div className="actions">
                        <button className="btn secondary sm" onClick={() => setDetail(item)}><FileCode2 size={14} />Ver</button>
                        <button className="btn secondary sm" onClick={() => { setEditing(item); setJsonDraft(JSON.stringify(item, null, 2)); }}><Pencil size={14} />Editar</button>
                        <button className="btn danger sm" onClick={() => remove(item)}><Trash2 size={14} />Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <Modal title={detail.nome} onClose={() => setDetail(null)}>
          <div className="stack">
            <div className="list-card">
              <div className="between small-gap"><span className="muted">ID</span><span className="mono">{detail.id}</span></div>
              <div className="between small-gap"><span className="muted">Categoria</span><span>{detail.categoria || '-'}</span></div>
            </div>
            <div className="stack">
              {(detail.mensagens || []).map((mensagem, index) => (
                <div key={index} className="list-card">
                  {mensagem.tipo === 'pausa_longa' ? (
                    <span className="muted">Pausa longa: {mensagem.duracao?.min}-{mensagem.duracao?.max}s</span>
                  ) : (
                    <>
                      <div className="mono muted">#{mensagem.ordem} remetente {mensagem.remetente}</div>
                      <div>{mensagem.texto}</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={`Editar JSON: ${editing.nome}`} onClose={() => { setEditing(null); setJsonDraft(''); }}>
          <div className="stack">
            <p className="muted">O backend valida a estrutura e nao permite trocar o id.</p>
            <textarea className="textarea" value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} />
            <div className="actions end"><button className="btn secondary" onClick={() => { setEditing(null); setJsonDraft(''); }}>Cancelar</button><button className="btn primary" onClick={saveEdit}><Save size={16} />Salvar JSON</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

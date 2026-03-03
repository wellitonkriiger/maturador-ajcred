import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Pencil, Phone, PhoneOff, QrCode, RefreshCcw, Save, Trash2 } from 'lucide-react';
import { api, getRealtimeSocket } from './lib';
import { Modal, StatusBadge } from './components';

export default function TelefonesPage({ telefones, toast, refreshSnapshot }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [qrModal, setQrModal] = useState(null);
  const [connectDialog, setConnectDialog] = useState(null);
  const [plano, setPlano] = useState(null);
  const [agora, setAgora] = useState(Date.now());
  const qrDismissedRef = useRef(new Set());
  const [form, setForm] = useState({
    nome: '',
    sensibilidade: 'media',
    quantidadeConversasDia: 5,
    podeIniciarConversa: true,
    podeReceberMensagens: true
  });

  useEffect(() => {
    api('/maturacao/plano').then(setPlano).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = getRealtimeSocket();
    const onQRCode = async ({ telefoneId, nome }) => {
      if (qrDismissedRef.current.has(telefoneId)) {
        return;
      }
      try {
        const result = await api(`/telefones/${telefoneId}/qrcode`);
        setQrModal({ id: telefoneId, nome, qrCode: result.qrCode, loading: false });
      } catch {
        setQrModal({ id: telefoneId, nome, qrCode: null, loading: true });
      }
    };
    const onQRCleared = ({ telefoneId }) => {
      setQrModal((current) => current?.id === telefoneId && current?.mode === 'qr' ? null : current);
    };
    const onPairingCode = ({ telefoneId, nome, code, phoneNumber }) => {
      if (qrDismissedRef.current.has(telefoneId)) {
        return;
      }
      setQrModal({
        id: telefoneId,
        nome,
        mode: 'phone',
        code,
        phoneNumber,
        loading: false
      });
    };
    const onPairingCodeCleared = ({ telefoneId }) => {
      setQrModal((current) => current?.id === telefoneId && current?.mode === 'phone' ? null : current);
    };

    socket.on('telefone:qrcode', onQRCode);
    socket.on('telefone:qr_cleared', onQRCleared);
    socket.on('telefone:pairing_code', onPairingCode);
    socket.on('telefone:pairing_code_cleared', onPairingCodeCleared);

    return () => {
      socket.off('telefone:qrcode', onQRCode);
      socket.off('telefone:qr_cleared', onQRCleared);
      socket.off('telefone:pairing_code', onPairingCode);
      socket.off('telefone:pairing_code_cleared', onPairingCodeCleared);
    };
  }, []);

  useEffect(() => {
    if (!qrModal) return;
    const current = telefones.find((item) => item.id === qrModal.id);
    if (current?.status === 'online') {
      qrDismissedRef.current.delete(current.id);
      setQrModal(null);
      toast(`${current.nome} conectado`, 'success');
      return;
    }
    if (current && ['offline', 'erro', 'requires_qr'].includes(current.status)) {
      setQrModal(null);
    }
  }, [qrModal, telefones, toast]);

  function formatCountdown(item) {
    const intervaloMinimo = plano?.intervalosGlobais?.entreConversas?.min || 0;
    const ultima = item.configuracao?.ultimaConversaEm;
    if (!intervaloMinimo || !ultima) {
      return 'disponivel';
    }

    const alvo = new Date(ultima).getTime() + (intervaloMinimo * 1000);
    const restante = Math.max(0, Math.ceil((alvo - agora) / 1000));
    if (restante <= 0) {
      return 'disponivel';
    }

    const minutos = Math.floor(restante / 60);
    const segundos = restante % 60;
    return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
  }

  async function createPhone() {
    try {
      await api('/telefones', { method: 'POST', body: JSON.stringify({ ...form, quantidadeConversasDia: Number(form.quantidadeConversasDia) }) });
      setShowCreate(false);
      setForm({ nome: '', sensibilidade: 'media', quantidadeConversasDia: 5, podeIniciarConversa: true, podeReceberMensagens: true });
      toast('Telefone criado', 'success');
      refreshSnapshot();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function openConnectDialog(item, method = 'qr') {
    qrDismissedRef.current.delete(item.id);
    setConnectDialog({
      item,
      method,
      phoneNumber: ''
    });
  }

  async function startConnection() {
    if (!connectDialog) return;

    const { item, method, phoneNumber } = connectDialog;
    const sanitizedPhone = String(phoneNumber ?? '').replace(/\D/g, '');

    if (method === 'phone' && sanitizedPhone.length < 10) {
      toast('Informe um numero valido para gerar o codigo de pareamento', 'error');
      return;
    }

    try {
      qrDismissedRef.current.delete(item.id);
      setQrModal({
        id: item.id,
        nome: item.nome,
        mode: method,
        qrCode: null,
        code: null,
        loading: true
      });
      setConnectDialog(null);
      await api(`/telefones/${item.id}/conectar`, {
        method: 'POST',
        body: JSON.stringify({
          method,
          phoneNumber: method === 'phone' ? sanitizedPhone : undefined
        })
      });
      toast(
        method === 'phone'
          ? `Gerando codigo de pareamento para ${item.nome}`
          : `Inicializando ${item.nome}`,
        'info'
      );
      refreshSnapshot();
    } catch (error) {
      setQrModal(null);
      toast(error.message, 'error');
    }
  }

  async function reconnectPhone(item) {
    try {
      const result = await api(`/telefones/${item.id}/reconectar`, { method: 'POST' });
      if (result?.status === 'requires_qr') {
        toast(`Sessao de ${item.nome} expirou. Gere um novo QR.`, 'info');
      } else {
        toast(`Reconexao iniciada para ${item.nome}`, 'info');
      }
      refreshSnapshot();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function disconnectPhone(item) {
    try {
      await api(`/telefones/${item.id}/desconectar`, { method: 'POST' });
      toast(`${item.nome} desconectado`, 'success');
      refreshSnapshot();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function deletePhone(item) {
    if (!window.confirm(`Deletar ${item.nome}?`)) return;
    try {
      await api(`/telefones/${item.id}`, { method: 'DELETE' });
      toast('Telefone removido', 'success');
      refreshSnapshot();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function saveEdit() {
    try {
      await api(`/telefones/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nome: editing.nome,
          sensibilidade: editing.sensibilidade,
          configuracao: {
            ...editing.original.configuracao,
            quantidadeConversasDia: Number(editing.quantidadeConversasDia),
            podeIniciarConversa: editing.podeIniciarConversa,
            podeReceberMensagens: editing.podeReceberMensagens
          }
        })
      });
      setEditing(null);
      toast('Telefone atualizado', 'success');
      refreshSnapshot();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <h3>Gerenciar telefones</h3>
          <p className="muted">Conectar, reconectar sem QR e corrigir sessoes que ficaram ociosas.</p>
        </div>
        <button className="btn primary" onClick={() => setShowCreate(true)}><Phone size={16} />Adicionar</button>
      </div>

      {telefones.length === 0 ? <div className="panel empty">Nenhum telefone cadastrado.</div> : (
        <div className="grid two">
          {telefones.map((item) => (
            <div key={item.id} className="panel">
              <div className="between">
                <div>
                  <h3>{item.nome}</h3>
                  <div className="mono muted">{item.id}</div>
                </div>
                <StatusBadge status={item.status} />
              </div>
              <div className="stack compact">
                <div className="between small-gap"><span className="muted">Numero</span><span className="mono">{item.numero || '-'}</span></div>
                <div className="between small-gap"><span className="muted">Conversas hoje</span><span>{item.configuracao?.conversasRealizadasHoje || 0}/{item.configuracao?.quantidadeConversasDia || 0}</span></div>
                <div className="between small-gap"><span className="muted">Nova conversa em</span><span className="mono">{formatCountdown(item)}</span></div>
                <div className="progress"><span style={{ width: `${Math.min(100, ((item.configuracao?.conversasRealizadasHoje || 0) / (item.configuracao?.quantidadeConversasDia || 1)) * 100)}%` }} /></div>
              </div>
              <div className="actions">
                {(item.status === 'offline' || item.status === 'erro' || item.status === 'requires_qr') && <button className="btn primary sm" onClick={() => openConnectDialog(item)}><QrCode size={14} />Conectar</button>}
                {item.status === 'online' && <button className="btn danger sm" onClick={() => disconnectPhone(item)}><PhoneOff size={14} />Desconectar</button>}
                {item.status === 'reconnecting' && <button className="btn secondary sm" disabled><LoaderCircle size={14} />Reconectando</button>}
                {(item.status === 'offline' || item.status === 'erro' || item.status === 'requires_qr' || item.status === 'online') && (
                  <button className="btn secondary sm" onClick={() => reconnectPhone(item)}><RefreshCcw size={14} />Tentar reconexao</button>
                )}
                <button className="btn secondary sm" onClick={() => setEditing({
                  id: item.id,
                  original: item,
                  nome: item.nome,
                  sensibilidade: item.sensibilidade,
                  quantidadeConversasDia: item.configuracao?.quantidadeConversasDia || 5,
                  podeIniciarConversa: item.configuracao?.podeIniciarConversa ?? true,
                  podeReceberMensagens: item.configuracao?.podeReceberMensagens ?? true
                })}><Pencil size={14} />Editar</button>
                <button className="btn danger sm" onClick={() => deletePhone(item)}><Trash2 size={14} />Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Adicionar telefone" onClose={() => setShowCreate(false)}>
          <div className="stack">
            <label className="label">Nome<input className="input" value={form.nome} onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))} /></label>
            <div className="grid two">
              <label className="label">Sensibilidade
                <select className="input" value={form.sensibilidade} onChange={(event) => setForm((current) => ({ ...current, sensibilidade: event.target.value }))}>
                  <option value="baixa">Baixa</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                </select>
              </label>
              <label className="label">Conversas por dia<input className="input" type="number" min="1" value={form.quantidadeConversasDia} onChange={(event) => setForm((current) => ({ ...current, quantidadeConversasDia: event.target.value }))} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={form.podeIniciarConversa} onChange={(event) => setForm((current) => ({ ...current, podeIniciarConversa: event.target.checked }))} />Pode iniciar conversa</label>
            <label className="check"><input type="checkbox" checked={form.podeReceberMensagens} onChange={(event) => setForm((current) => ({ ...current, podeReceberMensagens: event.target.checked }))} />Pode receber mensagens</label>
            <div className="actions end"><button className="btn secondary" onClick={() => setShowCreate(false)}>Cancelar</button><button className="btn primary" onClick={createPhone} disabled={!form.nome.trim()}><Save size={16} />Criar</button></div>
          </div>
        </Modal>
      )}

      {connectDialog && (
        <Modal title={`Conectar ${connectDialog.item.nome}`} onClose={() => setConnectDialog(null)} small>
          <div className="stack">
            <div className="actions">
              <button
                className={`btn ${connectDialog.method === 'qr' ? 'primary' : 'secondary'}`}
                onClick={() => setConnectDialog((current) => ({ ...current, method: 'qr' }))}
              >
                <QrCode size={16} />
                QR Code
              </button>
              <button
                className={`btn ${connectDialog.method === 'phone' ? 'primary' : 'secondary'}`}
                onClick={() => setConnectDialog((current) => ({ ...current, method: 'phone' }))}
              >
                <Phone size={16} />
                Numero
              </button>
            </div>

            {connectDialog.method === 'phone' ? (
              <>
                <label className="label">
                  Numero para vincular
                  <input
                    className="input"
                    value={connectDialog.phoneNumber}
                    onChange={(event) => setConnectDialog((current) => ({ ...current, phoneNumber: event.target.value }))}
                    placeholder="Ex.: 5569921830958"
                  />
                </label>
                <p className="muted">
                  O WhatsApp gera um codigo de 8 letras para digitar em Dispositivos conectados no celular.
                </p>
              </>
            ) : (
              <p className="muted">
                O sistema vai abrir o QR Code normal para leitura pelo celular.
              </p>
            )}

            <div className="actions end">
              <button className="btn secondary" onClick={() => setConnectDialog(null)}>Cancelar</button>
              <button className="btn primary" onClick={startConnection}>
                {connectDialog.method === 'phone' ? <Phone size={16} /> : <QrCode size={16} />}
                {connectDialog.method === 'phone' ? 'Gerar codigo' : 'Gerar QR'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={`Editar ${editing.nome}`} onClose={() => setEditing(null)}>
          <div className="stack">
            <label className="label">Nome<input className="input" value={editing.nome} onChange={(event) => setEditing((current) => ({ ...current, nome: event.target.value }))} /></label>
            <div className="grid two">
              <label className="label">Sensibilidade
                <select className="input" value={editing.sensibilidade} onChange={(event) => setEditing((current) => ({ ...current, sensibilidade: event.target.value }))}>
                  <option value="baixa">Baixa</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                </select>
              </label>
              <label className="label">Conversas por dia<input className="input" type="number" min="1" value={editing.quantidadeConversasDia} onChange={(event) => setEditing((current) => ({ ...current, quantidadeConversasDia: event.target.value }))} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={editing.podeIniciarConversa} onChange={(event) => setEditing((current) => ({ ...current, podeIniciarConversa: event.target.checked }))} />Pode iniciar conversa</label>
            <label className="check"><input type="checkbox" checked={editing.podeReceberMensagens} onChange={(event) => setEditing((current) => ({ ...current, podeReceberMensagens: event.target.checked }))} />Pode receber mensagens</label>
            <div className="actions end"><button className="btn secondary" onClick={() => setEditing(null)}>Cancelar</button><button className="btn primary" onClick={saveEdit}><Save size={16} />Salvar</button></div>
          </div>
        </Modal>
      )}

      {qrModal && (
        <Modal
          title={`Conexao: ${qrModal.nome}`}
          onClose={() => {
            qrDismissedRef.current.add(qrModal.id);
            setQrModal(null);
          }}
          small
        >
          {qrModal.loading ? (
            <div className="empty">
              <LoaderCircle size={18} />
              {qrModal.mode === 'phone' ? 'Gerando codigo...' : 'Aguardando QR...'}
            </div>
          ) : (
            <div className="stack center">
              {qrModal.mode === 'phone' ? (
                <>
                  <div className="code" style={{ fontSize: 28, letterSpacing: '0.18em', fontWeight: 800, textAlign: 'center', width: '100%' }}>
                    {qrModal.code}
                  </div>
                  <p className="muted center-text">
                    Digite esse codigo em Dispositivos conectados no celular.
                  </p>
                </>
              ) : (
                <>
                  <img src={qrModal.qrCode} alt="QR" style={{ width: 240, height: 240 }} />
                  <p className="muted center-text">O modal fecha automaticamente quando o telefone ficar online.</p>
                </>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

import { Activity, Phone, PhoneCall, Play, StopCircle, Wifi } from 'lucide-react';
import { api, formatDateTime, formatNumeroBR, formatTimeAgo } from './lib';
import { StatusBadge } from './components';

export default function DashboardPage({ telefones, status, ativas, toast, refreshSnapshot }) {
  const online = telefones.filter((item) => item.status === 'online').length;
  const totalHoje = telefones.reduce((sum, item) => sum + (item.configuracao?.conversasRealizadasHoje || 0), 0);
  const metaHoje = telefones.reduce((sum, item) => sum + (item.configuracao?.quantidadeConversasDia || 0), 0);

  async function toggle() {
    try {
      await api(status?.emExecucao ? '/maturacao/parar' : '/maturacao/iniciar', { method: 'POST' });
      toast(status?.emExecucao ? 'Maturacao pausada' : 'Maturacao iniciada', 'success');
      refreshSnapshot();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  return (
    <div className="stack">
      <div className="panel">
        <div className="section-head">
          <div>
            <h3>Controle da maturacao</h3>
            <p className="muted">Status do plano, telefones e conversas em execucao.</p>
          </div>
          <button className={`btn ${status?.emExecucao ? 'danger' : 'primary'}`} onClick={toggle}>
            {status?.emExecucao ? <StopCircle size={16} /> : <Play size={16} />}
            {status?.emExecucao ? 'Pausar' : 'Iniciar'}
          </button>
        </div>
        <div className="stats">
          <div className="card stat"><Phone size={18} /><strong>{online}</strong><span>online / {telefones.length}</span></div>
          <div className="card stat"><Activity size={18} /><strong>{totalHoje}</strong><span>conversas hoje / meta {metaHoje}</span></div>
          <div className="card stat"><PhoneCall size={18} /><strong>{ativas.length}</strong><span>conversas ativas</span></div>
          <div className="card stat"><Wifi size={18} /><strong>{status?.emExecucao ? 'ativo' : 'pausado'}</strong><span>{status?.dentroHorario ? 'janela ativa' : formatDateTime(status?.proximoHorario)}</span></div>
        </div>
      </div>

      <div className="grid two">
        <div className="panel">
          <div className="section-head"><h3>Telefones</h3></div>
          <div className="stack">
            {telefones.length === 0 ? <div className="empty">Nenhum telefone cadastrado.</div> : telefones.map((item) => (
              <div key={item.id} className="list-card">
                <div className="between">
                  <div>
                    <strong>{item.nome}</strong>
                    <div className="mono muted">{item.id}</div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <div className="between small-gap">
                  <span className="muted">Numero</span>
                  <span className="mono">{formatNumeroBR(item.numeroAlt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="section-head"><h3>Conversas ativas</h3></div>
          <div className="stack">
            {ativas.length === 0 ? <div className="empty">Nenhuma conversa ativa.</div> : ativas.map((item) => (
              <div key={item.conversaExecucaoId} className="list-card">
                <div className="between">
                  <strong>{item.conversaNome}</strong>
                  <span className="pill">{item.status}</span>
                </div>
                <div className="muted">{item.participantes.join(' <-> ')}</div>
                <div className="between small-gap">
                  <span className="muted">Progresso</span>
                  <span>{item.mensagemAtual}/{item.totalMensagens}</span>
                </div>
                <div className="progress"><span style={{ width: `${item.progresso || 0}%` }} /></div>
                <div className="muted">Iniciou ha {formatTimeAgo(item.iniciouEm)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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
      toast(status?.emExecucao ? 'Maturação pausada' : 'Maturação iniciada', 'success');
      refreshSnapshot();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  return (
    <div className="stack">
      <div className="panel hero-panel">
        <div className="section-head">
          <div className="section-copy">
            <span className="section-kicker">Operação</span>
            <h3>Controle da maturação</h3>
            <p className="muted">Status do plano, telefones e conversas em execução.</p>
          </div>
          <button className={`btn ${status?.emExecucao ? 'danger' : 'primary'}`} onClick={toggle}>
            {status?.emExecucao ? <StopCircle size={16} /> : <Play size={16} />}
            {status?.emExecucao ? 'Pausar' : 'Iniciar'}
          </button>
        </div>
        <div className="stats">
          <div className="card stat tone-neutral">
            <span className="stat-icon"><Phone size={16} /></span>
            <strong className="stat-value">{online}</strong>
            <span className="stat-label">online / {telefones.length}</span>
          </div>
          <div className="card stat tone-neutral">
            <span className="stat-icon"><Activity size={16} /></span>
            <strong className="stat-value">{totalHoje}</strong>
            <span className="stat-label">conversas hoje / meta {metaHoje}</span>
          </div>
          <div className="card stat tone-neutral">
            <span className="stat-icon"><PhoneCall size={16} /></span>
            <strong className="stat-value">{ativas.length}</strong>
            <span className="stat-label">conversas ativas</span>
          </div>
          <div className={`card stat ${status?.emExecucao ? 'tone-green' : 'tone-red'}`}>
            <span className="stat-icon"><Wifi size={16} /></span>
            <strong className="stat-value">{status?.emExecucao ? 'ativo' : 'pausado'}</strong>
            <span className="stat-label">{status?.dentroHorario ? 'janela ativa' : formatDateTime(status?.proximoHorario)}</span>
          </div>
        </div>
      </div>

      <div className="grid two">
        <div className="panel">
          <div className="section-head">
            <div className="section-copy">
              <span className="section-kicker">Dispositivos</span>
              <h3>Telefones</h3>
            </div>
          </div>
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
                  <span className="muted">Número</span>
                  <span className="mono">{formatNumeroBR(item.numeroAlt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="section-head">
            <div className="section-copy">
              <span className="section-kicker">Fila ativa</span>
              <h3>Conversas ativas</h3>
            </div>
          </div>
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
                <div className="muted">Iniciou há {formatTimeAgo(item.iniciouEm)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

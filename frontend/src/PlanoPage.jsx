import { useEffect, useState } from 'react';
import { Save, Settings2 } from 'lucide-react';
import { api } from './lib';

export default function PlanoPage({ toast, status }) {
  const [plano, setPlano] = useState(null);
  const [saving, setSaving] = useState(false);
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  const bloqueado = !!status?.emExecucao;

  useEffect(() => {
    api('/maturacao/plano').then(setPlano).catch((error) => toast(error.message, 'error'));
  }, []);

  function update(path, value) {
    setPlano((current) => {
      const next = structuredClone(current);
      const keys = path.split('.');
      let cursor = next;
      for (let index = 0; index < keys.length - 1; index++) {
        const key = keys[index];
        if (!cursor[key] || typeof cursor[key] !== 'object') {
          cursor[key] = {};
        }
        cursor = cursor[key];
      }
      cursor[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function save() {
    if (bloqueado) {
      toast('Pause a maturação antes de alterar o plano', 'info');
      return;
    }

    setSaving(true);
    try {
      await api('/maturacao/plano', { method: 'PUT', body: JSON.stringify(plano) });
      toast('Plano salvo', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!plano) return <div className="panel empty">Carregando plano...</div>;

  return (
    <div className="stack">
      <div className="panel toolbar-panel">
        <div className="section-head">
          <div className="section-copy">
            <span className="section-kicker">Configuração</span>
            <h3>Plano de maturação</h3>
            <p className="muted">Horários, intervalos e regras que controlam a automação.</p>
          </div>
          <div className="actions end">
            <button className="btn primary" onClick={save} disabled={saving || bloqueado}>
              <Save size={16} />
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>

      {bloqueado && (
        <div className="inline-note">
          Pause a maturação para liberar a edição do plano.
        </div>
      )}

      <div className="grid two" style={bloqueado ? { opacity: 0.72, pointerEvents: 'none' } : undefined}>
        <div className="panel stack">
          <div className="card-title"><Settings2 size={16} />Horário</div>
          <div className="grid two">
            <label className="label">Início<input className="input" type="time" value={plano.horarioFuncionamento?.inicio || '08:00'} onChange={(event) => update('horarioFuncionamento.inicio', event.target.value)} /></label>
            <label className="label">Fim<input className="input" type="time" value={plano.horarioFuncionamento?.fim || '22:00'} onChange={(event) => update('horarioFuncionamento.fim', event.target.value)} /></label>
          </div>
          <div className="actions">
            {dias.map((dia, index) => {
              const active = (plano.horarioFuncionamento?.diasSemana || []).includes(index);
              return (
                <button
                  key={dia}
                  className={`btn ${active ? 'primary' : 'secondary'} sm`}
                  onClick={() => {
                    const current = [...(plano.horarioFuncionamento?.diasSemana || [])];
                    const pos = current.indexOf(index);
                    if (pos === -1) current.push(index);
                    else current.splice(pos, 1);
                    update('horarioFuncionamento.diasSemana', current.sort((a, b) => a - b));
                  }}
                >
                  {dia}
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel stack">
          <div className="card-title"><Settings2 size={16} />Metas e intervalos</div>
          <div className="list-card stack compact">
            <div className="between small-gap"><span className="muted">Conversas por telefone</span><span>Definido em cada telefone</span></div>
            <div className="between small-gap"><span className="muted">Total por dia</span><span>Soma automática dos telefones</span></div>
          </div>
          <div className="grid two">
            <label className="label">Entre conversas min<input className="input" type="number" value={plano.intervalosGlobais?.entreConversas?.min ?? 1800} onChange={(event) => update('intervalosGlobais.entreConversas.min', Number(event.target.value))} /></label>
            <label className="label">Entre conversas max<input className="input" type="number" value={plano.intervalosGlobais?.entreConversas?.max ?? 3600} onChange={(event) => update('intervalosGlobais.entreConversas.max', Number(event.target.value))} /></label>
          </div>
        </div>

        <div className="panel stack">
          <div className="card-title"><Settings2 size={16} />Estratégia</div>
          <label className="between">
            <span>Priorizar alta sensibilidade</span>
            <input type="checkbox" checked={plano.estrategia?.prioridadeTelefonesAltaSensibilidade ?? true} onChange={(event) => update('estrategia.prioridadeTelefonesAltaSensibilidade', event.target.checked)} />
          </label>
          <label className="between">
            <span>Evitar repetição de conversas</span>
            <input type="checkbox" checked={plano.estrategia?.evitarRepeticaoConversas ?? true} onChange={(event) => update('estrategia.evitarRepeticaoConversas', event.target.checked)} />
          </label>
          <label className="between">
            <span>Distribuir conversas uniformemente</span>
            <input type="checkbox" checked={plano.estrategia?.distribuirUniformemente ?? true} onChange={(event) => update('estrategia.distribuirUniformemente', event.target.checked)} />
          </label>
          <label className="between">
            <span>Randomizar participantes</span>
            <input type="checkbox" checked={plano.estrategia?.randomizarParticipantes ?? true} onChange={(event) => update('estrategia.randomizarParticipantes', event.target.checked)} />
          </label>
          <label className="label">Máximo de conversas por mesmo par/dia<input className="input" type="number" min="1" value={plano.estrategia?.maxConversasMesmoParDia ?? 3} onChange={(event) => update('estrategia.maxConversasMesmoParDia', Number(event.target.value))} /></label>
        </div>
      </div>
    </div>
  );
}

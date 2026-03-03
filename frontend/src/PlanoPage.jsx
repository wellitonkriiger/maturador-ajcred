import { useEffect, useState } from 'react';
import { Save, Settings2 } from 'lucide-react';
import { api } from './lib';

export default function PlanoPage({ toast }) {
  const [plano, setPlano] = useState(null);
  const [saving, setSaving] = useState(false);
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

  useEffect(() => {
    api('/maturacao/plano').then(setPlano).catch((error) => toast(error.message, 'error'));
  }, []);

  function update(path, value) {
    setPlano((current) => {
      const next = structuredClone(current);
      const keys = path.split('.');
      let cursor = next;
      for (let index = 0; index < keys.length - 1; index++) cursor = cursor[keys[index]];
      cursor[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function save() {
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
      <div className="section-head">
        <div>
          <h3>Plano de maturacao</h3>
          <p className="muted">Persistido em arquivo local e aplicado em tempo real.</p>
        </div>
        <button className="btn primary" onClick={save} disabled={saving}><Save size={16} />{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>

      <div className="grid two">
        <div className="panel stack">
          <div className="card-title"><Settings2 size={16} />Horario</div>
          <div className="grid two">
            <label className="label">Inicio<input className="input" type="time" value={plano.horarioFuncionamento?.inicio || '08:00'} onChange={(event) => update('horarioFuncionamento.inicio', event.target.value)} /></label>
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
          <label className="label">Conversas por telefone<input className="input" type="number" value={plano.metas?.conversasPorTelefoneDia || 5} onChange={(event) => update('metas.conversasPorTelefoneDia', Number(event.target.value))} /></label>
          <label className="label">Total por dia<input className="input" type="number" value={plano.metas?.totalConversasDia || 25} onChange={(event) => update('metas.totalConversasDia', Number(event.target.value))} /></label>
          <div className="grid two">
            <label className="label">Entre conversas min<input className="input" type="number" value={plano.intervalosGlobais?.entreConversas?.min || 1800} onChange={(event) => update('intervalosGlobais.entreConversas.min', Number(event.target.value))} /></label>
            <label className="label">Entre conversas max<input className="input" type="number" value={plano.intervalosGlobais?.entreConversas?.max || 3600} onChange={(event) => update('intervalosGlobais.entreConversas.max', Number(event.target.value))} /></label>
          </div>
        </div>
      </div>
    </div>
  );
}

// tests/4-plano-maturacao.js

const axios = require('axios');
const API = 'http://localhost:3001/api';

function ok(msg)   { console.log(`   ✅ ${msg}`); }
function fail(msg) { console.log(`   ❌ ${msg}`); }
function info(msg) { console.log(`   ℹ️  ${msg}`); }

async function req(method, path, body) {
  try {
    const res = await axios({ method, url: `${API}${path}`, data: body, timeout: 10000 });
    return { ok: true, status: res.status, data: res.data };
  } catch (e) {
    return { ok: false, status: e.response?.status, data: e.response?.data, message: e.message };
  }
}

async function testarPlano() {
  console.log('\n🧪 TESTE 4: Plano de Maturação');
  console.log('═══════════════════════════════════════\n');

  let passou = true;
  let planoOriginal = null;

  // 1. OBTER
  console.log('📋 1. Obtendo plano atual...');
  const obter = await req('GET', '/maturacao/plano');
  if (obter.ok) {
    planoOriginal = obter.data;
    ok('Obtido!');
    info(`Ativo      : ${obter.data.ativo}`);
    info(`Horário    : ${obter.data.horarioFuncionamento?.inicio} → ${obter.data.horarioFuncionamento?.fim}`);
    info(`Dias/semana: [${obter.data.horarioFuncionamento?.diasSemana?.join(', ')}]`);
    info(`Entre conv.: ${obter.data.intervalosGlobais?.entreConversas?.min}s - ${obter.data.intervalosGlobais?.entreConversas?.max}s`);
    info(`Conv/tel/dia: ${obter.data.metas?.conversasPorTelefoneDia}`);
    info(`Randomizar : ${obter.data.estrategia?.randomizarParticipantes}`);
  } else {
    fail(`HTTP ${obter.status} — ${JSON.stringify(obter.data)}`); passou = false;
  }
  console.log('');

  // 2. ATUALIZAR
  console.log('♻️  2. Atualizando horário e metas...');
  const atualizar = await req('PUT', '/maturacao/plano', {
    horarioFuncionamento: { inicio: '09:00', fim: '21:00', diasSemana: [1,2,3,4,5] },
    metas: { conversasPorTelefoneDia: 3, duracaoPlano: '15 dias' }
  });
  if (atualizar.ok) {
    ok('Atualizado!');
    info(`Novo horário : ${atualizar.data.horarioFuncionamento.inicio} → ${atualizar.data.horarioFuncionamento.fim}`);
    info(`Novos dias   : [${atualizar.data.horarioFuncionamento.diasSemana.join(', ')}]`);
    info(`Conv/dia     : ${atualizar.data.metas.conversasPorTelefoneDia}`);
  } else {
    fail(`HTTP ${atualizar.status}`); passou = false;
  }
  console.log('');

  // 3. ATIVAR
  console.log('🟢 3. Ativando plano...');
  const ativar = await req('POST', '/maturacao/plano/toggle', { ativo: true });
  if (ativar.ok) { ok(`ativo: ${ativar.data.ativo}`); } else { fail(`HTTP ${ativar.status}`); passou = false; }
  console.log('');

  // 4. DESATIVAR
  console.log('🔴 4. Desativando plano...');
  const desativar = await req('POST', '/maturacao/plano/toggle', { ativo: false });
  if (desativar.ok) { ok(`ativo: ${desativar.data.ativo}`); } else { fail(`HTTP ${desativar.status}`); passou = false; }
  console.log('');

  // 5. RESTAURAR
  if (planoOriginal) {
    console.log('🔄 5. Restaurando plano original...');
    const restaurar = await req('PUT', '/maturacao/plano', planoOriginal);
    if (restaurar.ok) {
      ok('Restaurado!');
      info(`Horário: ${restaurar.data.horarioFuncionamento.inicio} → ${restaurar.data.horarioFuncionamento.fim}`);
    } else {
      fail(`HTTP ${restaurar.status}`); passou = false;
    }
    console.log('');
  }

  console.log(passou ? '✅ TODOS OS TESTES PASSARAM!\n' : '⚠️  ALGUNS TESTES FALHARAM!\n');
  return passou;
}

testarPlano();

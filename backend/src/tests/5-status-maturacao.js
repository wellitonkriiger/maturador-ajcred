// tests/5-status-maturacao.js

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

async function testarStatus() {
  console.log('\n🧪 TESTE 5: Status de Maturação');
  console.log('═══════════════════════════════════════\n');

  let passou = true;

  // 1. STATUS GERAL
  console.log('📊 1. Status geral...');
  const status = await req('GET', '/maturacao/status');
  if (status.ok) {
    const d = status.data;
    ok('Obtido!');
    info(`Em execução       : ${d.emExecucao}`);
    info(`Plano ativo       : ${d.planoAtivo}`);
    info(`Dentro do horário : ${d.dentroHorario}`);
    info(`Telefones total   : ${d.telefones.total}`);
    info(`Telefones online  : ${d.telefones.online}`);
    info(`Disponíveis       : ${d.telefones.disponiveis}`);
    info(`Conversas hoje    : ${d.conversas.realizadasHoje}`);
    info(`Conversas ativas  : ${d.conversas.ativas}`);
    if (d.proximoHorario) info(`Próximo horário   : ${new Date(d.proximoHorario).toLocaleString('pt-BR')}`);
  } else {
    fail(`HTTP ${status.status}`); passou = false;
  }
  console.log('');

  // 2. CONVERSAS ATIVAS
  console.log('💬 2. Conversas ativas...');
  const ativas = await req('GET', '/maturacao/conversas-ativas');
  if (ativas.ok) {
    ok(`${ativas.data.length} ativa(s)`);
    if (ativas.data.length > 0) {
      ativas.data.forEach((c,i) => info(`${i+1}. ${c.telefone} ↔ "${c.conversa}" — ${c.progresso}%`));
    } else {
      info('Nenhuma em andamento');
    }
  } else {
    fail(`HTTP ${ativas.status}`); passou = false;
  }
  console.log('');

  // 3. INICIAR
  console.log('🚀 3. Iniciando maturação...');
  const iniciar = await req('POST', '/maturacao/iniciar');
  if (iniciar.ok) {
    ok(iniciar.data.mensagem);
  } else if (iniciar.status === 400) {
    info(`Não iniciou (esperado em teste): ${iniciar.data?.erro}`);
  } else {
    fail(`HTTP ${iniciar.status}`); passou = false;
  }
  console.log('');

  // 4. STATUS APÓS INICIAR
  console.log('📊 4. Status após iniciar...');
  const s2 = await req('GET', '/maturacao/status');
  if (s2.ok) {
    ok(`Em execução: ${s2.data.emExecucao}`);
    info(`Plano ativo: ${s2.data.planoAtivo}`);
    info(`Dentro horário: ${s2.data.dentroHorario}`);
  } else {
    fail(`HTTP ${s2.status}`); passou = false;
  }
  console.log('');

  // 5. PARAR
  console.log('⏸️  5. Parando...');
  const parar = await req('POST', '/maturacao/parar');
  if (parar.ok) {
    ok(parar.data.mensagem);
  } else if (parar.status === 400) {
    info(`Não parou: ${parar.data?.erro}`);
  } else {
    fail(`HTTP ${parar.status}`); passou = false;
  }
  console.log('');

  console.log(passou ? '✅ TODOS OS TESTES PASSARAM!\n' : '⚠️  ALGUNS TESTES FALHARAM!\n');
  return passou;
}

testarStatus();

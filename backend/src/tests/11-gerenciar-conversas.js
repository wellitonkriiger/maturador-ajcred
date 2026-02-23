// tests/11-gerenciar-conversas.js
// Gerencia conversas via terminal
//
// Uso:
//   node tests/11-gerenciar-conversas.js listar
//   node tests/11-gerenciar-conversas.js ver <id>
//   node tests/11-gerenciar-conversas.js deletar <id>
//   node tests/11-gerenciar-conversas.js recarregar

const axios = require('axios');
const API = 'http://localhost:3001/api';

function info(msg) { console.log(`   ${msg}`); }

async function req(method, path, body) {
  try {
    const res = await axios({ method, url: `${API}${path}`, data: body, timeout: 10000 });
    return { ok: true, status: res.status, data: res.data };
  } catch (e) {
    return { ok: false, status: e.response?.status, data: e.response?.data, message: e.message };
  }
}

async function listar() {
  console.log('\n💬 TODAS AS CONVERSAS\n' + '━'.repeat(50));
  const r = await req('GET', '/conversas');
  if (!r.ok) { console.log(`❌ Falha: ${r.message}`); return; }

  if (r.data.length === 0) {
    console.log('  Nenhuma conversa cadastrada.');
    console.log('  Adicione arquivos .json em backend/data/conversas/');
    console.log('  e execute: node tests/11-gerenciar-conversas.js recarregar\n');
    return;
  }

  r.data.forEach((c, i) => {
    const textos = c.mensagens?.filter(m => !m.tipo).length ?? 0;
    const pausas = c.mensagens?.filter(m => m.tipo === 'pausa_longa').length ?? 0;
    console.log(`\n${i+1}. [${c.id}] "${c.nome}"`);
    info(`Categoria     : ${c.categoria}`);
    info(`Tags          : ${c.tags?.join(', ') ?? 'nenhuma'}`);
    info(`Participantes : ${c.participantesMinimos}-${c.participantesMaximos}`);
    info(`Mensagens     : ${textos} textos + ${pausas} pausa(s)`);
    info(`Vezes usada   : ${c.metadados?.vezesUsada ?? 0}`);
    info(`Último uso    : ${c.metadados?.ultimoUso ? new Date(c.metadados.ultimoUso).toLocaleString('pt-BR') : 'nunca'}`);
  });
  console.log('');
}

async function ver(id) {
  if (!id) { console.log('❌ ID obrigatório!'); return; }
  console.log(`\n🔍 DETALHE: ${id}\n` + '━'.repeat(50));
  const r = await req('GET', `/conversas/${id}`);
  if (!r.ok) { console.log(`❌ Não encontrada: ${r.message}`); return; }
  const c = r.data;
  console.log(`📖 "${c.nome}"`);
  console.log('━'.repeat(50));
  info(`ID            : ${c.id}`);
  info(`Categoria     : ${c.categoria}`);
  info(`Tags          : ${c.tags?.join(', ') ?? 'nenhuma'}`);
  info(`Participantes : ${c.participantesMinimos}-${c.participantesMaximos}`);
  info(`Duração est.  : ${c.duracaoEstimada}`);
  info(`Vezes usada   : ${c.metadados?.vezesUsada ?? 0}`);
  console.log('\n📨 Mensagens:');
  c.mensagens.forEach(m => {
    if (m.tipo === 'pausa_longa') {
      console.log(`  ⏸  [#${m.ordem}] PAUSA: ${m.duracao.min}-${m.duracao.max}s`);
    } else {
      console.log(`  💬 [#${m.ordem}] rem[${m.remetente}]: "${m.texto}"`);
      info(`  delay: ${m.delay.min}-${m.delay.max}s | digitação: ${m.comportamento?.simularDigitacao ? `${m.comportamento.tempoDigitacao.min}-${m.comportamento.tempoDigitacao.max}s` : 'não'}`);
    }
  });
  console.log('');
}

async function deletar(id) {
  if (!id) { console.log('❌ ID obrigatório!'); return; }
  console.log(`\n🗑️  DELETAR: ${id}\n` + '━'.repeat(50));
  const r = await req('DELETE', `/conversas/${id}`);
  if (r.ok) { console.log(`✅ ${r.data.mensagem}`); }
  else if (r.status === 404) { console.log('❌ Não encontrada!'); }
  else { console.log(`❌ HTTP ${r.status}`); }
  console.log('');
}

async function recarregar() {
  console.log('\n🔄 RECARREGANDO CONVERSAS\n' + '━'.repeat(50));
  const r = await req('POST', '/conversas/recarregar');
  if (r.ok) {
    console.log(`✅ ${r.data.mensagem}`);
    info(`Total carregado: ${r.data.total}`);
  } else {
    console.log(`❌ HTTP ${r.status}`);
  }
  console.log('');
}

async function ajuda() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       GERENCIAR CONVERSAS              ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log('Comandos:\n');
  console.log('  listar          → lista todas as conversas');
  console.log('  ver <id>        → mostra mensagens detalhadas');
  console.log('  deletar <id>    → deleta uma conversa');
  console.log('  recarregar      → recarrega da pasta data/conversas/\n');
  console.log('Para adicionar conversas:');
  console.log('  1. Coloque o arquivo .json em backend/data/conversas/');
  console.log('  2. Execute: node tests/11-gerenciar-conversas.js recarregar\n');
}

async function main() {
  const [acao, ...args] = process.argv.slice(2);
  if (!acao || acao === 'ajuda') { await ajuda(); return; }
  if (acao === 'listar')     { await listar(); return; }
  if (acao === 'ver')        { await ver(args[0]); return; }
  if (acao === 'deletar')    { await deletar(args[0]); return; }
  if (acao === 'recarregar') { await recarregar(); return; }
  console.log(`❌ Ação desconhecida: "${acao}"`);
  await ajuda();
}

main().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });

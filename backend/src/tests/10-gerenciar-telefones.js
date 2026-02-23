// tests/10-gerenciar-telefones.js
// CRUD de telefones via terminal
//
// Uso:
//   node tests/10-gerenciar-telefones.js listar
//   node tests/10-gerenciar-telefones.js criar "Nome" [conv-dia] [sensibilidade]
//   node tests/10-gerenciar-telefones.js ver <id>
//   node tests/10-gerenciar-telefones.js deletar <id>
//   node tests/10-gerenciar-telefones.js desconectar <id>
//   node tests/10-gerenciar-telefones.js resetar-contador <id>

const axios = require('axios');
const API = 'http://localhost:3001/api';

function info(msg) { console.log(`   ${msg}`); }

async function req(method, path, body) {
  try {
    const res = await axios({ method, url: `${API}${path}`, data: body, timeout: 15000 });
    return { ok: true, status: res.status, data: res.data };
  } catch (e) {
    return { ok: false, status: e.response?.status, data: e.response?.data, message: e.message };
  }
}

async function listar() {
  console.log('\n📋 TODOS OS TELEFONES\n' + '━'.repeat(50));
  const r = await req('GET', '/telefones');
  if (!r.ok) { console.log(`❌ Falha: ${r.message}`); return; }

  if (r.data.length === 0) {
    console.log('  Nenhum cadastrado.\n');
    console.log('  node tests/10-gerenciar-telefones.js criar "Nome"\n');
    return;
  }

  r.data.forEach((t, i) => {
    const icon = { online:'🟢', conectando:'🟡', erro:'🔴', offline:'⚫' }[t.status] ?? '⚫';
    console.log(`\n${i+1}. ${icon} ${t.nome}`);
    info(`ID            : ${t.id}`);
    info(`Status        : ${t.status}`);
    info(`Número        : ${t.numero ?? 'não conectado'}`);
    info(`Sensibilidade : ${t.sensibilidade}`);
    info(`Pode iniciar  : ${t.configuracao.podeIniciarConversa}`);
    info(`Conv hoje/meta: ${t.configuracao.conversasRealizadasHoje}/${t.configuracao.quantidadeConversasDia}`);
    info(`Última conv.  : ${t.configuracao.ultimaConversaEm ? new Date(t.configuracao.ultimaConversaEm).toLocaleString('pt-BR') : 'nunca'}`);
    info(`Msgs enviadas : ${t.estatisticas.totalMensagensEnviadas}`);
    info(`Msgs recebidas: ${t.estatisticas.totalMensagensRecebidas}`);
    info(`Total conv.   : ${t.estatisticas.totalConversas}`);
  });
  console.log('');
}

async function criar(nome, conversasDia = 5, sensibilidade = 'media') {
  if (!nome) { console.log('❌ Nome obrigatório!\n   node tests/10-gerenciar-telefones.js criar "Nome"'); return; }
  console.log(`\n➕ CRIAR: "${nome}"\n` + '━'.repeat(50));
  const r = await req('POST', '/telefones', {
    nome,
    podeIniciarConversa: true,
    podeReceberMensagens: true,
    quantidadeConversasDia: Number(conversasDia),
    sensibilidade
  });
  if (!r.ok) { console.log(`❌ HTTP ${r.status} — ${JSON.stringify(r.data)}`); return; }
  console.log('✅ Criado!');
  info(`ID           : ${r.data.id}`);
  info(`Nome         : ${r.data.nome}`);
  info(`Sensibilidade: ${r.data.sensibilidade}`);
  info(`Conv/dia     : ${r.data.configuracao.quantidadeConversasDia}`);
  console.log(`\n💡 Próximo: node tests/7-conectar-whatsapp.js ${r.data.id}\n`);
}

async function ver(id) {
  if (!id) { console.log('❌ ID obrigatório!'); return; }
  console.log(`\n🔍 DETALHE: ${id}\n` + '━'.repeat(50));
  const [buscar, statusR] = await Promise.all([
    req('GET', `/telefones/${id}`),
    req('GET', `/telefones/${id}/status`)
  ]);
  if (!buscar.ok) { console.log(`❌ Não encontrado: ${r.message}`); return; }
  const t = buscar.data;
  const icon = { online:'🟢', conectando:'🟡', erro:'🔴', offline:'⚫' }[t.status] ?? '⚫';
  console.log(`${icon} ${t.nome}`);
  console.log('━'.repeat(50));
  info(`ID            : ${t.id}`);
  info(`Status        : ${t.status}`);
  info(`Número        : ${t.numero ?? 'não conectado'}`);
  info(`Sensibilidade : ${t.sensibilidade}`);
  info(`Pode iniciar  : ${t.configuracao.podeIniciarConversa}`);
  info(`Conv hoje/meta: ${t.configuracao.conversasRealizadasHoje}/${t.configuracao.quantidadeConversasDia}`);
  info(`Última conv.  : ${t.configuracao.ultimaConversaEm ? new Date(t.configuracao.ultimaConversaEm).toLocaleString('pt-BR') : 'nunca'}`);
  info(`Msgs enviadas : ${t.estatisticas.totalMensagensEnviadas}`);
  info(`Msgs recebidas: ${t.estatisticas.totalMensagensRecebidas}`);
  info(`Total conv.   : ${t.estatisticas.totalConversas}`);
  info(`Criado em     : ${new Date(t.criadoEm).toLocaleString('pt-BR')}`);
  if (statusR.ok) {
    console.log('\n🔌 Conexão WhatsApp:');
    info(`Session ativa : ${statusR.data.conectado}`);
    info(`QR disponível : ${statusR.data.temQRCode}`);
  }
  console.log('');
}

async function deletar(id) {
  if (!id) { console.log('❌ ID obrigatório!'); return; }
  console.log(`\n🗑️  DELETAR: ${id}\n` + '━'.repeat(50));
  const buscar = await req('GET', `/telefones/${id}`);
  if (!buscar.ok) { console.log('❌ Não encontrado!'); return; }
  console.log(`Telefone: ${buscar.data.nome} | Status: ${buscar.data.status}`);
  const r = await req('DELETE', `/telefones/${id}`);
  if (r.ok) { console.log(`✅ ${r.data.mensagem}`); } else { console.log(`❌ HTTP ${r.status}`); }
  console.log('');
}

async function desconectar(id) {
  if (!id) { console.log('❌ ID obrigatório!'); return; }
  console.log(`\n📴 DESCONECTAR: ${id}\n` + '━'.repeat(50));
  const r = await req('POST', `/telefones/${id}/desconectar`);
  if (r.ok) { console.log(`✅ ${r.data.mensagem}`); }
  else if (r.status === 404) { console.log('ℹ️  Não estava conectado'); }
  else { console.log(`❌ HTTP ${r.status}`); }
  console.log('');
}

async function ajuda() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       GERENCIAR TELEFONES              ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log('Comandos:\n');
  console.log('  listar                           → lista todos com detalhes');
  console.log('  criar "Nome" [conv-dia] [sens]   → cria telefone');
  console.log('    sens: baixa | media | alta (padrão: media)');
  console.log('    Exemplo: criar "Chip 1" 5 alta');
  console.log('  ver <id>                         → detalhes de um telefone');
  console.log('  deletar <id>                     → deleta telefone');
  console.log('  desconectar <id>                 → desconecta do WhatsApp\n');
}

async function main() {
  const [acao, ...args] = process.argv.slice(2);
  if (!acao || acao === 'ajuda') { await ajuda(); return; }
  if (acao === 'listar')       { await listar(); return; }
  if (acao === 'criar')        { await criar(args[0], args[1], args[2]); return; }
  if (acao === 'ver')          { await ver(args[0]); return; }
  if (acao === 'deletar')      { await deletar(args[0]); return; }
  if (acao === 'desconectar')  { await desconectar(args[0]); return; }
  console.log(`❌ Ação desconhecida: "${acao}"`);
  await ajuda();
}

main().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });

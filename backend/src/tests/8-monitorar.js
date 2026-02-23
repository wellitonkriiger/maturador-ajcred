// tests/8-monitorar.js
// Monitor em tempo real — atualiza o terminal a cada 5s
// Uso: node tests/8-monitorar.js
// Ctrl+C para parar

const axios = require('axios');

const API = 'http://localhost:3001/api';
const INTERVALO = 5000;

async function get(path) {
  try {
    const res = await axios.get(`${API}${path}`, { timeout: 8000 });
    return { ok: true, data: res.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function barra(valor, total, tamanho = 10) {
  const preenchido = Math.min(Math.floor((valor / Math.max(total, 1)) * tamanho), tamanho);
  return '█'.repeat(preenchido) + '░'.repeat(tamanho - preenchido);
}

async function renderizar() {
  console.clear();

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║            🤖 MONITOR DO MATURADOR               ║');
  console.log('║         Pressione Ctrl+C para parar              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\n🕐 ${new Date().toLocaleString('pt-BR')}\n`);

  const [statusR, telefonesR, ativasR] = await Promise.all([
    get('/maturacao/status'),
    get('/telefones'),
    get('/maturacao/conversas-ativas')
  ]);

  if (!statusR.ok) {
    console.log('❌ Servidor offline ou sem resposta');
    console.log(`   Erro: ${statusR.error}`);
    console.log('\n   Inicie o servidor: npm run dev\n');
    return;
  }

  const s = statusR.data;

  // STATUS
  console.log('━━━━━━━━━━ 📊 MATURAÇÃO ━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${s.emExecucao ? '🟢' : '⚫'} Em execução    : ${s.emExecucao ? 'SIM' : 'NÃO'}`);
  console.log(`  📅 Plano ativo   : ${s.planoAtivo ? 'SIM' : 'NÃO'}`);
  console.log(`  ${s.dentroHorario ? '✅' : '⏰'} Dentro horário : ${s.dentroHorario ? 'SIM' : 'NÃO'}`);
  if (s.proximoHorario) {
    console.log(`  🔜 Próximo início: ${new Date(s.proximoHorario).toLocaleString('pt-BR')}`);
  }

  // TELEFONES (resumo)
  console.log('\n━━━━━━━━━━ 📱 TELEFONES ━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Total: ${s.telefones.total}  |  Online: ${s.telefones.online}  |  Disponíveis: ${s.telefones.disponiveis}`);

  // TELEFONES (detalhes)
  if (telefonesR.ok && telefonesR.data.length > 0) {
    console.log('');
    telefonesR.data.forEach(t => {
      const icon = { online:'🟢', conectando:'🟡', erro:'🔴', offline:'⚫' }[t.status] ?? '⚫';
      const hoje = t.configuracao.conversasRealizadasHoje;
      const meta = t.configuracao.quantidadeConversasDia;
      console.log(`  ${icon} ${t.nome.padEnd(18)} ${t.status.padEnd(10)} ${t.numero ?? 'sem número'}`);
      console.log(`     [${barra(hoje, meta)}] ${hoje}/${meta} conversas hoje`);
    });
  } else {
    console.log('  Nenhum telefone cadastrado');
  }

  // CONVERSAS
  console.log('\n━━━━━━━━━━ 💬 CONVERSAS ━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Realizadas hoje: ${s.conversas.realizadasHoje}  |  Ativas agora: ${s.conversas.ativas}`);

  if (ativasR.ok && ativasR.data.length > 0) {
    console.log('');
    ativasR.data.forEach((c, i) => {
      console.log(`  ${i+1}. ${c.telefone} ↔ "${c.conversa}"`);
      console.log(`     [${barra(c.progresso, 100)}] ${c.progresso}%`);
    });
  }

  // COMANDOS
  console.log('\n━━━━━━━━━━ 💡 COMANDOS ÚTEIS ━━━━━━━━━━━━━━━━━━━━━');
  console.log('  node tests/9-controle-maturacao.js iniciar   → iniciar');
  console.log('  node tests/9-controle-maturacao.js parar     → parar');
  console.log('  node tests/7-conectar-whatsapp.js <ID>       → conectar chip');
  console.log(`\n  Atualizando em ${INTERVALO/1000}s...`);
}

async function main() {
  console.log('\n🚀 Iniciando monitor... (Ctrl+C para parar)\n');
  await renderizar();
  setInterval(renderizar, INTERVALO);
}

main().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });

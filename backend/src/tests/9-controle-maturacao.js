// tests/9-controle-maturacao.js
// Controla e diagnostica a maturação via terminal
//
// Uso:
//   node tests/9-controle-maturacao.js           → diagnóstico completo (padrão)
//   node tests/9-controle-maturacao.js iniciar   → inicia maturação
//   node tests/9-controle-maturacao.js parar     → para maturação

const axios = require('axios');
const API = 'http://localhost:3001/api';

async function req(method, path, body) {
  try {
    const res = await axios({ method, url: `${API}${path}`, data: body, timeout: 10000 });
    return { ok: true, status: res.status, data: res.data };
  } catch (e) {
    return { ok: false, status: e.response?.status, data: e.response?.data, message: e.message };
  }
}

async function diagnostico() {
  console.log('\n📊 DIAGNÓSTICO DO SISTEMA\n' + '━'.repeat(48));

  const [statusR, telefonesR, conversasR, ativasR, planoR] = await Promise.all([
    req('GET', '/maturacao/status'),
    req('GET', '/telefones'),
    req('GET', '/conversas'),
    req('GET', '/maturacao/conversas-ativas'),
    req('GET', '/maturacao/plano')
  ]);

  if (!statusR.ok) {
    console.log('❌ Servidor offline! Inicie com: npm run dev\n');
    return;
  }

  const s = statusR.data;
  const tels = telefonesR.ok ? telefonesR.data : [];
  const convs = conversasR.ok ? conversasR.data : [];
  const ativas = ativasR.ok ? ativasR.data : [];
  const plano = planoR.ok ? planoR.data : null;

  // STATUS MATURAÇÃO
  console.log('\n🤖 Maturação:');
  console.log(`   Em execução       : ${s.emExecucao ? '🟢 SIM' : '⚫ NÃO'}`);
  console.log(`   Plano ativo       : ${s.planoAtivo ? 'SIM' : 'NÃO'}`);
  console.log(`   Dentro do horário : ${s.dentroHorario ? 'SIM' : 'NÃO'}`);
  if (!s.dentroHorario && s.proximoHorario) {
    console.log(`   Próximo horário   : ${new Date(s.proximoHorario).toLocaleString('pt-BR')}`);
  }

  // PLANO
  if (plano) {
    console.log('\n📅 Plano:');
    console.log(`   Horário    : ${plano.horarioFuncionamento?.inicio} → ${plano.horarioFuncionamento?.fim}`);
    console.log(`   Dias       : [${plano.horarioFuncionamento?.diasSemana?.join(', ')}]`);
    console.log(`   Entre conv.: ${plano.intervalosGlobais?.entreConversas?.min}s - ${plano.intervalosGlobais?.entreConversas?.max}s`);
    console.log(`   Conv/tel/dia: ${plano.metas?.conversasPorTelefoneDia}`);
  }

  // TELEFONES
  console.log('\n📱 Telefones:');
  if (tels.length === 0) {
    console.log('   ⚠️  Nenhum telefone cadastrado');
  } else {
    tels.forEach(t => {
      const icon = { online:'🟢', conectando:'🟡', erro:'🔴', offline:'⚫' }[t.status] ?? '⚫';
      console.log(`   ${icon} [${t.id}] ${t.nome}`);
      console.log(`      status: ${t.status} | numero: ${t.numero ?? 'não conectado'}`);
      console.log(`      pode iniciar: ${t.configuracao.podeIniciarConversa} | conv hoje: ${t.configuracao.conversasRealizadasHoje}/${t.configuracao.quantidadeConversasDia}`);
      if (t.configuracao.ultimaConversaEm) {
        const ultima = new Date(t.configuracao.ultimaConversaEm);
        const decorrido = Math.floor((Date.now() - ultima) / 1000);
        console.log(`      última conv: ${ultima.toLocaleString('pt-BR')} (${decorrido}s atrás)`);
      }
    });
  }

  // CONVERSAS
  console.log(`\n💬 Conversas disponíveis: ${convs.length}`);
  convs.forEach(c => console.log(`   "${c.nome}" | ${c.participantesMinimos}-${c.participantesMaximos} participantes | usos: ${c.metadados?.vezesUsada ?? 0}`));

  // CONVERSAS ATIVAS
  if (ativas.length > 0) {
    console.log('\n🔥 Em andamento agora:');
    ativas.forEach((c, i) => console.log(`   ${i+1}. ${c.telefone} ↔ "${c.conversa}" — ${c.progresso}%`));
  }

  // PRÉ-REQUISITOS
  const online = tels.filter(t => t.status === 'online');
  const iniciadores = online.filter(t => t.configuracao.podeIniciarConversa);
  const disponiveis = tels.filter(t => {
    if (t.status !== 'online') return false;
    if (t.configuracao.conversasRealizadasHoje >= t.configuracao.quantidadeConversasDia) return false;
    return true;
  });

  console.log('\n🔍 PRÉ-REQUISITOS PARA MATURAR:');
  const checks = [
    { ok: tels.length >= 2,        msg: `≥2 telefones cadastrados (atual: ${tels.length})` },
    { ok: online.length >= 2,      msg: `≥2 telefones online (atual: ${online.length})` },
    { ok: iniciadores.length >= 1, msg: `≥1 pode iniciar conversa (atual: ${iniciadores.length})` },
    { ok: convs.length >= 1,       msg: `≥1 conversa cadastrada (atual: ${convs.length})` },
    { ok: s.dentroHorario,         msg: 'Dentro do horário de funcionamento' },
    { ok: s.planoAtivo,            msg: 'Plano ativo' },
  ];

  checks.forEach(c => console.log(`   ${c.ok ? '✅' : '❌'} ${c.msg}`));

  const pronto = checks.every(c => c.ok);
  console.log('');
  if (pronto) {
    console.log('✅ Sistema pronto para maturação!');
  } else {
    console.log('⚠️  Sistema NÃO está pronto — resolva os itens ❌ acima');
    if (online.length < 2) {
      console.log('\n   → Conecte telefones:');
      console.log('     node tests/7-conectar-whatsapp.js <ID>');
    }
    if (convs.length < 1) {
      console.log('\n   → Adicione conversas em backend/data/conversas/');
      console.log('     node tests/11-gerenciar-conversas.js recarregar');
    }
    if (!s.planoAtivo) {
      console.log('\n   → Ativar plano:');
      console.log('     node tests/9-controle-maturacao.js iniciar  (ativa automaticamente)');
    }
  }
  console.log('');
}

async function iniciar() {
  console.log('\n🚀 INICIANDO MATURAÇÃO\n' + '━'.repeat(48));

  // Ativar plano se necessário
  const plano = await req('GET', '/maturacao/plano');
  if (plano.ok && !plano.data.ativo) {
    console.log('📅 Ativando plano automaticamente...');
    await req('POST', '/maturacao/plano/toggle', { ativo: true });
    console.log('   ✅ Ativo\n');
  }

  const r = await req('POST', '/maturacao/iniciar');
  if (r.ok) {
    console.log(`✅ ${r.data.mensagem}`);
    console.log('\n   Use "node tests/8-monitorar.js" para acompanhar em tempo real');
    console.log('   Use "node tests/9-controle-maturacao.js parar" para parar\n');
  } else if (r.status === 400) {
    console.log(`ℹ️  ${r.data?.erro}`);
    console.log('   (Verifique se já não está em execução)\n');
  } else {
    console.log(`❌ HTTP ${r.status} — ${JSON.stringify(r.data)}\n`);
  }
}

async function parar() {
  console.log('\n⏸️  PARANDO MATURAÇÃO\n' + '━'.repeat(48));
  const r = await req('POST', '/maturacao/parar');
  if (r.ok) {
    console.log(`✅ ${r.data.mensagem}\n`);
  } else if (r.status === 400) {
    console.log(`ℹ️  ${r.data?.erro}\n`);
  } else {
    console.log(`❌ HTTP ${r.status} — ${JSON.stringify(r.data)}\n`);
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║        CONTROLE DA MATURAÇÃO           ║');
  console.log('╚════════════════════════════════════════╝');

  const acao = process.argv[2] ?? 'diagnostico';

  if (acao === 'iniciar')    { await iniciar(); await diagnostico(); }
  else if (acao === 'parar') { await parar(); await diagnostico(); }
  else                       { await diagnostico(); }

  console.log('Comandos disponíveis:');
  console.log('  node tests/9-controle-maturacao.js              → diagnóstico');
  console.log('  node tests/9-controle-maturacao.js iniciar      → iniciar');
  console.log('  node tests/9-controle-maturacao.js parar        → parar\n');
}

main().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });

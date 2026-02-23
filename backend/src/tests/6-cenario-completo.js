// tests/6-cenario-completo.js
// Simula fluxo real: criar telefones, configurar plano, iniciar, monitorar, parar, limpar

const axios = require('axios');
const API = 'http://localhost:3001/api';

function ok(msg)   { console.log(`   ✅ ${msg}`); }
function fail(msg) { console.log(`   ❌ ${msg}`); }
function info(msg) { console.log(`   ℹ️  ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function req(method, path, body) {
  try {
    const res = await axios({ method, url: `${API}${path}`, data: body, timeout: 10000 });
    return { ok: true, status: res.status, data: res.data };
  } catch (e) {
    return { ok: false, status: e.response?.status, data: e.response?.data, message: e.message };
  }
}

async function testarCenario() {
  console.log('\n🧪 TESTE 6: Cenário Completo');
  console.log('═══════════════════════════════════════\n');

  const ids = [];
  let passou = true;

  try {
    // 1. CRIAR TELEFONES
    console.log('➕ 1. Criando 2 telefones de teste...');
    for (let i = 1; i <= 2; i++) {
      const r = await req('POST', '/telefones', {
        nome: `Cenario_${i}_${Date.now()}`,
        podeIniciarConversa: i === 1,
        podeReceberMensagens: true,
        quantidadeConversasDia: 5,
        sensibilidade: i === 1 ? 'alta' : 'media'
      });
      if (r.ok) {
        ids.push(r.data.id);
        ok(`Telefone ${i}: ${r.data.id} | pode iniciar: ${r.data.configuracao.podeIniciarConversa}`);
      } else {
        fail(`Falha tel ${i}: ${JSON.stringify(r.data)}`); passou = false;
      }
    }
    console.log('');

    // 2. LISTAR
    console.log('📋 2. Verificando telefones cadastrados...');
    const lista = await req('GET', '/telefones');
    if (lista.ok) {
      ok(`Total: ${lista.data.length} | Online: ${lista.data.filter(t => t.status === 'online').length}`);
      info('⚠️  Nenhum conectado ao WhatsApp — esperado neste teste');
    }
    console.log('');

    // 3. CONVERSAS DISPONÍVEIS
    console.log('💬 3. Conversas disponíveis...');
    const convs = await req('GET', '/conversas');
    if (convs.ok) {
      ok(`${convs.data.length} conversa(s)`);
      convs.data.forEach(c => info(`"${c.nome}" — ${c.participantesMinimos}-${c.participantesMaximos} participantes`));
    }
    console.log('');

    // 4. CONFIGURAR PLANO (24h para teste)
    console.log('⚙️  4. Configurando plano 24h...');
    const conf = await req('PUT', '/maturacao/plano', {
      horarioFuncionamento: { inicio: '00:00', fim: '23:59', diasSemana: [0,1,2,3,4,5,6] },
      intervalosGlobais: { entreConversas: { min: 10, max: 30 } },
      metas: { conversasPorTelefoneDia: 5 }
    });
    if (conf.ok) { ok('Plano 24h configurado'); } else { fail(`HTTP ${conf.status}`); passou = false; }
    console.log('');

    // 5. ATIVAR
    console.log('🟢 5. Ativando plano...');
    const ativar = await req('POST', '/maturacao/plano/toggle', { ativo: true });
    if (ativar.ok) { ok(`ativo: ${ativar.data.ativo}`); } else { fail('Falha'); passou = false; }
    console.log('');

    // 6. INICIAR
    console.log('🚀 6. Iniciando maturação...');
    const iniciar = await req('POST', '/maturacao/iniciar');
    if (iniciar.ok) {
      ok(iniciar.data.mensagem);
    } else if (iniciar.status === 400) {
      info(`Resposta: ${iniciar.data?.erro}`);
    } else {
      fail(`HTTP ${iniciar.status}`); passou = false;
    }
    console.log('');

    // 7. MONITORAR 5s
    console.log('📊 7. Monitorando 5 segundos...');
    for (let i = 1; i <= 5; i++) {
      await sleep(1000);
      const s = await req('GET', '/maturacao/status');
      if (s.ok) {
        process.stdout.write(`\r   [${i}s] execução: ${s.data.emExecucao} | conv.ativas: ${s.data.conversas.ativas} | online: ${s.data.telefones.online}`);
      }
    }
    console.log('\n');
    ok('Monitoramento concluído');
    console.log('');

    // 8. PARAR
    console.log('⏸️  8. Parando...');
    const parar = await req('POST', '/maturacao/parar');
    if (parar.ok) { ok(parar.data.mensagem); } else if (parar.status === 400) { info(parar.data?.erro); } else { fail(`HTTP ${parar.status}`); passou = false; }
    console.log('');

    // 9. DESATIVAR
    console.log('🔴 9. Desativando plano...');
    await req('POST', '/maturacao/plano/toggle', { ativo: false });
    ok('Desativado');
    console.log('');

  } finally {
    // 10. LIMPAR
    if (ids.length > 0) {
      console.log(`🧹 10. Limpando ${ids.length} telefone(s) de teste...`);
      for (const id of ids) {
        const d = await req('DELETE', `/telefones/${id}`);
        if (d.ok) { ok(`Deletado: ${id}`); } else { info(`Não deletado ${id}: ${d.message}`); }
      }
      console.log('');
    }
  }

  console.log('═══════════════════════════════════════');
  if (passou) {
    console.log('✅ CENÁRIO COMPLETO PASSOU!\n');
    console.log('💡 PRÓXIMOS PASSOS REAIS:');
    console.log('   node tests/7-conectar-whatsapp.js --criar "Nome do Chip"');
    console.log('   node tests/7-conectar-whatsapp.js <ID>');
    console.log('   node tests/8-monitorar.js');
    console.log('   node tests/9-controle-maturacao.js iniciar\n');
  } else {
    console.log('⚠️  ALGUNS PASSOS FALHARAM — veja os erros acima\n');
  }
  return passou;
}

testarCenario();

// tests/3-conversas.js
// Testa CRUD de conversas

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

async function testarConversas() {
  console.log('\n🧪 TESTE 3: Gerenciamento de Conversas');
  console.log('═══════════════════════════════════════\n');

  let passou = true;
  let idImportada = null;

  // 1. LISTAR
  console.log('📋 1. Listando conversas...');
  const lista = await req('GET', '/conversas');
  if (lista.ok) {
    ok(`${lista.data.length} conversa(s) encontrada(s)`);
    lista.data.forEach((c, i) => {
      info(`${i+1}. [${c.id}] "${c.nome}" | ${c.mensagens?.length ?? 0} msgs | usos: ${c.metadados?.vezesUsada ?? 0}`);
    });
  } else {
    fail(`Falha: ${lista.message}`); passou = false;
  }
  console.log('');

  // 2. BUSCAR POR ID
  if (lista.ok && lista.data.length > 0) {
    const primeira = lista.data[0];
    console.log(`🔍 2. Buscando: ${primeira.id}...`);
    const buscar = await req('GET', `/conversas/${primeira.id}`);
    if (buscar.ok) {
      ok('Encontrada!');
      info(`ID           : ${buscar.data.id}`);
      info(`Nome         : ${buscar.data.nome}`);
      info(`Categoria    : ${buscar.data.categoria}`);
      info(`Participantes: ${buscar.data.participantesMinimos}-${buscar.data.participantesMaximos}`);
      info(`Mensagens    : ${buscar.data.mensagens.length}`);
      buscar.data.mensagens.forEach(m => {
        if (m.tipo === 'pausa_longa') {
          info(`  ⏸  Pausa: ${m.duracao.min}-${m.duracao.max}s`);
        } else {
          info(`  💬 #${m.ordem} rem[${m.remetente}]: "${m.texto}"`);
        }
      });
    } else {
      fail(`HTTP ${buscar.status}`); passou = false;
    }
    console.log('');
  }

  // 3. IMPORTAR
  const novoId = `conv_teste_${Date.now()}`;
  console.log(`📥 3. Importando conversa: ${novoId}...`);
  const importar = await req('POST', '/conversas/importar', {
    id: novoId,
    nome: 'Conversa Teste Automatizado',
    categoria: 'teste',
    tags: ['teste'],
    participantesMinimos: 2,
    participantesMaximos: 2,
    duracaoEstimada: '1 minuto',
    mensagens: [
      { ordem: 1, remetente: 0, texto: 'Teste A', delay: { min: 1, max: 2 },
        comportamento: { marcarComoLida: false, tempoAntesLeitura: { min: 1, max: 1 }, simularDigitacao: false, tempoDigitacao: { min: 1, max: 1 } }
      },
      { ordem: 2, remetente: 1, texto: 'Teste B', delay: { min: 1, max: 2 },
        comportamento: { marcarComoLida: false, tempoAntesLeitura: { min: 1, max: 1 }, simularDigitacao: false, tempoDigitacao: { min: 1, max: 1 } }
      }
    ],
    metadados: { criadaPor: 'teste', vezesUsada: 0, ultimoUso: null, efetividade: null }
  });
  if (importar.ok) {
    idImportada = importar.data.id;
    ok(`Importada! ID: ${importar.data.id}`);
  } else {
    fail(`HTTP ${importar.status} — ${JSON.stringify(importar.data)}`); passou = false;
  }
  console.log('');

  // 4. RECARREGAR
  console.log('🔄 4. Recarregando do disco...');
  const recarregar = await req('POST', '/conversas/recarregar');
  if (recarregar.ok) {
    ok(`${recarregar.data.mensagem} — total: ${recarregar.data.total}`);
  } else {
    fail(`HTTP ${recarregar.status}`); passou = false;
  }
  console.log('');

  // 5. DELETAR
  if (idImportada) {
    console.log(`🗑️  5. Deletando ${idImportada}...`);
    const deletar = await req('DELETE', `/conversas/${idImportada}`);
    if (deletar.ok) {
      ok(deletar.data.mensagem);
    } else {
      fail(`HTTP ${deletar.status}`); passou = false;
    }
    console.log('');
  }

  console.log(passou ? '✅ TODOS OS TESTES PASSARAM!\n' : '⚠️  ALGUNS TESTES FALHARAM!\n');
  return passou;
}

testarConversas();

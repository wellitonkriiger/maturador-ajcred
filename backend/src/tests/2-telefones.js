// tests/2-telefones.js
// Testa CRUD completo de telefones

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

async function testarTelefones() {
  console.log('\n🧪 TESTE 2: Gerenciamento de Telefones');
  console.log('═══════════════════════════════════════\n');

  let passou = true;
  let telefoneId = null;

  // 1. LISTAR
  console.log('📋 1. Listando telefones existentes...');
  const lista = await req('GET', '/telefones');
  if (lista.ok) {
    ok(`${lista.data.length} telefone(s) cadastrado(s)`);
    lista.data.forEach(t => {
      info(`${t.id} | ${t.nome} | status: ${t.status} | numero: ${t.numero ?? 'sem número'}`);
    });
  } else {
    fail(`Falha: ${lista.message}`); passou = false;
  }
  console.log('');

  // 2. CRIAR
  console.log('➕ 2. Criando telefone de teste...');
  const criar = await req('POST', '/telefones', {
    nome: `Teste_${Date.now()}`,
    podeIniciarConversa: true,
    podeReceberMensagens: true,
    quantidadeConversasDia: 5,
    sensibilidade: 'media'
  });
  if (criar.ok) {
    telefoneId = criar.data.id;
    ok('Criado!');
    info(`ID          : ${criar.data.id}`);
    info(`Nome        : ${criar.data.nome}`);
    info(`Status      : ${criar.data.status}`);
    info(`Sensibilidade: ${criar.data.sensibilidade}`);
    info(`Pode iniciar: ${criar.data.configuracao.podeIniciarConversa}`);
    info(`Conv/dia    : ${criar.data.configuracao.quantidadeConversasDia}`);
  } else {
    fail(`HTTP ${criar.status} — ${JSON.stringify(criar.data)}`); passou = false;
  }
  console.log('');

  if (!telefoneId) { fail('Sem ID, pulando testes dependentes'); return false; }

  // 3. BUSCAR POR ID
  console.log('🔍 3. Buscando por ID...');
  const buscar = await req('GET', `/telefones/${telefoneId}`);
  if (buscar.ok) {
    ok('Encontrado!');
    info(`Nome   : ${buscar.data.nome}`);
    info(`Status : ${buscar.data.status}`);
    info(`Criado : ${buscar.data.criadoEm}`);
  } else {
    fail(`HTTP ${buscar.status} — ${JSON.stringify(buscar.data)}`); passou = false;
  }
  console.log('');

  // 4. ATUALIZAR
  console.log('♻️  4. Atualizando...');
  const atualizar = await req('PUT', `/telefones/${telefoneId}`, {
    nome: `Teste_Atualizado_${Date.now()}`,
    sensibilidade: 'alta'
  });
  if (atualizar.ok) {
    ok('Atualizado!');
    info(`Novo nome        : ${atualizar.data.nome}`);
    info(`Nova sensibilidade: ${atualizar.data.sensibilidade}`);
    info(`Atualizado em   : ${atualizar.data.atualizadoEm}`);
  } else {
    fail(`HTTP ${atualizar.status}`); passou = false;
  }
  console.log('');

  // 5. STATUS CONEXÃO
  console.log('📊 5. Status de conexão...');
  const status = await req('GET', `/telefones/${telefoneId}/status`);
  if (status.ok) {
    ok('Status obtido!');
    info(`Telefone  : ${status.data.telefone}`);
    info(`Status    : ${status.data.status}`);
    info(`Conectado : ${status.data.conectado}`);
    info(`Tem QR    : ${status.data.temQRCode}`);
    info(`Número    : ${status.data.numero ?? 'sem número'}`);
  } else {
    fail(`HTTP ${status.status}`); passou = false;
  }
  console.log('');

  // 6. DELETAR
  console.log('🗑️  6. Deletando...');
  const deletar = await req('DELETE', `/telefones/${telefoneId}`);
  if (deletar.ok) {
    ok(deletar.data.mensagem);
  } else {
    fail(`HTTP ${deletar.status}`); passou = false;
  }
  console.log('');

  // 7. CONFIRMAR DELEÇÃO
  console.log('✔️  7. Confirmando deleção...');
  const confirmar = await req('GET', `/telefones/${telefoneId}`);
  if (confirmar.status === 404) {
    ok('404 confirmado — deletado com sucesso');
  } else if (confirmar.ok) {
    fail('Telefone ainda existe!'); passou = false;
  }
  console.log('');

  console.log(passou ? '✅ TODOS OS TESTES PASSARAM!\n' : '⚠️  ALGUNS TESTES FALHARAM!\n');
  return passou;
}

testarTelefones();

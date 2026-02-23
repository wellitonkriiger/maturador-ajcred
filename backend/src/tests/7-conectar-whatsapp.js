// tests/7-conectar-whatsapp.js
// Conecta um telefone ao WhatsApp via API e monitora até ficar online
//
// Uso:
//   node tests/7-conectar-whatsapp.js                        → lista telefones disponíveis
//   node tests/7-conectar-whatsapp.js <ID>                   → conecta telefone existente
//   node tests/7-conectar-whatsapp.js --criar "Nome"         → cria e conecta
//   node tests/7-conectar-whatsapp.js --criar "Nome" <conv-dia> <sensibilidade>

const axios = require('axios');
const API = 'http://localhost:3001/api';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function req(method, path, body) {
  try {
    const res = await axios({ method, url: `${API}${path}`, data: body, timeout: 15000 });
    return { ok: true, status: res.status, data: res.data };
  } catch (e) {
    return { ok: false, status: e.response?.status, data: e.response?.data, message: e.message };
  }
}

async function listar() {
  console.log('\n📋 Telefones cadastrados:\n');
  const r = await req('GET', '/telefones');

  if (!r.ok) { console.log('❌ Erro ao listar:', r.message); return null; }

  if (r.data.length === 0) {
    console.log('  Nenhum telefone cadastrado.\n');
    console.log('  Para criar e conectar:');
    console.log('    node tests/7-conectar-whatsapp.js --criar "Nome do Chip"\n');
    return null;
  }

  r.data.forEach((t, i) => {
    const icon = { online:'🟢', conectando:'🟡', erro:'🔴', offline:'⚫' }[t.status] ?? '⚫';
    console.log(`  ${i+1}. ${icon} [${t.id}] ${t.nome}`);
    console.log(`      status: ${t.status} | numero: ${t.numero ?? 'não conectado'}`);
  });

  console.log('\n  Para conectar um telefone:');
  console.log(`    node tests/7-conectar-whatsapp.js ${r.data[0].id}\n`);
  return null;
}

async function criarTelefone(nome, conversasDia = 5, sensibilidade = 'media') {
  console.log(`\n➕ Criando telefone: "${nome}"...`);
  const r = await req('POST', '/telefones', {
    nome,
    podeIniciarConversa: true,
    podeReceberMensagens: true,
    quantidadeConversasDia: Number(conversasDia),
    sensibilidade
  });
  if (!r.ok) { console.log(`❌ Falha ao criar: ${JSON.stringify(r.data)}`); return null; }
  console.log(`✅ Criado! ID: ${r.data.id}`);
  return r.data.id;
}

async function conectar(telefoneId) {
  console.log(`\n🔌 Conectando telefone ${telefoneId}...`);

  // Verificar existência
  const buscar = await req('GET', `/telefones/${telefoneId}`);
  if (!buscar.ok) {
    console.log(`❌ Telefone ${telefoneId} não encontrado`);
    console.log('   Use sem argumentos para ver os cadastrados\n');
    return;
  }

  console.log(`   Nome  : ${buscar.data.nome}`);
  console.log(`   Status: ${buscar.data.status}`);

  if (buscar.data.status === 'online') {
    console.log('\n✅ Telefone já está ONLINE!');
    console.log(`   Número: ${buscar.data.numero}\n`);
    return;
  }

  // Disparar conexão
  console.log('\n🚀 Disparando conexão...');
  const conectar = await req('POST', `/telefones/${telefoneId}/conectar`);
  if (!conectar.ok) {
    console.log(`❌ Falha: HTTP ${conectar.status} — ${JSON.stringify(conectar.data)}`);
    return;
  }
  console.log(`✅ ${conectar.data.mensagem}`);
  console.log('\n📱 QR Code será exibido aqui e no terminal do servidor (npm run dev)');
  console.log('⏳ Aguardando QR Code...\n');

  // Polling por até 120s
  const MAX = 40;
  let tentativa = 0;
  let ultimoStatus = '';

  while (tentativa < MAX) {
    await sleep(3000);
    tentativa++;

    const status = await req('GET', `/telefones/${telefoneId}/status`);
    if (!status.ok) {
      process.stdout.write(`\r   [${tentativa}/${MAX}] Erro ao verificar...`);
      continue;
    }

    const s = status.data.status;
    const temQR = status.data.temQRCode;

    if (s === 'online') {
      console.log('');
      console.log(`\n✅ CONECTADO COM SUCESSO!`);
      console.log(`   Número: ${status.data.numero}`);
      console.log(`   ID    : ${telefoneId}`);
      console.log('\n💡 Próximos passos:');
      console.log('   node tests/7-conectar-whatsapp.js <ID_DO_OUTRO_CHIP>  → conectar 2º telefone');
      console.log('   node tests/8-monitorar.js                              → monitorar sistema');
      console.log('   node tests/9-controle-maturacao.js iniciar             → iniciar maturação\n');
      return;
    }

    if (s === 'erro') {
      console.log('');
      console.log(`\n❌ Falha na conexão! Status: ${s}`);
      console.log('   Verifique os logs do servidor para detalhes\n');
      return;
    }

    if (s !== ultimoStatus || (temQR && ultimoStatus !== 'conectando_com_qr')) {
      console.log('');
      if (temQR) {
        console.log(`   [${tentativa}/${MAX}] 📱 QR Code disponível! Escaneie no terminal do servidor`);
        console.log('   Aguardando escaneamento...');
        ultimoStatus = 'conectando_com_qr';
      } else {
        console.log(`   [${tentativa}/${MAX}] Status: ${s}`);
        ultimoStatus = s;
      }
    } else {
      process.stdout.write(`\r   [${tentativa}/${MAX}] ${s}${temQR ? ' — aguardando escaneamento do QR' : ''}...`);
    }
  }

  console.log('');
  console.log('❌ Timeout! Não conectou em 120s');
  console.log('   Verifique os logs do servidor para identificar o problema\n');
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      CONECTAR TELEFONE AO WHATSAPP     ║');
  console.log('╚════════════════════════════════════════╝');

  const args = process.argv.slice(2);

  if (args[0] === '--criar') {
    const id = await criarTelefone(args[1], args[2], args[3]);
    if (id) await conectar(id);
    return;
  }

  if (args[0] && !args[0].startsWith('-')) {
    await conectar(args[0]);
    return;
  }

  await listar();
}

main().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });

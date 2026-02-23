// tests/run-all-tests.js
// Executa os testes 1-6 em sequência (testes básicos de API)
// Os scripts 7-11 são para uso interativo, não são executados aqui

const { spawn } = require('child_process');
const path = require('path');

const testes = [
  { arquivo: '1-health-check.js',    nome: 'Health Check' },
  { arquivo: '2-telefones.js',       nome: 'CRUD Telefones' },
  { arquivo: '3-conversas.js',       nome: 'CRUD Conversas' },
  { arquivo: '4-plano-maturacao.js', nome: 'Plano de Maturação' },
  { arquivo: '5-status-maturacao.js',nome: 'Status Maturação' },
  { arquivo: '6-cenario-completo.js',nome: 'Cenário Completo' },
];

let passados = 0, falhados = 0;

function executarTeste(arquivo) {
  return new Promise((resolve) => {
    const proc = spawn('node', [path.join(__dirname, arquivo)], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) { passados++; resolve(true); }
      else            { falhados++; resolve(false); }
    });
  });
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  EXECUTANDO TODOS OS TESTES DO BACKEND ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log('Certifique-se que o servidor está rodando: npm run dev\n');

  for (let i = 0; i < testes.length; i++) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`[${i+1}/${testes.length}] ${testes[i].nome}`);
    console.log('─'.repeat(50));
    await executarTeste(testes[i].arquivo);
    if (i < testes.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║              RESUMO                    ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log(`✅ Passados: ${passados}/${testes.length}`);
  console.log(`❌ Falhados: ${falhados}/${testes.length}\n`);

  if (falhados === 0) {
    console.log('🎉 TODOS OS TESTES PASSARAM! API funcionando corretamente.\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 SCRIPTS PARA TRABALHO REAL:\n');
    console.log('  CONECTAR TELEFONE:');
    console.log('    node tests/7-conectar-whatsapp.js                   → listar telefones');
    console.log('    node tests/7-conectar-whatsapp.js --criar "Chip 1"  → criar e conectar');
    console.log('    node tests/7-conectar-whatsapp.js <ID>              → conectar existente\n');
    console.log('  MONITORAR:');
    console.log('    node tests/8-monitorar.js                           → monitor em tempo real\n');
    console.log('  CONTROLAR MATURAÇÃO:');
    console.log('    node tests/9-controle-maturacao.js                  → diagnóstico completo');
    console.log('    node tests/9-controle-maturacao.js iniciar          → iniciar');
    console.log('    node tests/9-controle-maturacao.js parar            → parar\n');
    console.log('  GERENCIAR:');
    console.log('    node tests/10-gerenciar-telefones.js listar         → listar telefones');
    console.log('    node tests/11-gerenciar-conversas.js listar         → listar conversas');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } else {
    console.log('⚠️  ALGUNS TESTES FALHARAM — corrija os erros acima antes de prosseguir\n');
  }
}

main().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });

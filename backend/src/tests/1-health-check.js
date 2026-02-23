// tests/1-health-check.js
// Verifica se o servidor está online e respondendo

const axios = require('axios');

const API_URL = 'http://localhost:3001';

async function testarHealthCheck() {
  console.log('\n🧪 TESTE 1: Health Check');
  console.log('═══════════════════════════════════════\n');

  try {
    console.log(`🌐 Conectando em ${API_URL}/health ...`);
    const response = await axios.get(`${API_URL}/health`, { timeout: 5000 });

    console.log('✅ Servidor está online!');
    console.log(`   status    : ${response.data.status}`);
    console.log(`   timestamp : ${response.data.timestamp}`);
    console.log(`   HTTP      : ${response.status}`);

    console.log('\n🌐 Testando /api/telefones...');
    try {
      const r2 = await axios.get(`${API_URL}/api/telefones`, { timeout: 5000 });
      console.log(`   ✅ /api/telefones respondendo (HTTP ${r2.status}) — ${r2.data.length} telefone(s)`);
    } catch (e) {
      if (e.response) {
        console.log(`   ✅ /api/telefones respondendo (HTTP ${e.response.status})`);
      } else {
        console.log(`   ❌ /api/telefones sem resposta: ${e.message}`);
      }
    }

    console.log('\n✅ TESTE PASSOU!\n');
    return true;

  } catch (error) {
    console.log('\n❌ TESTE FALHOU!');
    if (error.code === 'ECONNREFUSED') {
      console.log('   Causa   : Servidor não está rodando');
      console.log('   Solução : Execute  npm run dev  na pasta backend/');
    } else if (error.code === 'ETIMEDOUT') {
      console.log('   Causa   : Timeout — servidor não respondeu em 5s');
    } else {
      console.log(`   Erro    : ${error.message}`);
    }
    console.log('');
    return false;
  }
}

testarHealthCheck();

// src/routes/index.js

const express = require('express');
const router = express.Router();

const TelefoneController = require('../controllers/telefoneController');
const ConversaController = require('../controllers/conversaController');
const MaturacaoController = require('../controllers/maturacaoController');
const LogController = require('../controllers/logController');
const PainelController = require('../controllers/painelController');

// ===== ROTAS DE PAINEL =====
router.get('/painel/snapshot', PainelController.snapshot);

// ===== ROTAS DE TELEFONES =====
router.get('/telefones', TelefoneController.listar);
router.get('/telefones/:id', TelefoneController.buscarPorId);
router.post('/telefones', TelefoneController.criar);
router.put('/telefones/:id', TelefoneController.atualizar);
router.delete('/telefones/:id', TelefoneController.deletar);

// Conexão WhatsApp
router.post('/telefones/:id/conectar', TelefoneController.conectar);
router.post('/telefones/:id/desconectar', TelefoneController.desconectar);
router.post('/telefones/:id/reconectar', TelefoneController.reconectar);
router.post('/telefones/:id/cancelar-conexao', TelefoneController.cancelarTentativaConexao);
router.get('/telefones/:id/qrcode', TelefoneController.obterQRCode);
router.get('/telefones/:id/status', TelefoneController.statusConexao);

// ===== ROTAS DE CONVERSAS =====
router.get('/conversas', ConversaController.listar);
router.get('/conversas/:id', ConversaController.buscarPorId);
router.post('/conversas/importar', ConversaController.importar);
router.post('/conversas/validar', ConversaController.validar);
router.put('/conversas/:id', ConversaController.atualizar);
router.delete('/conversas/:id', ConversaController.deletar);
router.post('/conversas/recarregar', ConversaController.recarregar);

// ===== ROTAS DE MATURAÇÃO =====
router.get('/maturacao/status', MaturacaoController.status);
router.post('/maturacao/iniciar', MaturacaoController.iniciar);
router.post('/maturacao/parar', MaturacaoController.parar);
router.get('/maturacao/conversas-ativas', MaturacaoController.conversasAtivas);

// Plano de maturação
router.get('/maturacao/plano', MaturacaoController.obterPlano);
router.put('/maturacao/plano', MaturacaoController.atualizarPlano);
router.post('/maturacao/plano/toggle', MaturacaoController.togglePlano);

// ===== ROTAS DE LOGS =====
router.get('/logs/files', LogController.listarArquivos);
router.get('/logs', LogController.listar);

module.exports = router;

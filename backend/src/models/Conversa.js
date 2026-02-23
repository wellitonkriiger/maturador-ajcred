// src/models/Conversa.js

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class ConversaModel {
  constructor() {
    this.conversasDir = path.join(__dirname, '../../data/conversas');
    this.conversas = [];
    this.inicializar();
  }

  /**
   * Inicializa diretório e carrega conversas
   */
  inicializar() {
    // Criar diretório se não existir
    if (!fs.existsSync(this.conversasDir)) {
      fs.mkdirSync(this.conversasDir, { recursive: true });
      logger.info('📁 Diretório de conversas criado');
      
      // Criar conversa exemplo
      this.criarConversaExemplo();
    }

    this.carregar();
  }

  /**
   * Cria conversa de exemplo
   */
  criarConversaExemplo() {
    const exemplo = {
      id: 'conv_exemplo_001',
      nome: 'Churrasco no Fim de Semana',
      categoria: 'social',
      tags: ['lazer', 'comida', 'amigos'],
      participantesMinimos: 2,
      participantesMaximos: 2,
      duracaoEstimada: '10-15 minutos',
      mensagens: [
        {
          ordem: 1,
          remetente: 0,
          texto: 'E aí, bora marcar aquele churrasco no sábado?',
          delay: { min: 2, max: 5 },
          comportamento: {
            marcarComoLida: true,
            tempoAntesLeitura: { min: 1, max: 3 },
            simularDigitacao: true,
            tempoDigitacao: { min: 2, max: 4 }
          }
        },
        {
          ordem: 2,
          remetente: 1,
          texto: 'Bora sim! Que horas vc tá pensando?',
          delay: { min: 3, max: 7 },
          comportamento: {
            marcarComoLida: true,
            tempoAntesLeitura: { min: 1, max: 2 },
            simularDigitacao: true,
            tempoDigitacao: { min: 3, max: 5 }
          }
        },
        {
          ordem: 3,
          remetente: 0,
          texto: 'Umas 15h tá bom? Assim dá tempo de preparar tudo',
          delay: { min: 2, max: 4 },
          comportamento: {
            marcarComoLida: true,
            tempoAntesLeitura: { min: 1, max: 3 },
            simularDigitacao: true,
            tempoDigitacao: { min: 2, max: 4 }
          }
        },
        {
          ordem: 4,
          tipo: 'pausa_longa',
          duracao: { min: 180, max: 300 }
        },
        {
          ordem: 5,
          remetente: 1,
          texto: 'Perfeito! Vou levar as bebidas 🍺',
          delay: { min: 4, max: 8 },
          comportamento: {
            marcarComoLida: true,
            tempoAntesLeitura: { min: 2, max: 4 },
            simularDigitacao: true,
            tempoDigitacao: { min: 3, max: 5 }
          }
        },
        {
          ordem: 6,
          remetente: 0,
          texto: 'Massa! Eu cuido da carne e do carvão',
          delay: { min: 2, max: 5 },
          comportamento: {
            marcarComoLida: true,
            tempoAntesLeitura: { min: 1, max: 3 },
            simularDigitacao: true,
            tempoDigitacao: { min: 2, max: 4 }
          }
        },
        {
          ordem: 7,
          remetente: 1,
          texto: 'Fechou então! Até sábado 👍',
          delay: { min: 3, max: 6 },
          comportamento: {
            marcarComoLida: true,
            tempoAntesLeitura: { min: 1, max: 2 },
            simularDigitacao: true,
            tempoDigitacao: { min: 2, max: 3 }
          }
        }
      ],
      metadados: {
        criadaPor: 'sistema',
        vezesUsada: 0,
        ultimoUso: null,
        efetividade: null
      }
    };

    const arquivo = path.join(this.conversasDir, 'conv_exemplo_001.json');
    fs.writeFileSync(arquivo, JSON.stringify(exemplo, null, 2), 'utf8');
    logger.info('📝 Conversa de exemplo criada');
  }

  /**
   * Carrega todas as conversas do diretório
   */
  carregar() {
    try {
      const arquivos = fs.readdirSync(this.conversasDir);
      this.conversas = [];

      arquivos.forEach(arquivo => {
        if (arquivo.endsWith('.json')) {
          try {
            const caminhoCompleto = path.join(this.conversasDir, arquivo);
            const data = fs.readFileSync(caminhoCompleto, 'utf8');
            const conversa = JSON.parse(data);
            this.conversas.push(conversa);
          } catch (error) {
            logger.error(`❌ Erro ao carregar ${arquivo}:`, error.message);
          }
        }
      });

      logger.info(`💬 ${this.conversas.length} conversas carregadas`);
    } catch (error) {
      logger.error('❌ Erro ao carregar conversas:', error);
      this.conversas = [];
    }
  }

  /**
   * Lista todas as conversas
   */
  listar() {
    return this.conversas;
  }

  /**
   * Busca conversa por ID
   */
  buscarPorId(id) {
    return this.conversas.find(c => c.id === id);
  }

  /**
   * Salva conversa em arquivo
   */
  salvar(conversa) {
    try {
      const arquivo = path.join(this.conversasDir, `${conversa.id}.json`);
      fs.writeFileSync(arquivo, JSON.stringify(conversa, null, 2), 'utf8');
      
      // Atualizar array em memória
      const index = this.conversas.findIndex(c => c.id === conversa.id);
      if (index !== -1) {
        this.conversas[index] = conversa;
      } else {
        this.conversas.push(conversa);
      }

      logger.debug(`💾 Conversa salva: ${conversa.id}`);
      return true;
    } catch (error) {
      logger.error('❌ Erro ao salvar conversa:', error);
      return false;
    }
  }

  /**
   * Incrementa contador de uso da conversa
   */
  incrementarUso(id) {
    const conversa = this.buscarPorId(id);
    
    if (!conversa) {
      return null;
    }

    conversa.metadados.vezesUsada++;
    conversa.metadados.ultimoUso = new Date().toISOString();

    this.salvar(conversa);
    
    return conversa;
  }

  /**
   * Deleta conversa
   */
  deletar(id) {
    try {
      const arquivo = path.join(this.conversasDir, `${id}.json`);
      
      if (fs.existsSync(arquivo)) {
        fs.unlinkSync(arquivo);
        this.conversas = this.conversas.filter(c => c.id !== id);
        logger.info(`🗑️ Conversa deletada: ${id}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('❌ Erro ao deletar conversa:', error);
      return false;
    }
  }

  /**
   * Busca conversas compatíveis com número de participantes
   */
  buscarPorParticipantes(numParticipantes) {
    return this.conversas.filter(c => {
      return numParticipantes >= c.participantesMinimos && 
             numParticipantes <= c.participantesMaximos;
    });
  }

  /**
   * Seleciona conversa aleatória menos utilizada
   */
  selecionarAleatoria(numParticipantes) {
    const compativeis = this.buscarPorParticipantes(numParticipantes);
    
    if (compativeis.length === 0) {
      return null;
    }

    // Ordenar por menos usadas
    compativeis.sort((a, b) => {
      return a.metadados.vezesUsada - b.metadados.vezesUsada;
    });

    // Pegar as 3 menos usadas
    const menosUsadas = compativeis.slice(0, Math.min(3, compativeis.length));

    // Selecionar aleatoriamente entre elas
    const index = Math.floor(Math.random() * menosUsadas.length);
    
    return menosUsadas[index];
  }

  /**
   * Importa conversa de JSON
   */
  importar(conversaJSON) {
    try {
      const conversa = typeof conversaJSON === 'string' 
        ? JSON.parse(conversaJSON) 
        : conversaJSON;

      // Validação básica
      if (!conversa.id || !conversa.nome || !conversa.mensagens) {
        throw new Error('Conversa inválida: faltam campos obrigatórios');
      }

      // Verificar se já existe
      if (this.buscarPorId(conversa.id)) {
        throw new Error('Já existe uma conversa com este ID');
      }

      // Salvar
      const sucesso = this.salvar(conversa);
      
      if (sucesso) {
        logger.info(`📥 Conversa importada: ${conversa.nome}`);
        return conversa;
      }

      return null;
    } catch (error) {
      logger.error('❌ Erro ao importar conversa:', error);
      throw error;
    }
  }
}

module.exports = new ConversaModel();
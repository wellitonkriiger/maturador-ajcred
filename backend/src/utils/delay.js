// src/utils/delay.js

class DelayUtils {
  /**
   * Aguarda um tempo em milissegundos
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gera delay aleatório entre min e max (em segundos)
   */
  static getRandomDelay(min, max) {
    const segundos = Math.random() * (max - min) + min;
    return Math.floor(segundos * 1000);
  }

  /**
   * Formata milissegundos para string legível
   */
  static formatDuration(ms) {
    const segundos = Math.floor(ms / 1000);
    
    if (segundos < 60) {
      return `${segundos}s`;
    }
    
    const minutos = Math.floor(segundos / 60);
    const segundosRestantes = segundos % 60;
    
    if (minutos < 60) {
      return segundosRestantes > 0 
        ? `${minutos}min ${segundosRestantes}s`
        : `${minutos}min`;
    }
    
    const horas = Math.floor(minutos / 60);
    const minutosRestantes = minutos % 60;
    
    return `${horas}h ${minutosRestantes}min`;
  }
}

module.exports = DelayUtils;
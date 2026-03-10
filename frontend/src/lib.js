import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : undefined;
export const API_ROOT = '/api';
export const POLL_INTERVAL = 30000;

let sharedSocket = null;

export function getRealtimeSocket() {
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_URL, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true
    });
  }
  return sharedSocket;
}

export async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(typeof body === 'string' ? body : body?.erro || 'Falha na requisicao');
    error.status = response.status;
    error.code = body?.codigo || null;
    error.data = body;
    throw error;
  }
  return body;
}

export function upsertById(list, item) {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [item, ...list];
  const next = [...list];
  next[index] = item;
  return next;
}

export function upsertExecucao(list, item) {
  const index = list.findIndex((entry) => entry.conversaExecucaoId === item.conversaExecucaoId);
  if (index === -1) return [item, ...list];
  const next = [...list];
  next[index] = item;
  return next;
}

export function removeExecucao(list, id) {
  return list.filter((entry) => entry.conversaExecucaoId !== id);
}

export function statusTone(status) {
  const map = {
    online: { color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
    offline: { color: '#64748b', bg: '#f8fafc', border: '#dbe4ee' },
    conectando: { color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
    reconnecting: { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
    erro: { color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
    requires_qr: { color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' }
  };
  return map[status] || map.offline;
}

export function statusLabel(status) {
  const map = {
    online: 'online',
    offline: 'offline',
    conectando: 'conectando',
    reconnecting: 'reconectando',
    erro: 'erro',
    requires_qr: 'precisa QR'
  };
  return map[status] || status;
}

export function formatTimeAgo(iso) {
  if (!iso) return '0s';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatDateTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export function formatNumeroBR(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '-';

  function formatLocal(localDigits) {
    if (localDigits.length === 9) return `${localDigits.slice(0, 5)}-${localDigits.slice(5)}`;
    if (localDigits.length === 8) return `${localDigits.slice(0, 4)}-${localDigits.slice(4)}`;
    return localDigits;
  }

  if (digits.length === 13 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    return `+55 (${ddd}) ${formatLocal(local)}`;
  }

  if (digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);
    return `(${ddd}) ${formatLocal(local)}`;
  }

  if (digits.length === 10) {
    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);
    return `(${ddd}) ${formatLocal(local)}`;
  }

  return digits;
}

export function useToasts() {
  const [toasts, setToasts] = useState([]);

  function push(message, tone = 'info') {
    const item = { id: `${Date.now()}_${Math.random()}`, message, tone };
    setToasts((current) => [...current, item]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== item.id));
    }, 3500);
  }

  return { toasts, push };
}

export function useSocketEvents(handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const socket = getRealtimeSocket();
    const onTelefoneStatus = (payload) => handlersRef.current.onTelefoneStatus?.(payload);
    const onQRCode = (payload) => handlersRef.current.onQRCode?.(payload);
    const onQRCleared = (payload) => handlersRef.current.onQRCleared?.(payload);
    const onPairingCode = (payload) => handlersRef.current.onPairingCode?.(payload);
    const onPairingCodeCleared = (payload) => handlersRef.current.onPairingCodeCleared?.(payload);
    const onReconnect = (payload) => handlersRef.current.onReconnect?.(payload);
    const onMaturacaoStatus = (payload) => handlersRef.current.onMaturacaoStatus?.(payload);
    const onConversaStarted = (payload) => handlersRef.current.onConversaStarted?.(payload);
    const onConversaUpdated = (payload) => handlersRef.current.onConversaUpdated?.(payload);
    const onConversaFinished = (payload) => handlersRef.current.onConversaFinished?.(payload);
    const onLog = (payload) => handlersRef.current.onLog?.(payload);

    socket.on('telefone:status', onTelefoneStatus);
    socket.on('telefone:qrcode', onQRCode);
    socket.on('telefone:qr_cleared', onQRCleared);
    socket.on('telefone:pairing_code', onPairingCode);
    socket.on('telefone:pairing_code_cleared', onPairingCodeCleared);
    socket.on('telefone:reconnect_attempt', onReconnect);
    socket.on('maturacao:status', onMaturacaoStatus);
    socket.on('maturacao:conversa_started', onConversaStarted);
    socket.on('maturacao:conversa_updated', onConversaUpdated);
    socket.on('maturacao:conversa_finished', onConversaFinished);
    socket.on('logs:tail', onLog);

    return () => {
      socket.off('telefone:status', onTelefoneStatus);
      socket.off('telefone:qrcode', onQRCode);
      socket.off('telefone:qr_cleared', onQRCleared);
      socket.off('telefone:pairing_code', onPairingCode);
      socket.off('telefone:pairing_code_cleared', onPairingCodeCleared);
      socket.off('telefone:reconnect_attempt', onReconnect);
      socket.off('maturacao:status', onMaturacaoStatus);
      socket.off('maturacao:conversa_started', onConversaStarted);
      socket.off('maturacao:conversa_updated', onConversaUpdated);
      socket.off('maturacao:conversa_finished', onConversaFinished);
      socket.off('logs:tail', onLog);
    };
  }, []);
}

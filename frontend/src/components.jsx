import { X } from 'lucide-react';
import { statusLabel, statusTone } from './lib';

export function Modal({ title, onClose, children, small = false }) {
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${small ? 'small' : ''}`}>
        <div className="modal-head">
          <h4>{title}</h4>
          <button className="btn secondary sm modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({
  title = 'Confirmar ação',
  message,
  details,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirmTone = 'critical',
  onConfirm,
  onClose
}) {
  return (
    <Modal title={title} onClose={onClose} small>
      <div className="stack">
        <p>{message}</p>
        {details ? <p className="muted">{details}</p> : null}
        <div className="actions end">
          <button className="btn secondary" onClick={onClose}>{cancelLabel}</button>
          <button className={`btn ${confirmTone}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

export function StatusBadge({ status }) {
  const tone = statusTone(status);
  return (
    <span className="badge" style={{ color: tone.color, background: tone.bg, borderColor: tone.border }}>
      <span className="dot" style={{ background: tone.color }} />
      {statusLabel(status)}
    </span>
  );
}

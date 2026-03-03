import { X } from 'lucide-react';
import { statusLabel, statusTone } from './lib';

export function Modal({ title, onClose, children, small = false }) {
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${small ? 'small' : ''}`}>
        <div className="modal-head">
          <h4>{title}</h4>
          <button className="btn secondary sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
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

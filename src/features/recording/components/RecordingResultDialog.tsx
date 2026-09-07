import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function RecordingResultDialog({ title, children, onClose, closeLabel = '关闭' }: { title: string; children: React.ReactNode; onClose: () => void; closeLabel?: string }) {
  const close = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useRef(`recording-result-dialog-${Math.random().toString(36).slice(2)}`);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); returnFocus.current?.focus(); };
  }, []);
  return <div className="recording-result-dialog__backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }} onClick={(event) => event.stopPropagation()}><section className="recording-result-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId.current}><header><h2 id={titleId.current}>{title}</h2><button ref={close} type="button" aria-label={closeLabel} onClick={onClose}><X size={18} /></button></header>{children}</section></div>;
}

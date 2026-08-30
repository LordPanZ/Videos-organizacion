import { useLibrary } from '../store/useLibrary.ts';

const ICONS = { info: 'ℹ', success: '✓', error: '⚠' } as const;

/** Transient notifications stacked in the corner. */
export function Toasts() {
  const { toasts, dismissToast } = useLibrary();

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-kind={toast.kind} onClick={() => dismissToast(toast.id)} role="status">
          <span>{ICONS[toast.kind]}</span>
          <span style={{ flex: 1, userSelect: 'text' }}>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal.tsx';
import { useLibrary } from '../store/useLibrary.ts';

/** Asks for the code that opens the container. */
export function ContainerDialog({ onClose }: { onClose(): void }) {
  const { unlockContainer } = useLibrary();
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => field.current?.focus(), []);

  const submit = () => {
    if (unlockContainer(code)) {
      onClose();
      return;
    }
    setWrong(true);
    setCode('');
    field.current?.focus();
  };

  return (
    <Modal
      title="🔒 Contenedor"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={code.length === 0}>
            Abrir
          </button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0, fontSize: 13 }}>
        Escribe la clave para ver los vídeos guardados aquí.
      </p>

      <input
        ref={field}
        className="input code-input"
        value={code}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Clave del contenedor"
        aria-invalid={wrong}
        placeholder="••••"
        onChange={(event) => {
          setCode(event.target.value);
          setWrong(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
      />

      {wrong && (
        <p style={{ color: 'var(--danger)', fontSize: 13, margin: '10px 0 0' }}>
          Esa clave no es. Inténtalo otra vez.
        </p>
      )}
    </Modal>
  );
}

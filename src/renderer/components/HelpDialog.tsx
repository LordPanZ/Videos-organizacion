import { Modal } from './Modal.tsx';

const EXAMPLES: [string, string][] = [
  ['cocina', 'Busca «cocina» en título, descripción, autor, etiquetas y notas'],
  ['"paella valenciana"', 'Frase exacta'],
  ['platform:youtube', 'Solo de YouTube (también p:yt, p:tiktok, p:instagram…)'],
  ['#cocina', 'Etiqueta «cocina», incluidas sus subetiquetas'],
  ['-#spam', 'Excluye la etiqueta «spam»'],
  ['@midudev', 'Del creador cuyo nombre o alias contenga «midudev»'],
  ['duration>10', 'Más de 10 minutos (el número suelto son minutos)'],
  ['duration<90s', 'Menos de 90 segundos'],
  ['rating>=4', 'Cuatro estrellas o más'],
  ['added:>7d', 'Añadidos en los últimos 7 días'],
  ['published:2024', 'Publicados durante 2024'],
  ['year:2023', 'Año de publicación exacto'],
  ['views>100000', 'Más de cien mil visualizaciones'],
  ['size>500mb', 'Archivos descargados de más de 500 MB'],
  ['is:favorito', 'favorito · descargado · visto · pendiente · corto · sinetiquetas · nodisponible'],
  ['has:notas', 'notas · archivo · miniatura · marcadores · etiquetas'],
  ['prioridad:alta', 'Cualquier campo personalizado que hayas creado'],
  ['col:"Ver luego"', 'Dentro de una colección'],
  ['p:youtube OR p:vimeo', 'Alternativa: OR, AND y paréntesis'],
  ['(#cocina OR #recetas) -is:visto', 'Combinaciones con paréntesis y negación'],
];

const SHORTCUTS: [string, string][] = [
  ['Ctrl/Cmd + K', 'Paleta de comandos'],
  ['Ctrl/Cmd + F', 'Ir a la búsqueda'],
  ['Ctrl/Cmd + N', 'Añadir vídeos'],
  ['Ctrl/Cmd + Shift + V', 'Importar enlaces del portapapeles'],
  ['Ctrl/Cmd + A', 'Seleccionar todo'],
  ['Ctrl/Cmd + 1…4', 'Cambiar de vista'],
  ['Ctrl/Cmd + D', 'Estadísticas'],
  ['Ctrl/Cmd + J', 'Descargas'],
  ['Espacio', 'Abrir el panel de detalle'],
  ['Intro', 'Reproducir el vídeo seleccionado'],
  ['Supr', 'Eliminar la selección'],
  ['Esc', 'Cerrar o limpiar la selección'],
];

/** Reference for the query language and the keyboard shortcuts. */
export function HelpDialog({ onClose, onRunExample }: { onClose(): void; onRunExample(query: string): void }) {
  return (
    <Modal title="Cómo buscar" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.6 }}>
        Escribe palabras sueltas para buscar en todo, o combina filtros. Los términos se suman: varios filtros seguidos
        significan «y además». Haz clic en cualquier ejemplo para probarlo.
      </p>

      <table className="data-table" style={{ marginBottom: 24 }}>
        <tbody>
          {EXAMPLES.map(([query, description]) => (
            <tr key={query} onClick={() => onRunExample(query)} title="Probar esta búsqueda">
              <td className="mono" style={{ color: 'var(--accent)', width: 210, whiteSpace: 'nowrap' }}>
                {query}
              </td>
              <td style={{ whiteSpace: 'normal', maxWidth: 'none' }}>{description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontSize: 13, margin: '0 0 10px' }}>Atajos de teclado</h3>
      <table className="data-table">
        <tbody>
          {SHORTCUTS.map(([keys, description]) => (
            <tr key={keys}>
              <td style={{ width: 210 }}>
                <kbd>{keys}</kbd>
              </td>
              <td style={{ whiteSpace: 'normal', maxWidth: 'none' }}>{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

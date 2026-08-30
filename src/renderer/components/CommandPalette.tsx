import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  group: string;
  run(): void;
}

export interface CommandPaletteProps {
  commands: Command[];
  onClose(): void;
}

/** Fuzzy-ish matcher: every typed word must appear somewhere in the entry. */
function matches(command: Command, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${command.label} ${command.group}`.toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Keyboard-first launcher for every action in the app. */
export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => commands.filter((command) => matches(command, query)), [commands, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const item = listRef.current?.children[active] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runActive = () => {
    const command = filtered[active];
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
        <input
          autoFocus
          value={query}
          placeholder="Escribe un comando o una búsqueda…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, filtered.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              runActive();
            }
          }}
        />

        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && (
            <p className="dim" style={{ padding: '18px 12px', margin: 0, textAlign: 'center' }}>
              Ningún comando coincide.
            </p>
          )}
          {filtered.map((command, index) => (
            <div
              key={command.id}
              className="palette-item"
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onClose();
                command.run();
              }}
            >
              <span style={{ width: 18, textAlign: 'center' }}>{command.icon}</span>
              <span style={{ flex: 1 }}>{command.label}</span>
              <span className="dim" style={{ fontSize: 11.5 }}>
                {command.group}
              </span>
              {command.shortcut && <kbd className="shortcut">{command.shortcut}</kbd>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

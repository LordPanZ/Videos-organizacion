import { useEffect, useState } from 'react';
import type { CustomField, CustomFieldValue } from '../../shared/types.ts';

export interface CustomFieldEditorProps {
  field: CustomField;
  value: CustomFieldValue;
  onChange(value: CustomFieldValue): void | Promise<void>;
  compact?: boolean;
}

/**
 * Renders the right control for a user-defined field. Adding a new field type
 * means adding one branch here and one in the encoder — nothing else.
 */
export function CustomFieldEditor({ field, value, onChange, compact }: CustomFieldEditorProps) {
  const [draft, setDraft] = useState<string>(value === null || value === undefined ? '' : String(value));

  useEffect(() => {
    setDraft(value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value));
  }, [value, field.id]);

  const label = (
    <label htmlFor={`field-${field.id}`}>
      {field.icon && <span style={{ marginRight: 5 }}>{field.icon}</span>}
      {field.label}
    </label>
  );

  const commit = (next: CustomFieldValue) => void onChange(next);

  switch (field.type) {
    case 'boolean':
      return (
        <label className="switch" style={{ marginBottom: compact ? 0 : 10 }}>
          <input type="checkbox" checked={value === true} onChange={(event) => commit(event.target.checked)} />
          <span>
            {field.icon && <span style={{ marginRight: 5 }}>{field.icon}</span>}
            {field.label}
          </span>
        </label>
      );

    case 'rating':
      return (
        <div className="field">
          {label}
          <span className="stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} type="button" data-on={star <= Number(value ?? 0)} onClick={() => commit(star === Number(value) ? null : star)}>
                ★
              </button>
            ))}
          </span>
        </div>
      );

    case 'select':
      return (
        <div className="field">
          {label}
          <select
            id={`field-${field.id}`}
            className="select"
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => commit(event.target.value || null)}
          >
            <option value="">— sin valor —</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );

    case 'multiselect': {
      const current = Array.isArray(value) ? value : [];
      return (
        <div className="field">
          {label}
          <div className="row row-wrap" style={{ gap: 5 }}>
            {field.options.map((option) => {
              const on = current.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className="chip chip-interactive"
                  style={on && option.color ? { background: `color-mix(in srgb, ${option.color} 26%, transparent)`, color: option.color } : undefined}
                  data-on={on}
                  onClick={() => commit(on ? current.filter((item) => item !== option.value) : [...current, option.value])}
                >
                  {on ? '✓ ' : ''}
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    case 'number':
    case 'duration':
      return (
        <div className="field">
          {label}
          <input
            id={`field-${field.id}`}
            className="input"
            type="number"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commit(draft === '' ? null : Number(draft))}
          />
        </div>
      );

    case 'date':
      return (
        <div className="field">
          {label}
          <input
            id={`field-${field.id}`}
            className="input"
            type="date"
            value={draft.slice(0, 10)}
            onChange={(event) => {
              setDraft(event.target.value);
              commit(event.target.value || null);
            }}
          />
        </div>
      );

    case 'longtext':
      return (
        <div className="field">
          {label}
          <textarea
            id={`field-${field.id}`}
            className="textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commit(draft || null)}
          />
        </div>
      );

    default:
      return (
        <div className="field">
          {label}
          <input
            id={`field-${field.id}`}
            className="input"
            type={field.type === 'url' ? 'url' : 'text'}
            value={draft}
            placeholder={field.description ?? ''}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commit(draft || null)}
          />
        </div>
      );
  }
}

import { useMemo, useState } from 'react';
import { useLibrary } from '../store/useLibrary.ts';
import { formatCount } from '../../shared/query/values.ts';
import type { FacetValue, Tag } from '../../shared/types.ts';

interface NavProps {
  icon: string;
  label: string;
  count?: number | null;
  active?: boolean;
  color?: string | null;
  onClick(): void;
  onContextMenu?(event: React.MouseEvent): void;
}

function NavItem({ icon, label, count, active, color, onClick, onContextMenu }: NavProps) {
  return (
    <button type="button" className="nav-item" aria-current={active} onClick={onClick} onContextMenu={onContextMenu} title={label}>
      {color ? <i className="dot" style={{ background: color }} /> : <span className="icon">{icon}</span>}
      <span className="label">{label}</span>
      {count !== null && count !== undefined && <span className="count">{formatCount(count)}</span>}
    </button>
  );
}

function Section({
  title,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  action?: { icon: string; title: string; onClick(): void };
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sidebar-section">
      <div className="sidebar-heading">
        <button type="button" onClick={() => setOpen((value) => !value)} style={{ flex: 1, textAlign: 'left' }}>
          {open ? '▾' : '▸'} {title}
        </button>
        {action && (
          <button type="button" title={action.title} onClick={action.onClick}>
            {action.icon}
          </button>
        )}
      </div>
      {open && children}
    </div>
  );
}

/** Builds the parent/child structure the tag tree renders. */
function buildTagTree(tags: Tag[]): { tag: Tag; children: Tag[] }[] {
  const byParent = new Map<string, Tag[]>();
  for (const tag of tags) {
    if (!tag.parentId) continue;
    const list = byParent.get(tag.parentId) ?? [];
    list.push(tag);
    byParent.set(tag.parentId, list);
  }
  return tags
    .filter((tag) => !tag.parentId)
    .map((tag) => ({ tag, children: byParent.get(tag.id) ?? [] }));
}

export interface SidebarProps {
  onManageFields(): void;
  onManageTags(): void;
  onNewCollection(): void;
  onEditCollection(id: string): void;
  /** Asks for the code, when the container has not been opened yet. */
  onOpenContainer(): void;
  /** Called after any navigation, so a narrow layout can close the drawer. */
  onNavigate?(): void;
}

/**
 * Navigation and faceted filtering.
 *
 * Every entry writes a query into the search bar rather than holding hidden
 * state, so what the user sees in the grid always matches what the search box
 * says — and any filter reached by clicking can also be typed.
 */
export function Sidebar({ onManageFields, onManageTags, onNewCollection, onEditCollection,
  onOpenContainer, onNavigate }: SidebarProps) {
  const {
    query,
    facets,
    tags,
    collections,
    views,
    fields,
    total,
    collectionId,
    screen,
    containerUnlocked,
    runQuery,
    setCollection,
    setScreen,
    toggleSidebar,
  } = useLibrary();

  const tagTree = useMemo(() => buildTagTree(tags), [tags]);
  const tagCounts = useMemo(() => new Map(facets.tags.map((facet) => [facet.value, facet.count])), [facets.tags]);

  const go = (nextQuery: string) => {
    void setCollection(null);
    void runQuery(nextQuery);
    setScreen('library');
    onNavigate?.();
  };

  const isActive = (candidate: string) => screen === 'library' && collectionId === null && query === candidate;


  const facetList = (items: FacetValue[], prefix: string, limit = 12) =>
    items.slice(0, limit).map((facet) => (
      <NavItem
        key={facet.value}
        icon="•"
        color={facet.color ?? null}
        label={facet.label}
        count={facet.count}
        active={isActive(`${prefix}${quoteIfNeeded(facet.value)}`)}
        onClick={() => go(`${prefix}${quoteIfNeeded(facet.value)}`)}
      />
    ));

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="logo">🎬</span>
        Videoteca
        <button type="button" className="sidebar-close" title="Cerrar el menú" onClick={toggleSidebar}>
          ✕
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <NavItem
            icon="🎬"
            label="Inicio"
            active={screen === 'home'}
            onClick={() => {
              setScreen('home');
              onNavigate?.();
            }}
          />
          <NavItem
            icon="🗂"
            label="Toda la biblioteca"
            count={total}
            active={screen === 'library' && isActive('')}
            onClick={() => go('')}
          />
          <NavItem
            icon="📊"
            label="Estadísticas"
            active={screen === 'dashboard'}
            onClick={() => {
              setScreen('dashboard');
              onNavigate?.();
            }}
          />
          <NavItem
            icon="⬇"
            label="Descargas"
            active={screen === 'downloads'}
            onClick={() => {
              setScreen('downloads');
              onNavigate?.();
            }}
          />
          <NavItem
            icon="🔁"
            label="Duplicados"
            active={screen === 'duplicates'}
            onClick={() => {
              setScreen('duplicates');
              onNavigate?.();
            }}
          />
          <NavItem
            icon={containerUnlocked ? '🔓' : '🔒'}
            label="Contenedor"
            active={screen === 'container'}
            onClick={() => {
              // Locked, the entry asks for the code instead of navigating; it
              // shows no count either way, so the sidebar gives nothing away.
              if (containerUnlocked) setScreen('container');
              else onOpenContainer();
              onNavigate?.();
            }}
          />
        </div>

        {views.length > 0 && (
          <Section title="Vistas guardadas">
            {views.map((view) => (
              <NavItem
                key={view.id}
                icon={view.icon ?? '🔖'}
                label={view.name}
                active={isActive(view.query)}
                onClick={() => go(view.query)}
              />
            ))}
          </Section>
        )}

        <Section title="Colecciones" action={{ icon: '+', title: 'Nueva colección', onClick: onNewCollection }}>
          {collections.length === 0 && <p className="dim" style={{ padding: '4px 10px', fontSize: 12 }}>Sin colecciones todavía.</p>}
          {collections.map((collection) => (
            <NavItem
              key={collection.id}
              icon={collection.icon ?? (collection.kind === 'smart' ? '⚡' : '📁')}
              label={collection.name}
              count={collection.videoCount}
              active={collection.kind === 'smart' ? isActive(collection.query ?? '') : collectionId === collection.id}
              onClick={() => {
                if (collection.kind === 'smart') go(collection.query ?? '');
                else {
                  void setCollection(collection.id);
                  setScreen('library');
                  onNavigate?.();
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onEditCollection(collection.id);
              }}
            />
          ))}
        </Section>

        {facets.platforms.length > 0 && (
          <Section title="Plataformas">{facetList(facets.platforms, 'platform:')}</Section>
        )}

        <Section title="Etiquetas" action={{ icon: '⚙', title: 'Gestionar etiquetas', onClick: onManageTags }}>
          {tagTree.length === 0 && <p className="dim" style={{ padding: '4px 10px', fontSize: 12 }}>Sin etiquetas todavía.</p>}
          {tagTree.slice(0, 40).map(({ tag, children }) => (
            <div key={tag.id}>
              <NavItem
                icon={tag.icon ?? '🏷'}
                color={tag.color}
                label={tag.name}
                count={tagCounts.get(tag.slug) ?? tag.videoCount ?? 0}
                active={isActive(`tag:${quoteIfNeeded(tag.slug)}`)}
                onClick={() => go(`tag:${quoteIfNeeded(tag.slug)}`)}
              />
              {children.length > 0 && (
                <div className="nav-children">
                  {children.map((child) => (
                    <NavItem
                      key={child.id}
                      icon={child.icon ?? '·'}
                      color={child.color}
                      label={child.name}
                      count={tagCounts.get(child.slug) ?? child.videoCount ?? 0}
                      active={isActive(`tag:${quoteIfNeeded(child.slug)}`)}
                      onClick={() => go(`tag:${quoteIfNeeded(child.slug)}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </Section>

        {facets.authors.length > 0 && (
          <Section title="Creadores" defaultOpen={false}>
            {facets.authors.slice(0, 20).map((facet) => (
              <NavItem
                key={facet.value}
                icon="👤"
                label={facet.label}
                count={facet.count}
                onClick={() => go(`author:${quoteIfNeeded(facet.label)}`)}
              />
            ))}
          </Section>
        )}

        <Section title="Campos personalizados" action={{ icon: '+', title: 'Gestionar campos', onClick: onManageFields }} defaultOpen={false}>
          {fields.length === 0 && (
            <p className="dim" style={{ padding: '4px 10px', fontSize: 12 }}>
              Crea tus propios parámetros para clasificar como quieras.
            </p>
          )}
          {fields.map((field) => {
            const values = facets.customFields[field.key] ?? [];
            return (
              <div key={field.id}>
                <NavItem
                  icon={field.icon ?? '🧩'}
                  label={field.label}
                  count={values.reduce((sum, value) => sum + value.count, 0)}
                  onClick={() => go(`has:${field.key}`)}
                />
                {values.length > 0 && (
                  <div className="nav-children">
                    {values.slice(0, 8).map((value) => (
                      <NavItem
                        key={value.value}
                        icon="·"
                        color={value.color ?? null}
                        label={value.label}
                        count={value.count}
                        active={isActive(`${field.key}:${quoteIfNeeded(value.value)}`)}
                        onClick={() => go(`${field.key}:${quoteIfNeeded(value.value)}`)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Section>

        {facets.durations.length > 0 && (
          <Section title="Duración" defaultOpen={false}>
            {facets.durations.map((facet) => (
              <NavItem
                key={facet.value}
                icon="⏱"
                label={facet.label}
                count={facet.count}
                onClick={() => go(durationQuery(facet.value))}
              />
            ))}
          </Section>
        )}

        {facets.years.length > 0 && (
          <Section title="Años" defaultOpen={false}>
            {facets.years.slice(0, 15).map((facet) => (
              <NavItem
                key={facet.value}
                icon="📅"
                label={facet.label}
                count={facet.count}
                active={isActive(`year:${facet.value}`)}
                onClick={() => go(`year:${facet.value}`)}
              />
            ))}
          </Section>
        )}
      </div>
    </aside>
  );
}

/** Quotes a filter value when it contains characters the parser would split. */
function quoteIfNeeded(value: string): string {
  return /[\s()"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** Maps a duration bucket id onto the equivalent typed query. */
function durationQuery(bucket: string): string {
  switch (bucket) {
    case 'micro':
      return 'duration<1';
    case 'corto':
      return 'duration>=1 duration<5';
    case 'medio':
      return 'duration>=5 duration<20';
    case 'largo':
      return 'duration>=20 duration<60';
    default:
      return 'duration>=60';
  }
}

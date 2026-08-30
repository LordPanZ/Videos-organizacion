import type { Db } from './database.ts';
import { CustomFieldRepository } from './repos/customFields.ts';
import { SavedViewRepository } from './repos/misc.ts';
import { TagRepository } from './repos/tags.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/** Topic tags every new library starts with; users rename or delete freely. */
const STARTER_TOPICS: { name: string; color: string; icon: string }[] = [
  { name: 'Tutoriales', color: '#4c8dff', icon: '🎓' },
  { name: 'Música', color: '#c56cf0', icon: '🎵' },
  { name: 'Cocina', color: '#ff9f43', icon: '🍳' },
  { name: 'Deporte', color: '#26de81', icon: '🏃' },
  { name: 'Tecnología', color: '#45aaf2', icon: '💻' },
  { name: 'Humor', color: '#fed330', icon: '😂' },
  { name: 'Viajes', color: '#2bcbba', icon: '✈️' },
  { name: 'Noticias', color: '#fc5c65', icon: '📰' },
  { name: 'Arte y diseño', color: '#a55eea', icon: '🎨' },
  { name: 'Ideas guardadas', color: '#778ca3', icon: '💡' },
];

/** Custom fields that demonstrate the parameter system out of the box. */
const STARTER_FIELDS = [
  {
    label: 'Prioridad',
    key: 'prioridad',
    type: 'select' as const,
    icon: '🔥',
    showInCard: true,
    options: [
      { value: 'alta', label: 'Alta', color: '#fc5c65' },
      { value: 'media', label: 'Media', color: '#fed330' },
      { value: 'baja', label: 'Baja', color: '#778ca3' },
    ],
  },
  {
    label: 'Fuente',
    key: 'fuente',
    type: 'select' as const,
    icon: '📍',
    options: [
      { value: 'recomendacion', label: 'Recomendación' },
      { value: 'busqueda', label: 'Búsqueda propia' },
      { value: 'suscripcion', label: 'Suscripción' },
      { value: 'redes', label: 'Redes sociales' },
    ],
  },
  { label: 'Para volver a ver', key: 'revisitar', type: 'boolean' as const, icon: '🔁' },
  { label: 'Utilidad', key: 'utilidad', type: 'rating' as const, icon: '⭐' },
  { label: 'Proyecto', key: 'proyecto', type: 'text' as const, icon: '📁' },
];

const STARTER_VIEWS = [
  { name: 'Añadidos esta semana', query: 'added:>7d', icon: '🆕' },
  { name: 'Favoritos', query: 'is:favorito', icon: '❤️' },
  { name: 'Pendientes de ver', query: 'is:pendiente', icon: '👀' },
  { name: 'Descargados', query: 'is:descargado', icon: '💾' },
  { name: 'Sin etiquetas', query: 'is:sinetiquetas', icon: '🏷️' },
  { name: 'Mejor valorados', query: 'rating>=4', icon: '🌟' },
  { name: 'Vídeos cortos', query: 'duration<5', icon: '⚡' },
  { name: 'No disponibles', query: 'is:nodisponible', icon: '⚠️' },
];

/**
 * Populates a brand-new library with starter topics, custom fields and saved
 * views. Runs once: any existing tag means the library is already in use.
 */
export function seedIfEmpty(db: Db): boolean {
  const tagCount = Number((db.prepare('SELECT COUNT(*) AS n FROM tags').get() as Row).n);
  const fieldCount = Number((db.prepare('SELECT COUNT(*) AS n FROM custom_fields').get() as Row).n);
  const viewCount = Number((db.prepare('SELECT COUNT(*) AS n FROM saved_views').get() as Row).n);
  if (tagCount > 0 || fieldCount > 0 || viewCount > 0) return false;

  const tags = new TagRepository(db);
  const fields = new CustomFieldRepository(db);
  const views = new SavedViewRepository(db);

  const run = db.transaction(() => {
    for (const topic of STARTER_TOPICS) {
      tags.ensure({ name: topic.name, color: topic.color, icon: topic.icon, kind: 'topic' });
    }
    for (const field of STARTER_FIELDS) {
      fields.create(field);
    }
    STARTER_VIEWS.forEach((view, index) => {
      views.create({
        name: view.name,
        query: view.query,
        icon: view.icon,
        sort: { field: 'addedAt', direction: 'desc' },
        layout: 'grid',
        position: index,
      });
    });
  });
  run();
  return true;
}

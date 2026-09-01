import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, thumbnailSrc } from '../api.ts';
import { useLibrary } from '../store/useLibrary.ts';
import { generatedCover } from '../covers.ts';
import { coverInitials } from '../../shared/initials.ts';
import { formatDate, formatDuration } from '../../shared/query/values.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Video } from '../../shared/types.ts';

/** One carousel: a heading, the query behind it, and what it found. */
interface Row {
  id: string;
  title: string;
  query: string;
  collectionId?: string;
  videos: Video[];
  /** Show how far through each video the viewer got. */
  showProgress?: boolean;
}

const ROW_LIMIT = 20;
const MAX_TOPIC_ROWS = 8;

/** Quotes a value when it contains characters the query parser would split. */
function quote(value: string): string {
  return /[\s()"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/* ------------------------------------------------------------------ poster */

interface PosterProps {
  video: Video;
  showProgress?: boolean;
  onOpen(): void;
  onPlay(): void;
}

function Poster({ video, showProgress, onOpen, onPlay }: PosterProps) {
  const [failed, setFailed] = useState(false);
  const source = failed ? null : thumbnailSrc(video);

  return (
    <article className="poster" onClick={onOpen} title={video.title}>
      <div className="poster-art">
        {source ? (
          <img src={source} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <div className="card-generated" style={generatedCover(video.id, PLATFORM_COLORS[video.platform])}>
            <span>{coverInitials(video)}</span>
          </div>
        )}

        <span className="poster-platform" style={{ background: PLATFORM_COLORS[video.platform] }} />

        <button
          type="button"
          className="poster-play"
          title="Reproducir"
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
        >
          ▶
        </button>

        {video.durationSeconds !== null && <span className="poster-duration">{formatDuration(video.durationSeconds)}</span>}

        {showProgress && video.watchProgress > 0 && (
          <div className="poster-progress">
            <span style={{ width: `${Math.round(video.watchProgress * 100)}%` }} />
          </div>
        )}
      </div>

      <div className="poster-title">{video.title}</div>
      {video.author && <div className="poster-author">{video.author.name}</div>}
    </article>
  );
}

/* ---------------------------------------------------------------- carousel */

interface CarouselProps {
  row: Row;
  onOpen(id: string): void;
  onPlay(id: string): void;
  onSeeAll(): void;
}

function Carousel({ row, onOpen, onPlay, onSeeAll }: CarouselProps) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: true });

  /** Keeps the arrows honest about whether there is anything left to scroll. */
  const measure = useCallback(() => {
    const node = track.current;
    if (!node) return;
    setEdges({
      start: node.scrollLeft > 8,
      end: node.scrollLeft + node.clientWidth < node.scrollWidth - 8,
    });
  }, []);

  useEffect(() => {
    measure();
    const node = track.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure, row.videos.length]);

  const nudge = (direction: 1 | -1) => {
    const node = track.current;
    if (!node) return;
    // Move by just under a screenful so one poster stays visible as an anchor.
    node.scrollBy({ left: direction * (node.clientWidth * 0.85), behavior: 'smooth' });
  };

  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{row.title}</h2>
        <button type="button" className="shelf-all" onClick={onSeeAll}>
          Ver todo <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="shelf-body">
        {edges.start && (
          <button type="button" className="shelf-arrow start" aria-label="Anterior" onClick={() => nudge(-1)}>
            ‹
          </button>
        )}

        <div className="shelf-track" ref={track} onScroll={measure}>
          {row.videos.map((video) => (
            <Poster
              key={video.id}
              video={video}
              showProgress={row.showProgress}
              onOpen={() => onOpen(video.id)}
              onPlay={() => onPlay(video.id)}
            />
          ))}
        </div>

        {edges.end && (
          <button type="button" className="shelf-arrow end" aria-label="Siguiente" onClick={() => nudge(1)}>
            ›
          </button>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- hero */

function Hero({ video, onOpen, onPlay }: { video: Video; onOpen(): void; onPlay(): void }) {
  const [failed, setFailed] = useState(false);
  const source = failed ? null : thumbnailSrc(video);
  const accent = PLATFORM_COLORS[video.platform];

  return (
    <header className="hero" style={{ '--hero-accent': accent } as React.CSSProperties}>
      <div className="hero-art">
        {source ? (
          <img src={source} alt="" onError={() => setFailed(true)} />
        ) : (
          <div style={{ width: '100%', height: '100%', ...generatedCover(video.id, accent) }} />
        )}
      </div>

      <div className="hero-scrim" />

      <div className="hero-body">
        <span className="hero-eyebrow">
          <i style={{ background: accent }} />
          {PLATFORM_LABELS[video.platform]}
          {video.author && <> · {video.author.name}</>}
        </span>

        <h1 className="hero-title">{video.title}</h1>

        <p className="hero-meta">
          {video.publishedAt && <span>{formatDate(video.publishedAt)}</span>}
          {video.durationSeconds !== null && <span>{formatDuration(video.durationSeconds)}</span>}
          {video.rating > 0 && <span style={{ color: 'var(--warning)' }}>{'★'.repeat(video.rating)}</span>}
          {video.tags.slice(0, 3).map((tag) => (
            <span key={tag.id} className="hero-tag">
              {tag.name}
            </span>
          ))}
        </p>

        {video.description && <p className="hero-description">{video.description}</p>}

        <div className="hero-actions">
          <button type="button" className="btn btn-primary hero-play" onClick={onPlay}>
            ▶ Reproducir
          </button>
          <button type="button" className="btn hero-more" onClick={onOpen}>
            Más información
          </button>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------- view */

/**
 * The library as a streaming service presents it: one featured video, then
 * shelves you scroll sideways.
 *
 * Every shelf is a saved query, so the rows are not a separate concept bolted
 * on — "Ver todo" simply drops that query into the search bar and shows the
 * ordinary grid.
 */
export function HomeView({ onAdd }: { onAdd(): void }) {
  const { tags, collections, runQuery, setScreen, openDetail, patchVideo, setCollection } = useLibrary();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hero, setHero] = useState<Video | null>(null);

  // Which shelves to build, before any of them are known to have content.
  const planned = useMemo(() => {
    const plan: Omit<Row, 'videos'>[] = [
      { id: 'continue', title: 'Continuar viendo', query: 'is:viendo', showProgress: true },
      { id: 'recent', title: 'Últimas subidas', query: '' },
      { id: 'favorites', title: 'Tus favoritos', query: 'is:favorito' },
      { id: 'unwatched', title: 'Pendientes de ver', query: 'is:pendiente' },
    ];

    for (const collection of collections.filter((entry) => (entry.videoCount ?? 0) > 0 || entry.kind === 'smart')) {
      plan.push({
        id: `col-${collection.id}`,
        title: collection.name,
        query: collection.kind === 'smart' ? (collection.query ?? '') : '',
        collectionId: collection.kind === 'manual' ? collection.id : undefined,
      });
    }

    // Topics the user actually uses, biggest first.
    const topics = tags
      .filter((tag) => (tag.videoCount ?? 0) > 0 && (tag.kind === 'topic' || tag.kind === 'manual'))
      .sort((a, b) => (b.videoCount ?? 0) - (a.videoCount ?? 0))
      .slice(0, MAX_TOPIC_ROWS);

    for (const tag of topics) {
      plan.push({ id: `tag-${tag.id}`, title: tag.name, query: `tag:${quote(tag.slug)}` });
    }

    plan.push({ id: 'short', title: 'Vídeos cortos', query: 'is:corto' });
    return plan;
  }, [collections, tags]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const featured = await api.videos.search({
        query: '',
        sort: { field: 'addedAt', direction: 'desc' },
        limit: 1,
        facets: false,
      });
      if (!cancelled) setHero(featured.videos[0] ?? null);

      const results = await Promise.all(
        planned.map(async (row) => ({
          ...row,
          videos: (
            await api.videos.search({
              query: row.query,
              collectionId: row.collectionId,
              sort: { field: 'addedAt', direction: 'desc' },
              limit: ROW_LIMIT,
              facets: false,
            })
          ).videos,
        })),
      );

      // A shelf with nothing on it is noise, not structure.
      if (!cancelled) setRows(results.filter((row) => row.videos.length > 0));
    })();

    return () => {
      cancelled = true;
    };
  }, [planned]);

  const play = (id: string) => {
    void api.videos.open(id);
    patchVideo(id, { watchStatus: 'in_progress' });
  };

  const seeAll = (row: Row) => {
    if (row.collectionId) {
      void setCollection(row.collectionId);
    } else {
      void setCollection(null);
      void runQuery(row.query);
    }
    setScreen('library');
  };

  if (rows === null) {
    return <div className="empty">Preparando tu videoteca…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="empty">
        <span className="emoji">🎬</span>
        <h2>Tu videoteca está vacía</h2>
        <p>
          Pega enlaces de YouTube, TikTok, Instagram o cualquier otra plataforma. Según vayas añadiendo, esta portada se
          irá llenando de secciones.
        </p>
        <button type="button" className="btn btn-primary" onClick={onAdd}>
          + Añadir mis primeros vídeos
        </button>
      </div>
    );
  }

  return (
    <div className="home">
      {hero && <Hero key={hero.id} video={hero} onOpen={() => openDetail(hero.id)} onPlay={() => play(hero.id)} />}

      <div className="shelves">
        {rows.map((row) => (
          <Carousel key={row.id} row={row} onOpen={openDetail} onPlay={play} onSeeAll={() => seeAll(row)} />
        ))}
      </div>
    </div>
  );
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Schema history. Migrations are applied in order inside a transaction and the
 * resulting version is stored in SQLite's `user_version` pragma.
 *
 * Never edit a migration that has shipped — append a new one instead.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    sql: `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE authors (
        id                TEXT PRIMARY KEY,
        platform          TEXT NOT NULL,
        external_id       TEXT,
        name              TEXT NOT NULL,
        handle            TEXT,
        url               TEXT,
        avatar_path       TEXT,
        subscriber_count  INTEGER,
        created_at        TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_authors_identity ON authors (platform, lower(name), COALESCE(handle, ''));
      CREATE INDEX idx_authors_external ON authors (platform, external_id);

      CREATE TABLE videos (
        id                TEXT PRIMARY KEY,
        url               TEXT NOT NULL,
        url_hash          TEXT NOT NULL,
        platform          TEXT NOT NULL,
        platform_id       TEXT,
        title             TEXT NOT NULL,
        description       TEXT,
        author_id         TEXT REFERENCES authors(id) ON DELETE SET NULL,
        duration_seconds  INTEGER,
        published_at      TEXT,
        thumbnail_path    TEXT,
        thumbnail_url     TEXT,
        width             INTEGER,
        height            INTEGER,
        view_count        INTEGER,
        like_count        INTEGER,
        comment_count     INTEGER,
        language          TEXT,
        is_live           INTEGER NOT NULL DEFAULT 0,
        is_short          INTEGER NOT NULL DEFAULT 0,

        rating            INTEGER NOT NULL DEFAULT 0,
        favorite          INTEGER NOT NULL DEFAULT 0,
        watch_status      TEXT    NOT NULL DEFAULT 'unwatched',
        watch_progress    REAL    NOT NULL DEFAULT 0,
        notes             TEXT,
        color             TEXT,
        archived          INTEGER NOT NULL DEFAULT 0,

        file_path         TEXT,
        file_size         INTEGER,
        file_format       TEXT,
        downloaded_at     TEXT,

        availability      TEXT NOT NULL DEFAULT 'unknown',
        last_checked_at   TEXT,
        added_at          TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        opened_count      INTEGER NOT NULL DEFAULT 0,
        last_opened_at    TEXT,
        raw_metadata      TEXT
      );
      CREATE UNIQUE INDEX idx_videos_url_hash ON videos (url_hash);
      CREATE INDEX idx_videos_platform      ON videos (platform);
      CREATE INDEX idx_videos_platform_id   ON videos (platform, platform_id);
      CREATE INDEX idx_videos_author        ON videos (author_id);
      CREATE INDEX idx_videos_added_at      ON videos (added_at DESC);
      CREATE INDEX idx_videos_published_at  ON videos (published_at DESC);
      CREATE INDEX idx_videos_rating        ON videos (rating DESC);
      CREATE INDEX idx_videos_watch_status  ON videos (watch_status);
      CREATE INDEX idx_videos_favorite      ON videos (favorite) WHERE favorite = 1;
      CREATE INDEX idx_videos_archived      ON videos (archived);
      CREATE INDEX idx_videos_file_path     ON videos (file_path) WHERE file_path IS NOT NULL;
      CREATE INDEX idx_videos_duration      ON videos (duration_seconds);

      CREATE TABLE tags (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        slug         TEXT NOT NULL,
        color        TEXT,
        icon         TEXT,
        kind         TEXT NOT NULL DEFAULT 'manual',
        parent_id    TEXT REFERENCES tags(id) ON DELETE SET NULL,
        description  TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_tags_slug ON tags (slug);
      CREATE INDEX idx_tags_parent ON tags (parent_id);
      CREATE INDEX idx_tags_kind ON tags (kind);

      CREATE TABLE video_tags (
        video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        source      TEXT NOT NULL DEFAULT 'manual',
        confidence  REAL NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (video_id, tag_id)
      );
      CREATE INDEX idx_video_tags_tag ON video_tags (tag_id);

      CREATE TABLE collections (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        description  TEXT,
        cover_path   TEXT,
        icon         TEXT,
        color        TEXT,
        kind         TEXT NOT NULL DEFAULT 'manual',
        query        TEXT,
        parent_id    TEXT REFERENCES collections(id) ON DELETE SET NULL,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_collections_parent ON collections (parent_id);

      CREATE TABLE collection_items (
        collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        video_id       TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        position       INTEGER NOT NULL DEFAULT 0,
        added_at       TEXT NOT NULL,
        PRIMARY KEY (collection_id, video_id)
      );
      CREATE INDEX idx_collection_items_video ON collection_items (video_id);

      CREATE TABLE custom_fields (
        id             TEXT PRIMARY KEY,
        key            TEXT NOT NULL,
        label          TEXT NOT NULL,
        type           TEXT NOT NULL,
        options_json   TEXT,
        default_value  TEXT,
        description    TEXT,
        icon           TEXT,
        color          TEXT,
        position       INTEGER NOT NULL DEFAULT 0,
        show_in_card   INTEGER NOT NULL DEFAULT 0,
        show_in_facets INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_custom_fields_key ON custom_fields (key);

      CREATE TABLE custom_field_values (
        video_id      TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        field_id      TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
        value_text    TEXT,
        value_number  REAL,
        PRIMARY KEY (video_id, field_id)
      );
      CREATE INDEX idx_cfv_field ON custom_field_values (field_id);
      CREATE INDEX idx_cfv_number ON custom_field_values (field_id, value_number);

      CREATE TABLE bookmarks (
        id            TEXT PRIMARY KEY,
        video_id      TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        time_seconds  REAL NOT NULL,
        label         TEXT NOT NULL,
        note          TEXT,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_bookmarks_video ON bookmarks (video_id, time_seconds);

      CREATE TABLE auto_tag_rules (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        enabled        INTEGER NOT NULL DEFAULT 1,
        field          TEXT NOT NULL,
        matcher        TEXT NOT NULL,
        pattern        TEXT NOT NULL,
        case_sensitive INTEGER NOT NULL DEFAULT 0,
        tag_ids        TEXT NOT NULL DEFAULT '[]',
        set_fields     TEXT NOT NULL DEFAULT '{}',
        position       INTEGER NOT NULL DEFAULT 0,
        match_count    INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL
      );

      CREATE TABLE saved_views (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        query     TEXT NOT NULL,
        sort      TEXT NOT NULL,
        layout    TEXT NOT NULL,
        icon      TEXT,
        position  INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE download_jobs (
        id                TEXT PRIMARY KEY,
        video_id          TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        url               TEXT NOT NULL,
        state             TEXT NOT NULL DEFAULT 'queued',
        progress          REAL NOT NULL DEFAULT 0,
        total_bytes       INTEGER,
        downloaded_bytes  INTEGER,
        output_path       TEXT,
        format_json       TEXT NOT NULL,
        error             TEXT,
        created_at        TEXT NOT NULL,
        finished_at       TEXT
      );
      CREATE INDEX idx_download_jobs_state ON download_jobs (state);
      CREATE INDEX idx_download_jobs_video ON download_jobs (video_id);

      -- Full-text index. Kept in sync explicitly by the repository layer so
      -- that tag and author edits refresh the document too, which triggers on
      -- the videos table alone could not do.
      CREATE VIRTUAL TABLE videos_fts USING fts5(
        title,
        description,
        author,
        tags,
        notes,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

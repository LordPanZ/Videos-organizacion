import { backupTo, openDatabase, optimize, vacuum, type Db } from './database.ts';
import { seedIfEmpty } from './seed.ts';
import { AuthorRepository } from './repos/authors.ts';
import { CollectionRepository } from './repos/collections.ts';
import { CustomFieldRepository } from './repos/customFields.ts';
import { BookmarkRepository, DownloadRepository, RuleRepository, SavedViewRepository, SettingsRepository } from './repos/misc.ts';
import { TagRepository } from './repos/tags.ts';
import { VideoRepository } from './repos/videos.ts';

export interface LibraryOptions {
  file: string;
  /** Skip inserting starter tags and fields; used by tests. */
  seed?: boolean;
}

/**
 * The library facade: one SQLite connection plus every repository that reads
 * and writes it. The main process owns a single instance.
 */
export class Library {
  readonly db: Db;
  readonly videos: VideoRepository;
  readonly tags: TagRepository;
  readonly authors: AuthorRepository;
  readonly collections: CollectionRepository;
  readonly customFields: CustomFieldRepository;
  readonly bookmarks: BookmarkRepository;
  readonly rules: RuleRepository;
  readonly savedViews: SavedViewRepository;
  readonly settings: SettingsRepository;
  readonly downloads: DownloadRepository;

  constructor(options: LibraryOptions) {
    this.db = openDatabase({ file: options.file });
    this.videos = new VideoRepository(this.db);
    this.tags = new TagRepository(this.db);
    this.authors = new AuthorRepository(this.db);
    this.collections = new CollectionRepository(this.db);
    this.customFields = new CustomFieldRepository(this.db);
    this.bookmarks = new BookmarkRepository(this.db);
    this.rules = new RuleRepository(this.db);
    this.savedViews = new SavedViewRepository(this.db);
    this.settings = new SettingsRepository(this.db);
    this.downloads = new DownloadRepository(this.db);

    if (options.seed !== false) seedIfEmpty(this.db);
    this.downloads.requeueInterrupted();
  }

  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  optimize(): void {
    optimize(this.db);
  }

  vacuum(): void {
    vacuum(this.db);
  }

  backup(destination: string): Promise<void> {
    return backupTo(this.db, destination);
  }

  close(): void {
    this.db.close();
  }
}

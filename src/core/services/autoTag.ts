import type { Library } from '../db/library.ts';
import type { VideoMetadata } from '../metadata/types.ts';
import { PLATFORM_LABELS, PLATFORM_COLORS, type AutoTagRule, type Tag, type Video } from '../../shared/types.ts';
import { DURATION_BUCKETS, durationBucket } from '../../shared/query/values.ts';

export interface AutoTagSettings {
  platform: boolean;
  creator: boolean;
  year: boolean;
  duration: boolean;
  hashtags: boolean;
  platformTags: boolean;
  language: boolean;
  /** Cap on how many platform-provided tags are imported per video. */
  maxPlatformTags: number;
}

export const DEFAULT_AUTO_TAG_SETTINGS: AutoTagSettings = {
  platform: true,
  creator: true,
  year: true,
  duration: true,
  hashtags: true,
  platformTags: true,
  language: false,
  maxPlatformTags: 8,
};

/** Hashtags written inside a title or description. */
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(/#[\p{L}\p{N}_]{2,40}/gu) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    const name = match.slice(1);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result.slice(0, 20);
}

/** Words too generic to be worth a tag of their own. */
const STOPWORDS = new Set([
  'video',
  'vídeo',
  'shorts',
  'short',
  'reel',
  'reels',
  'tiktok',
  'youtube',
  'instagram',
  'viral',
  'fyp',
  'parati',
  'foryou',
  'foryoupage',
  'trending',
  'nuevo',
  'new',
  'the',
  'and',
  'para',
  'con',
  'los',
  'las',
  'del',
]);

/** Evaluates one user-defined rule against a video's text. */
export function ruleMatches(rule: AutoTagRule, subject: { title: string; description: string | null; author: string | null; url: string; platformTags: string[] }): boolean {
  const haystack = (() => {
    switch (rule.field) {
      case 'title':
        return subject.title;
      case 'description':
        return subject.description ?? '';
      case 'author':
        return subject.author ?? '';
      case 'url':
        return subject.url;
      case 'platformTags':
        return subject.platformTags.join(' ');
      default:
        return [subject.title, subject.description ?? '', subject.author ?? '', subject.platformTags.join(' ')].join('\n');
    }
  })();

  const text = rule.caseSensitive ? haystack : haystack.toLowerCase();
  const pattern = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();

  switch (rule.matcher) {
    case 'equals':
      return text.trim() === pattern.trim();
    case 'startsWith':
      return text.trimStart().startsWith(pattern);
    case 'endsWith':
      return text.trimEnd().endsWith(pattern);
    case 'regex':
      try {
        return new RegExp(rule.pattern, rule.caseSensitive ? 'u' : 'iu').test(haystack);
      } catch {
        // An invalid regex must not break the whole import.
        return false;
      }
    default:
      return text.includes(pattern);
  }
}

export interface AutoTagResult {
  tagIds: string[];
  tagNames: string[];
  rulesFired: string[];
}

export interface ApplyOptions {
  /** Restrict rule evaluation to these rule ids. Omit to run every enabled rule. */
  ruleIds?: string[];
  /** Skip the built-in generators and apply only the user's rules. */
  rulesOnly?: boolean;
}

/**
 * Derives tags for a video from its metadata plus the user's rules.
 *
 * Generated tags carry `source: 'auto'`, so the UI can show them apart from
 * the ones a person added and re-running the tagger never fights manual edits.
 */
export class AutoTagger {
  private readonly library: Library;
  private readonly settings: AutoTagSettings;

  constructor(library: Library, settings: Partial<AutoTagSettings> = {}) {
    this.library = library;
    this.settings = { ...DEFAULT_AUTO_TAG_SETTINGS, ...settings };
  }

  /**
   * Finds or creates a tag, remembering which generator produced it.
   *
   * `filterNoise` applies the stopword list. It belongs on text harvested from
   * the video (hashtags, platform keywords), where "#viral" or "#youtube" would
   * tag half the library — never on the deliberate generators, whose whole job
   * is to produce tags like "YouTube".
   */
  private ensure(
    name: string,
    kind: Tag['kind'],
    options: { color?: string | null; icon?: string | null; parentId?: string | null; filterNoise?: boolean } = {},
  ): Tag | null {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 60) return null;
    if (options.filterNoise && STOPWORDS.has(clean.toLowerCase())) return null;
    return this.library.tags.ensure({
      name: clean,
      kind,
      color: options.color ?? null,
      icon: options.icon ?? null,
      parentId: options.parentId ?? null,
    });
  }

  /**
   * Computes and applies tags for one video. Returns what was added so the
   * import report can show it.
   */
  apply(video: Video, metadata: VideoMetadata | null, options: ApplyOptions = {}): AutoTagResult {
    const tags: Tag[] = [];
    const settings = options.rulesOnly
      ? { ...DEFAULT_AUTO_TAG_SETTINGS, platform: false, creator: false, year: false, duration: false, hashtags: false, platformTags: false, language: false }
      : this.settings;

    if (settings.platform) {
      const label = PLATFORM_LABELS[video.platform] ?? video.platform;
      const tag = this.ensure(label, 'platform', { color: PLATFORM_COLORS[video.platform] });
      if (tag) tags.push(tag);
    }

    if (settings.creator && video.author?.name) {
      const tag = this.ensure(video.author.name, 'creator', { icon: '👤' });
      if (tag) tags.push(tag);
    }

    if (settings.year && video.publishedAt) {
      const year = new Date(video.publishedAt).getUTCFullYear();
      if (Number.isFinite(year)) {
        const tag = this.ensure(String(year), 'auto', { icon: '📅' });
        if (tag) tags.push(tag);
      }
    }

    if (settings.duration) {
      const bucket = durationBucket(video.durationSeconds);
      const label = DURATION_BUCKETS.find((b) => b.id === bucket)?.label;
      if (label) {
        const tag = this.ensure(label, 'auto', { icon: '⏱️' });
        if (tag) tags.push(tag);
      }
    }

    if (settings.hashtags) {
      const hashtags = [...extractHashtags(video.title), ...extractHashtags(video.description)];
      for (const hashtag of hashtags.slice(0, 10)) {
        const tag = this.ensure(hashtag, 'auto', { icon: '#', filterNoise: true });
        if (tag) tags.push(tag);
      }
    }

    if (settings.platformTags && metadata) {
      for (const name of metadata.platformTags.slice(0, settings.maxPlatformTags)) {
        const tag = this.ensure(name, 'auto', { filterNoise: true });
        if (tag) tags.push(tag);
      }
    }

    if (settings.language && video.language) {
      const tag = this.ensure(video.language.toUpperCase(), 'auto', { icon: '🌐' });
      if (tag) tags.push(tag);
    }

    const rulesFired: string[] = [];
    const subject = {
      title: video.title,
      description: video.description,
      author: video.author?.name ?? null,
      url: video.url,
      platformTags: metadata?.platformTags ?? [],
    };

    const allowed = options.ruleIds ? new Set(options.ruleIds) : null;

    for (const rule of this.library.rules.enabled()) {
      if (allowed && !allowed.has(rule.id)) continue;
      if (!ruleMatches(rule, subject)) continue;
      rulesFired.push(rule.id);

      for (const tagId of rule.tagIds) {
        const tag = this.library.tags.getById(tagId);
        if (tag) tags.push(tag);
      }
      for (const [key, value] of Object.entries(rule.setFields)) {
        try {
          this.library.videos.setCustomField(video.id, key, value);
        } catch {
          // The field was deleted after the rule was written; skip it.
        }
      }
      this.library.rules.countMatch(rule.id, 1);
    }

    const unique = [...new Map(tags.map((tag) => [tag.id, tag])).values()];
    if (unique.length > 0) {
      this.library.tags.addToVideos([video.id], unique.map((tag) => tag.id), 'auto');
      this.library.videos.reindex(video.id);
    }

    return { tagIds: unique.map((t) => t.id), tagNames: unique.map((t) => t.name), rulesFired };
  }

  /** Re-runs tagging across an existing set of videos. */
  applyToExisting(videoIds: string[], options: ApplyOptions = {}): { processed: number; tagsAdded: number } {
    let tagsAdded = 0;
    const run = this.library.transaction(() => {
      for (const id of videoIds) {
        const video = this.library.videos.getById(id);
        if (!video) continue;
        const result = this.apply(video, null, options);
        tagsAdded += result.tagIds.length;
      }
      return videoIds.length;
    });
    return { processed: run, tagsAdded };
  }
}

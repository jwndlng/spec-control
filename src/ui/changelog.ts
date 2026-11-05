// The build script replaces this value with the validated entry files. Keeping the
// browser-facing module free of filesystem access makes the list part of the bundle.
export interface ChangelogEntry {
  /** `<date>-<kebab-case-slug>`; never changed once released, since browsers remember which ids they have seen. */
  id: string;
  /** Calendar date the feature was merged, `YYYY-MM-DD`. */
  date: string;
  title: string;
  /** One or two sentences of Markdown. */
  summary: string;
  /** Stable same-day position for migrated entries; new entries use id order when omitted. */
  order?: number;
}

declare const __CHANGELOG_ENTRIES__: readonly ChangelogEntry[];
export const CHANGELOG: readonly ChangelogEntry[] = typeof __CHANGELOG_ENTRIES__ === "undefined" ? [] : __CHANGELOG_ENTRIES__;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function daysSince(iso: string | undefined, now = Date.now()): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : Math.floor((now - t) / DAY);
}

/** "just now", "5m", "3h", "12d" — compact, for card footers. */
export function relTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  const days = Math.floor(diff / DAY);
  return days < 60 ? `${days}d` : `${Math.floor(days / 30)}mo`;
}

const BRANCH_SEPARATORS = "-/_.";

/**
 * Splits a branch name for the two-part badge: `head` may be clipped with an ellipsis, `tail` is always
 * shown, so the distinguishing end of a long name stays readable. Short names are not split. The tail
 * starts at a word boundary when one is at most `nudge` characters further left.
 */
export function splitBranchLabel(name: string, tailLength = 16, nudge = 4): { head: string; tail: string } {
  if (name.length <= tailLength + nudge) return { head: name, tail: "" };
  let start = name.length - tailLength;
  if (BRANCH_SEPARATORS.includes(name[start])) {
    start += 1; // the cut landed on a separator: it belongs to the head
  } else {
    for (let i = start; i >= start - nudge && i > 0; i--) {
      if (BRANCH_SEPARATORS.includes(name[i - 1])) {
        start = i;
        break;
      }
    }
  }
  return { head: name.slice(0, start), tail: name.slice(start) };
}

/** A path split for a head-clipped badge: everything up to the last separator, and the last segment that always shows. */
export function splitPathLabel(path: string): { head: string; tail: string } {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  if (cut <= 0) return { head: trimmed, tail: "" };
  return { head: trimmed.slice(0, cut + 1), tail: trimmed.slice(cut + 1) };
}

/**
 * Tooltip for a card's branch badge: where the change's data comes from, and which other checkouts hold a copy that
 * is at a different point.
 */
export function checkoutHint(change: { checkout?: { path: string; isMain: boolean }; otherCheckouts?: { branch?: string; isMain: boolean; column: string }[] }): string {
  const lines = [change.checkout && !change.checkout.isMain ? `lives in worktree ${change.checkout.path}` : "a branch or worktree matches this change"];
  for (const other of change.otherCheckouts ?? []) lines.push(`also in: ${other.isMain ? "main checkout" : (other.branch ?? "detached worktree")} — ${other.column}`);
  return lines.join("\n");
}

/**
 * An archive found only in a linked worktree: agents archive on a branch, and the main checkout catches up when that
 * branch is merged and pulled. Undefined for ordinary archives (and for anything that is not archived).
 */
export function pendingArchiveHint(change: { archived?: string | null; checkout?: { path: string; branch?: string; isMain: boolean }; otherCheckouts?: { branch?: string; isMain: boolean; column: string }[] }): { label: string; title: string } | undefined {
  if (!change.archived || !change.checkout || change.checkout.isMain) return undefined;
  const where = change.checkout.branch ?? "a detached worktree";
  const lines = [`archived on ${where}, in worktree ${change.checkout.path} — the main checkout does not have this archive yet`];
  for (const other of change.otherCheckouts ?? []) lines.push(`still active in: ${other.isMain ? "main checkout" : (other.branch ?? "detached worktree")} — ${other.column}`);
  lines.push("merge that branch and update the main checkout to bring it here");
  return { label: `on ${where} · not in main checkout`, title: lines.join("\n") };
}

/**
 * An archive in the main checkout next to an active copy of the same change there — usually its uncommitted original,
 * left behind when the archive arrived by a merge, or, for a duplicate after archive, committed next to the archive on
 * the default branch. The scanner reports it as one archived change and lists the copy among its other checkouts; this
 * says so. The dashboard never removes it.
 */
export function leftoverHint(change: { name: string; archived?: string | null; checkout?: { isMain: boolean }; otherCheckouts?: { isMain: boolean; column: string }[]; duplicate?: object }): { label: string; title: string } | undefined {
  if (!change.archived || (change.checkout && !change.checkout.isMain)) return undefined;
  const left = change.otherCheckouts?.find((o) => o.isMain);
  if (!left) return undefined;
  const dir = `openspec/changes/${change.name}/`;
  // A duplicate after archive is committed: removing it in the main checkout would leave a deletion nobody commits.
  const title = (
    change.duplicate
      ? [
          `${dir} is still in the main checkout, where it would be in ${left.column}`,
          "it is committed next to its archive on the default branch: the archive commit never removed it",
          `its deletion has to be committed to the default branch — see the stale notice`,
        ]
      : [
          `${dir} is still in the main checkout, where it would be in ${left.column}`,
          "it usually holds files that were never committed and stayed behind when the archive arrived",
          `remove ${dir} to clear this`,
        ]
  ).join("\n");
  return { label: `active copy left · ${left.column}`, title };
}

/** How a change is referred to outside the dashboard: the repository's display name, a slash, the change name. */
export function changeRef(project: string, change: string): string {
  return `${project}/${change}`;
}

export function cdCommand(repoPath: string): string {
  return `cd ${shellQuote(repoPath)}`;
}

function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./~-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

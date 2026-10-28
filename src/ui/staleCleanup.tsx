// Cleaning up a stale change (stale-changes: "A stale change's leftovers are cleaned up on one confirmation"): the list
// of what is left over and kept, shared by the change detail's dialog and the end-session dialog, and the per-item
// outcome. Nothing is removed before the user confirms, and the server re-checks every item when they do.
import { useEffect, useState } from "preact/hooks";
import type { KeptLeftover, StaleCleanupPreview, StaleCleanupResult, StaleLeftover } from "../shared/types.ts";
import { api } from "./api.ts";
import { IconGitBranch } from "./icons.tsx";
import { CopyButton } from "./kanban.tsx";
import { Modal } from "./modal.tsx";
import { cleanupItemText, leftoverLabel, needsAcknowledgement, outsidePaths, restoreCommands, staleRequest } from "./staleState.ts";

function Files({ paths, total, outside }: { paths: readonly string[]; total: number; outside: ReadonlySet<string> }) {
  const hidden = total - paths.length;
  return (
    <details class="delete-branch-files" open={total <= 10}>
      <summary>Uncommitted files ({total})</summary>
      <ul class="cleanup-list">
        {paths.map((f) => (
          <li key={f} class="mono">
            {f}
            {outside.has(f) && <span class="hint"> · outside the change</span>}
          </li>
        ))}
        {hidden > 0 && <li class="hint">and {hidden} more</li>}
      </ul>
    </details>
  );
}

function Leftover({ leftover, outside }: { leftover: StaleLeftover; outside: ReadonlySet<string> }) {
  return (
    <li>
      <strong>{leftoverLabel(leftover)}</strong>
      {leftover.kind === "worktree" && (
        <>
          <div class="details-line">
            <code class="details-path">{leftover.path}</code>
            {leftover.managed && <span class="hint"> · created by the dashboard for an agent session</span>}
          </div>
          {leftover.uncommittedCount > 0 && <Files paths={leftover.uncommitted} total={leftover.uncommittedCount} outside={outside} />}
        </>
      )}
      {leftover.kind === "branch" && <div class="hint mono">{leftover.commit}</div>}
      {leftover.kind === "main" && (
        <Files paths={leftover.files.map((f) => `${f.path}${f.staged ? " (staged)" : ""}`)} total={leftover.files.length} outside={outside} />
      )}
    </li>
  );
}

/**
 * What a stale change left behind and what is kept, as the user confirms it. `compact` drops the closing note on
 * backups, which the end-session dialog gives as its option's hover description instead.
 */
export function StaleLeftoverList({ leftovers, kept, compact = false }: { leftovers: readonly StaleLeftover[]; kept: readonly KeptLeftover[]; compact?: boolean }) {
  const outside = new Set(outsidePaths(leftovers));
  return (
    <>
      {leftovers.length > 0 && (
        <ul class="stale-leftovers">
          {leftovers.map((l) => (
            <Leftover key={l.kind === "worktree" ? l.path : l.kind === "branch" ? l.name : l.dir} leftover={l} outside={outside} />
          ))}
        </ul>
      )}
      {kept.length > 0 && (
        <div class="hint">
          Kept:
          <ul class="cleanup-list">
            {kept.map((k) => (
              <li key={`${k.kind}:${k.id}`}>
                <span class="mono">{k.id}</span> — {k.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {leftovers.length > 0 && !compact && (
        <p class="hint">
          Uncommitted files are copied under the dashboard's home first. Ignored files in a worktree (dependencies, build output, local environment files) are
          deleted without a copy. Remote branches and remote-tracking refs are never touched, and session records stay as history.
        </p>
      )}
    </>
  );
}

/** The files outside the change, at most three by name: "a, b, c and 2 more". */
function namedOutside(leftovers: readonly StaleLeftover[]): string {
  const outside = outsidePaths(leftovers);
  const more = outside.length > 3 ? ` and ${outside.length - 3} more` : "";
  return `${outside.slice(0, 3).join(", ")}${more}`;
}

/** The acknowledgement, naming the files outside the change that removing the leftovers deletes after a copy. */
export function acknowledgementText(leftovers: readonly StaleLeftover[]): string {
  return `Delete ${namedOutside(leftovers)} too — uncommitted outside the change — after a copy is kept`;
}

/** The end-session dialog's one line under Clean up leftovers, where selecting the option is the acknowledgement. */
export function outsideNote(leftovers: readonly StaleLeftover[]): string {
  return `Also deletes ${namedOutside(leftovers)} — outside the change, copied first`;
}

/** Per item, what the cleanup did; the backup folders and the commands that restore a deleted branch. */
export function StaleCleanupOutcome({ result }: { result: StaleCleanupResult }) {
  const restore = restoreCommands(result);
  const backups = result.items.filter((i) => i.backupDir);
  return (
    <>
      {result.refused ? (
        <div class="notice danger" role="status">
          Nothing was cleaned up: {result.refused}.
        </div>
      ) : (
        <ul class="cleanup-list" role="status">
          {result.items.map((i) => (
            <li key={`${i.kind}:${i.id}`} class={i.outcome === "kept" ? "warn" : undefined}>
              {cleanupItemText(i)}
            </li>
          ))}
        </ul>
      )}
      {backups.map((i) => (
        <p key={i.backupDir} class="details-line">
          {i.backedUp === 1 ? "1 file was" : `${i.backedUp} files were`} copied to <code>{i.backupDir}</code> <CopyButton text={i.backupDir as string} label="Copy" />
        </p>
      ))}
      {restore.map((command) => (
        <p key={command} class="details-line">
          Restore with <code>{command}</code> <CopyButton text={command} label="Copy" />
        </p>
      ))}
    </>
  );
}

/** Opened from the change detail's stale notice; `onDone` rescans after anything was removed. */
export function StaleCleanupDialog({ repoId, change, onClose, onDone, returnFocus }: { repoId: string; change: string; onClose: () => void; onDone: () => void; returnFocus: () => HTMLElement | null }) {
  const [preview, setPreview] = useState<StaleCleanupPreview>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StaleCleanupResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stale = false;
    api
      .staleCleanupPreview(repoId, change)
      .then((p) => !stale && setPreview(p))
      .catch((err) => !stale && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      stale = true;
    };
  }, [repoId, change]);

  const leftovers = preview?.stale?.leftovers ?? [];
  const needsAck = needsAcknowledgement(leftovers);
  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const done = await api.staleCleanup(repoId, change, staleRequest(leftovers, acknowledged));
      setResult(done);
      if (done.items.some((i) => i.outcome !== "kept")) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const ready = leftovers.length > 0 && !busy && (!needsAck || acknowledged);
  return (
    <Modal
      label={`Clean up leftovers of ${change}`}
      title="Clean up leftovers"
      subtitle={<span class="mono">{change}</span>}
      icon={<IconGitBranch size={18} />}
      onClose={onClose}
      canClose={() => !busy}
      returnFocus={returnFocus}
    >
      <div class="delete-branch stale-cleanup">
        {!preview && !error && <div class="hint">Checking what is left over…</div>}
        {result ? (
          <StaleCleanupOutcome result={result} />
        ) : (
          preview && (
            <>
              {preview.stale ? (
                <p class="details-line">
                  Archived as <span class="mono">{preview.stale.archive}</span> on the default branch, and merged: what is left over is not needed on its branches.
                </p>
              ) : (
                <div class="notice warn" role="note">
                  The change is not archived on the default branch: nothing is left over to clean up.
                </div>
              )}
              {preview.stale && leftovers.length === 0 && <div class="notice">Nothing is left over that could be cleaned up now.</div>}
              {preview.stale && <StaleLeftoverList leftovers={leftovers} kept={preview.stale.kept} />}
              {needsAck && (
                <label class="check">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.currentTarget.checked)} />
                  <span>{acknowledgementText(leftovers)}</span>
                </label>
              )}
            </>
          )
        )}
        {error && <div class="notice danger">{error}</div>}
        <div class="row">
          {result ? (
            <>
              <span style={{ flex: 1 }} />
              <button type="button" class="btn sm primary" onClick={onClose}>
                Close
              </button>
            </>
          ) : (
            <>
              <button type="button" class="btn sm ghost" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" class="btn sm danger" disabled={!ready} onClick={() => void confirm()}>
                {busy ? "Cleaning up…" : "Clean up"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

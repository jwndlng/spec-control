// Repository cleanup (openspec/specs/repository-cleanup): a dialog listing the repository's leftover worktrees, stale
// worktree records and merged branches. Nothing is removed until the user confirms; the server re-checks every item.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { CleanupBranch, CleanupPreview, CleanupResult, CleanupWorktree, WorkStatus } from "../shared/types.ts";
import { api } from "./api.ts";
import {
  confirmLabel,
  hasRemovable,
  initialSelection,
  outcomeText,
  restoreCommand,
  selectionPayload,
  toggleBranch,
  toggleWorktree,
  type Selected,
} from "./cleanupState.ts";
import { relTime } from "./format.ts";
import { CopyButton } from "./kanban.tsx";
import type { ActionDescription } from "./projectDetails.ts";

const HINT =
  "Remove this repository's worktrees and local branches whose work is merged, after you confirm. Never deletes remote branches and never contacts a remote.";

/** `description` (the board's): the tooltip, and the accessible description through the element with its id. */
export function CleanupButton({ repoId, repoName, onDone, description }: { repoId: string; repoName: string; onDone: () => void; description?: ActionDescription }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="btn sm" title={description?.text ?? HINT} aria-describedby={description?.id} onClick={() => setOpen(true)}>
        Clean up
      </button>
      {open && <CleanupDialog repoId={repoId} repoName={repoName} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function workLabel(work: WorkStatus): string {
  if (work.state === "uncommitted") return `${work.count ?? ""} uncommitted`.trim();
  if (work.state === "unpushed") return `${work.count ?? ""} unpushed`.trim();
  return work.state;
}

function Kept({ count, children }: { count: number; children: ComponentChildren }) {
  if (count === 0) return null;
  return (
    <details class="cleanup-kept">
      <summary>Kept ({count})</summary>
      <ul class="cleanup-list">{children}</ul>
    </details>
  );
}

/** A removable item is a checkbox with its description as label; a kept one is the description alone. */
function Row({ selected, onToggle, children }: { selected?: boolean; onToggle?: (on: boolean) => void; children: ComponentChildren }) {
  return (
    <li>
      {onToggle ? (
        <label class="check">
          <input type="checkbox" checked={selected} onChange={(e) => onToggle(e.currentTarget.checked)} />
          {children}
        </label>
      ) : (
        <div class="check">{children}</div>
      )}
    </li>
  );
}

function WorktreeRow({ w, selected, onToggle }: { w: CleanupWorktree; selected?: boolean; onToggle?: (on: boolean) => void }) {
  return (
    <Row selected={selected} onToggle={onToggle}>
      <span>
        <span class="mono">{w.path}</span> <span class="badge">{w.branch ?? "detached"}</span> <span class="badge">{workLabel(w.work)}</span>
        {w.managed && (
          <span class="badge" title="Created by the dashboard for an agent session">
            session
          </span>
        )}
        {w.lastCommitAt && <span class="hint"> · last commit {relTime(w.lastCommitAt)}</span>}
        {w.reason && <span class="hint"> — {w.reason}</span>}
      </span>
    </Row>
  );
}

function BranchRow({ b, selected, onToggle }: { b: CleanupBranch; selected?: boolean; onToggle?: (on: boolean) => void }) {
  return (
    <Row selected={selected} onToggle={onToggle}>
      <span>
        <span class="mono">{b.name}</span>
        {b.mergedBy && <span class="badge">{b.mergedBy === "content" ? "squash-merged" : "merged"}</span>}
        {b.lastCommitAt && <span class="hint"> · last commit {relTime(b.lastCommitAt)}</span>}
        {b.removable && b.worktreePath && <span class="hint"> · goes with its worktree</span>}
        {b.reason && <span class="hint"> — {b.reason}</span>}
      </span>
    </Row>
  );
}

function Result({ result, onClose }: { result: CleanupResult; onClose: () => void }) {
  return (
    <>
      <div id="cleanup-body" class="dialog-body">
        <ul class="cleanup-list">
          {result.items.map((item) => {
            const restore = restoreCommand(item);
            return (
              <li key={`${item.kind}:${item.id}`}>
                <span class="badge">{item.kind === "prune" ? "record" : item.kind}</span> <span class="mono">{item.id}</span>{" "}
                <span class={item.outcome === "kept" ? "hint" : ""}>{outcomeText(item)}</span>
                {restore && (
                  <span class="cleanup-restore">
                    {" "}
                    · restore with <code>{restore}</code> <CopyButton text={restore} label="Copy" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {result.items.length === 0 && <div class="hint">Nothing was selected.</div>}
      </div>
      <div class="row">
        <span style={{ flex: 1 }} />
        <button type="button" class="btn sm primary" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}

export function CleanupDialog({ repoId, repoName, onClose, onDone }: { repoId: string; repoName: string; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<CleanupPreview>();
  const [selected, setSelected] = useState<Selected>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CleanupResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stale = false;
    api
      .cleanupPreview(repoId)
      .then((p) => {
        if (stale) return;
        setPreview(p);
        setSelected(initialSelection(p));
      })
      .catch((err) => !stale && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      stale = true;
    };
  }, [repoId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    if (!preview || !selected) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api.cleanup(repoId, selectionPayload(preview, selected)));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const label = preview && selected ? confirmLabel(preview, selected) : "";
  const removableWorktrees = preview?.worktrees.filter((w) => w.removable) ?? [];
  const keptWorktrees = preview?.worktrees.filter((w) => !w.removable) ?? [];
  const removableBranches = preview?.branches.filter((b) => b.removable) ?? [];
  const keptBranches = preview?.branches.filter((b) => !b.removable) ?? [];

  return (
    <div class="overlay">
      <div class="dialog cleanup-dialog" role="dialog" aria-modal="true" aria-labelledby="cleanup-title" aria-describedby="cleanup-body">
        <strong id="cleanup-title">
          {result ? "Cleaned up " : "Clean up "}
          <span class="mono">{repoName}</span>
        </strong>
        {result ? (
          <Result result={result} onClose={onClose} />
        ) : (
          <>
            <div id="cleanup-body" class="dialog-body">
              {!preview && !error && <div class="hint">Checking worktrees and branches…</div>}
              {preview && selected && (
                <>
                  <div class="hint">
                    Offered: worktrees without uncommitted files whose work is merged or exists elsewhere, and local branches whose work is in{" "}
                    <span class="mono">{preview.base ?? "the default branch"}</span>. "Merged" is as of your last fetch — pull first to bring it up to date.
                    Removing a worktree also deletes its ignored files (dependencies, build output, local environment files). Remote branches are never touched.
                  </div>
                  {!hasRemovable(preview) && <div class="notice">Nothing to clean up.</div>}

                  <h3 class="cleanup-heading">Worktrees</h3>
                  {removableWorktrees.length > 0 && (
                    <ul class="cleanup-list">
                      {removableWorktrees.map((w) => (
                        <WorktreeRow
                          key={w.path}
                          w={w}
                          selected={selected.worktrees.has(w.path)}
                          onToggle={(on) => setSelected(toggleWorktree(preview, selected, w.path, on))}
                        />
                      ))}
                    </ul>
                  )}
                  {preview.worktrees.length === 0 && <div class="hint">No linked worktrees.</div>}
                  <Kept count={keptWorktrees.length}>
                    {keptWorktrees.map((w) => (
                      <WorktreeRow key={w.path} w={w} />
                    ))}
                  </Kept>

                  {preview.prunable.length > 0 && (
                    <>
                      <h3 class="cleanup-heading">Stale worktree records</h3>
                      <label class="check">
                        <input type="checkbox" checked={selected.prune} onChange={(e) => setSelected({ ...selected, prune: e.currentTarget.checked })} />
                        <span>
                          prune {preview.prunable.length === 1 ? "the record" : `${preview.prunable.length} records`} whose directory is gone:{" "}
                          {preview.prunable.map((p, i) => (
                            <span key={p.path}>
                              {i > 0 && ", "}
                              <span class="mono">{p.path}</span>
                            </span>
                          ))}
                        </span>
                      </label>
                    </>
                  )}

                  <h3 class="cleanup-heading">Branches</h3>
                  {removableBranches.length > 0 && (
                    <ul class="cleanup-list">
                      {removableBranches.map((b) => (
                        <BranchRow
                          key={b.name}
                          b={b}
                          selected={selected.branches.has(b.name)}
                          onToggle={(on) => setSelected(toggleBranch(preview, selected, b.name, on))}
                        />
                      ))}
                    </ul>
                  )}
                  {preview.branches.length === 0 && <div class="hint">No local branches besides the default branch.</div>}
                  <Kept count={keptBranches.length}>
                    {keptBranches.map((b) => (
                      <BranchRow key={b.name} b={b} />
                    ))}
                  </Kept>
                </>
              )}
              {error && <div class="notice danger">{error}</div>}
            </div>
            <div class="row">
              <button type="button" class="btn sm ghost" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" class="btn sm danger" disabled={busy || !label} onClick={() => void confirm()}>
                {busy ? "Cleaning up…" : label || "Nothing selected"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

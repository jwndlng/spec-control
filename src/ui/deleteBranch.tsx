// Deleting one branch and its worktree whatever they hold (repository-cleanup: "One branch and its worktree can be
// deleted whatever they hold"): a dialog over the project details that shows what would be lost, asks for an explicit
// acknowledgement when work is at stake, and deletes nothing until the user confirms. The server re-checks everything.
import { useEffect, useState } from "preact/hooks";
import type { BranchDeletePreview, BranchDeleteResult } from "../shared/types.ts";
import { api } from "./api.ts";
import { acknowledgement, atStake, confirmLabel, lossFacts, restoreCommand, resultText } from "./deleteBranchState.ts";
import { IconGitBranch } from "./icons.tsx";
import { CopyButton } from "./kanban.tsx";
import { Modal } from "./modal.tsx";

function Preview({ preview }: { preview: BranchDeletePreview }) {
  const facts = lossFacts(preview);
  const hidden = preview.uncommittedCount - preview.uncommitted.length;
  return (
    <>
      <p class="details-line">
        <code class="details-path">{preview.path}</code>
        {preview.managed && <span class="hint"> · created by the dashboard for an agent session</span>}
      </p>
      {facts.length === 0 ? (
        <div class="notice">Nothing here exists only in this worktree: it is clean and its work is in {preview.base ?? "the default branch"}.</div>
      ) : (
        <div class="notice danger" role="note">
          <strong>This deletes work that exists nowhere else:</strong>
          <ul class="delete-branch-facts">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.uncommittedCount > 0 && (
        <details class="delete-branch-files" open={preview.uncommittedCount <= 10}>
          <summary>Uncommitted files ({preview.uncommittedCount})</summary>
          <ul class="cleanup-list">
            {preview.uncommitted.map((f) => (
              <li key={f} class="mono">
                {f}
              </li>
            ))}
            {hidden > 0 && <li class="hint">and {hidden} more</li>}
          </ul>
        </details>
      )}
      <p class="hint">
        Ignored files in the worktree (dependencies, build output, local environment files) are deleted without a copy. Remote branches are never
        touched, and the branch can be restored from the command shown afterwards.
      </p>
    </>
  );
}

function Result({ result }: { result: BranchDeleteResult }) {
  const restore = restoreCommand(result);
  return (
    <>
      <div class={`notice ${result.outcome === "refused" ? "danger" : ""}`} role="status">
        {resultText(result)}
      </div>
      {result.backupDir && (
        <p class="details-line">
          {result.backedUp === 1 ? "1 uncommitted file was" : `${result.backedUp} uncommitted files were`} copied to <code>{result.backupDir}</code>{" "}
          <CopyButton text={result.backupDir} label="Copy" />
        </p>
      )}
      {restore && (
        <p class="details-line">
          Restore the branch with <code>{restore}</code> <CopyButton text={restore} label="Copy" />
          <span class="hint"> — soon: git eventually discards commits no branch points to.</span>
        </p>
      )}
    </>
  );
}

/** Opened from a worktree row of the project details' Checkouts section; `onDone` rescans after a deletion. */
export function DeleteBranchDialog({
  repoId,
  path,
  label,
  onClose,
  onDone,
  returnFocus,
  note,
}: {
  repoId: string;
  path: string;
  /** The branch, or that the worktree is detached: the dialog's subtitle before the preview has loaded. */
  label: string;
  onClose: () => void;
  onDone: () => void;
  returnFocus: () => HTMLElement | null;
  /** Why the dialog was opened, said above the preview — e.g. that a stale worktree's content is archived already. */
  note?: string;
}) {
  const [preview, setPreview] = useState<BranchDeletePreview>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BranchDeleteResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stale = false;
    api
      .branchDeletePreview(repoId, path)
      .then((p) => !stale && setPreview(p))
      .catch((err) => !stale && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      stale = true;
    };
  }, [repoId, path]);

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    try {
      const done = await api.deleteBranch(repoId, { path: preview.path, branch: preview.branch ?? null, commit: preview.commit, statusDigest: preview.statusDigest });
      setResult(done);
      if (done.outcome !== "refused") onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const needsAck = preview ? atStake(preview) : false;
  const ready = preview && !preview.refused && !busy && (!needsAck || acknowledged);
  return (
    <Modal
      label={`Delete ${label}`}
      title={preview?.branch || !preview ? "Delete branch" : "Remove worktree"}
      subtitle={<span class="mono">{preview?.branch ?? label}</span>}
      icon={<IconGitBranch size={18} />}
      onClose={onClose}
      canClose={() => !busy}
      returnFocus={returnFocus}
    >
      <div class="delete-branch">
        {note && !result && <p class="details-line">{note}</p>}
        {!preview && !error && <div class="hint">Checking what this worktree holds…</div>}
        {result ? (
          <Result result={result} />
        ) : (
          preview && (
            <>
              {preview.refused ? (
                <div class="notice warn" role="note">
                  Deleting is refused: {preview.refused}.
                </div>
              ) : (
                <Preview preview={preview} />
              )}
              {!preview.refused && needsAck && (
                <label class="check">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.currentTarget.checked)} />
                  <span>{acknowledgement(preview)}</span>
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
                {busy ? "Deleting…" : preview ? confirmLabel(preview) : "Delete"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// One GitHub clone, shown the same way wherever it appears (github-repositories): Unmanaged projects on the overview
// and the setup wizard's Done step. Its state in words, a progress bar with the phase, percentage and elapsed time while
// it is queued or runs, its reason when it failed, and the actions its state allows — Cancel while queued or running,
// Retry and Dismiss once failed or cancelled. Hook-free, so tests walk it without a DOM; the host passes the clock.
import type { GithubClone } from "../shared/types.ts";
import { cloneOutcome, cloneProgressView, isCloneActive, isCloneRetryable } from "./githubState.ts";

/** Cancel, Retry and Dismiss of a clone, by clone id; `busy` and `errors` are per clone. */
export interface CloneActions {
  busy: Record<string, "cancel" | "retry" | "dismiss">;
  errors: Record<string, string>;
  cancel(clone: GithubClone): void;
  retry(clone: GithubClone): void;
  dismiss(clone: GithubClone): void;
}

export interface CloneRowProps {
  clone: GithubClone;
  /** The page's clock, for the elapsed time. */
  now: number;
  /** What names the row: its folder, with `owner/name` beside it (Unmanaged projects), or `owner/name` (Done step). */
  naming?: "folder" | "repo";
  actions?: CloneActions;
}

/** The bar of a queued or running clone: a native progress indicator, indeterminate until git gives a percentage. */
export function CloneProgress({ clone, now }: { clone: GithubClone; now: number }) {
  const bar = cloneProgressView(clone, now);
  if (!bar) return null;
  return (
    <span class="clone-progress">
      <progress max={100} value={bar.indeterminate ? undefined : bar.percent} aria-label={`Clone of ${clone.repo}`} aria-valuetext={bar.valueText} />
      <span class="clone-progress-label">
        {bar.label}
        {bar.stalled && <span class="clone-progress-stalled"> — {bar.stalled}</span>}
      </span>
    </span>
  );
}

export function CloneRow({ clone, now, naming = "folder", actions }: CloneRowProps) {
  const outcome = cloneOutcome(clone);
  const busy = actions?.busy[clone.id];
  const error = actions?.errors[clone.id];
  return (
    <li class={`untracked-entry clone-row ${clone.state}`}>
      <span class="untracked-label">
        <span class="untracked-name">{naming === "folder" ? clone.name : clone.repo}</span>
        <span class={`badge untracked-kind clone-state ${outcome.tone}`.trim()} title={outcome.detail}>
          {outcome.label}
        </span>
      </span>
      {naming === "folder" && <span class="untracked-meta mono">{clone.repo}</span>}
      <code class="untracked-path" title={clone.path}>
        {clone.path}
      </code>
      {actions && (
        <span class="untracked-actions">
          {isCloneActive(clone) && (
            <button type="button" class="btn sm ghost" disabled={busy !== undefined} title={clone.state === "queued" ? "Take it out of the queue; git never starts" : "Stop git and remove the folder if git left it empty"} onClick={() => actions.cancel(clone)}>
              {busy === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
          )}
          {isCloneRetryable(clone) && (
            <>
              <button type="button" class="btn sm" disabled={busy !== undefined} title={`Clone ${clone.repo} into ${clone.path} again`} onClick={() => actions.retry(clone)}>
                {busy === "retry" ? "Retrying…" : "Retry"}
              </button>
              <button type="button" class="btn sm ghost" disabled={busy !== undefined} title="Remove this entry; nothing on disk changes" onClick={() => actions.dismiss(clone)}>
                {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
              </button>
            </>
          )}
        </span>
      )}
      <CloneProgress clone={clone} now={now} />
      {isCloneRetryable(clone) && clone.reason && <span class="untracked-error">{clone.reason}</span>}
      {clone.state === "integratable" && <span class="clone-note">Integrate it under Unmanaged projects on the overview.</span>}
      {error && (
        <span class="untracked-error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}

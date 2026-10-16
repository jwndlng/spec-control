// Ending a session, from a card or from the panel, goes through this one dialog. It asks as loudly as the work in the
// worktree is unshipped, on the strength of a status read at this moment rather than the list's cached one, and it is
// where the user can bring the repository's main checkout up to date with work that landed.
import { useEffect, useState } from "preact/hooks";
import type { PullResult, WorkStatus } from "../shared/types.ts";
import { api } from "./api.ts";
import { PullBlockedList, usePull } from "./pull.tsx";
import { pullNeedsReport, pullOutcome } from "./pullState.ts";
import { inPlaceLeftover } from "./inPlaceText.ts";
import { endConfirmable, endSeverity, endWarning, pullOffer, removalPreselected, reportShip, worktreeRemovalPossible } from "./sessionState.ts";
import { useSessionUi } from "./sessions.tsx";

interface Status {
  removable: boolean;
  reason?: string;
  work?: WorkStatus;
}

/** What is left of the dialog once the session has ended but the pull did not bring the checkout up to date. */
interface Report {
  result: PullResult;
  worktreeRemoved: boolean;
}

export function EndSessionDialog() {
  const ui = useSessionUi();
  const pulls = usePull();
  const id = ui.endingId;
  const session = ui.sessions.find((s) => s.id === id);
  const repo = ui.snapshot?.repos.find((r) => r.id === session?.repoId);
  const [status, setStatus] = useState<Status>();
  const [remove, setRemove] = useState(false);
  // Undefined until the user touches it, so the offer can stay in step with a status or snapshot that arrives later.
  const [pullChoice, setPullChoice] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setStatus(undefined);
    setRemove(false);
    setPullChoice(undefined);
    setBusy(false);
    setPulling(false);
    setReport(undefined);
    setError(undefined);
    if (!id) return;
    // An in-place session has no worktree: nothing to check, nothing to remove.
    if (!worktreeRemovalPossible(session)) return;
    let stale = false;
    api
      .worktreeStatus(id)
      .then((result) => {
        if (stale) return;
        setStatus(result);
        setRemove(removalPreselected(result)); // nothing would be lost: removing the worktree is what is left to do
      })
      .catch(() => !stale && setStatus({ removable: false, reason: "could not check the worktree" }));
    return () => {
      stale = true;
    };
  }, [id]);

  // Escape cancels, wherever the keyboard focus is (it is usually still in the terminal).
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && ui.requestEnd(undefined);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, ui.requestEnd]);

  if (!id || !session) return null;
  const hasWorktree = worktreeRemovalPossible(session);
  const running = session.state === "running";
  const severity = endSeverity(status?.work);
  const warning = endWarning(status?.work);
  const offer = pullOffer(repo, session);
  const pullSelected = offer.offered && (pullChoice ?? offer.preselected);
  const close = () => ui.requestEnd(undefined);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await ui.refresh();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  /**
   * End, then remove, then pull: the removal is decided on the work status the user was shown, and a fast-forward
   * moves the base that status is derived from. An outcome that left the checkout behind turns the dialog into a
   * report instead of closing it — a pull that did not happen is the outdated view this offer exists to prevent.
   */
  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    let worktreeRemoved = false;
    try {
      const result = await api.closeSession(session.id, remove && status?.removable === true);
      worktreeRemoved = result.worktree?.removable === true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return;
    }
    if (!pullSelected) {
      await ui.refresh();
      close();
      return;
    }
    setPulling(true);
    const result = await pulls.pull(session.repoId); // never rejects; a failed call comes back as a `failed` result
    await ui.refresh();
    if (!pullNeedsReport(result)) {
      close();
      return;
    }
    setReport({ result, worktreeRemoved });
    setPulling(false);
    setBusy(false);
  };

  if (report) {
    // Resolve and pull can be confirmed from right here, so the report follows the repository's live pull outcome.
    const live = pulls.states[session.repoId];
    const result = live && live !== "running" ? live : report.result;
    const outcome = pullOutcome(result);
    const updated = result.update === "fast-forwarded" || result.update === "up-to-date";
    return (
      <div class="overlay end-overlay">
        <div class="dialog end-dialog" role="alertdialog" aria-modal="true" aria-labelledby="end-title" aria-describedby="end-body">
          <strong id="end-title">
            Pull {outcome.label} for <span class="mono">{repo?.name ?? session.repoId}</span>
          </strong>
          <div id="end-body" class="dialog-body">
            <div class={`notice ${outcome.tone}`}>
              <strong>
                {outcome.tone === "danger" ? "⚠ " : ""}
                {updated ? "The main checkout was updated. " : "The main checkout was not updated. "}
              </strong>
              {outcome.detail}
            </div>
            {(result.blocking !== undefined || result.resolved !== undefined) && (
              <PullBlockedList result={result} running={live === "running"} onResolve={(claim) => void pulls.resolve(session.repoId, claim)} />
            )}
            <div class="hint">
              The session for <span class="mono">{session.change}</span> has ended{report.worktreeRemoved ? " and its worktree was removed" : ""}.{" "}
              {updated
                ? "Archives, specs and progress shown for this repository now come from the updated checkout."
                : "Archives, specs and progress shown for this repository still come from the checkout as it is, so they may be outdated; you can pull again from the board header."}
            </div>
          </div>
          <div class="row">
            <span style={{ flex: 1 }} />
            <button type="button" class="btn sm primary" onClick={close}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="overlay end-overlay">
      <div class="dialog end-dialog" role="alertdialog" aria-modal="true" aria-labelledby="end-title" aria-describedby="end-body">
        <strong id="end-title">
          {running ? "End the session for " : "Clean up the session for "}
          <span class="mono">{session.change}</span>?
        </strong>
        <div id="end-body" class="dialog-body">
          {!status && hasWorktree && <div class="hint">Checking the worktree…</div>}
          {warning && (
            <div class={`notice ${severity === "danger" ? "danger" : "warn"}`}>
              <strong>{severity === "danger" ? "⚠ Not shipped. " : "Note: "}</strong>
              {warning}
            </div>
          )}
          {!hasWorktree ? (
            <div class="hint">
              {running && `${session.agentName} is stopped, as if you closed its terminal window. `}
              Whatever the agent changed stays in <span class="mono">{session.worktreePath}</span>
              {inPlaceLeftover(repo?.isGit)}
            </div>
          ) : (
            <div class="hint">
              {running && `${session.agentName} is stopped, as if you closed its terminal window. `}
              The worktree and its branch <span class="mono">{session.branch}</span> are kept{status?.removable ? " unless you remove the worktree below" : ""}; its work stays on the change's card until
              it is merged.
            </div>
          )}
          {hasWorktree &&
            (status?.removable ? (
              <label class="check">
                <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.currentTarget.checked)} /> also remove the worktree (clean, and its work is merged or exists elsewhere)
              </label>
            ) : (
              status?.reason && <div class="hint">The worktree cannot be removed: {status.reason}.</div>
            ))}
          {offer.offered && (
            <label class="check" title="Fetches the repository's remote and fast-forwards its main checkout. Never merges, rebases, stashes or switches branches; off the default branch it only fetches.">
              <input type="checkbox" checked={pullSelected} onChange={(e) => setPullChoice(e.currentTarget.checked)} />
              {/* One flex item: `.check` is a flex row, and the repository name would otherwise become a column of its own. */}
              <span>
                also pull <span class="mono">{repo?.name}</span> (fast-forwards its main checkout, so the board does not keep showing this change as unmerged)
              </span>
            </label>
          )}
          {error && <div class="notice danger">{error}</div>}
        </div>
        <div class="row">
          <button type="button" class="btn sm ghost" onClick={close}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          {severity === "danger" && (
            <button
              type="button"
              class="btn sm primary"
              disabled={busy}
              title={`Asks ${session.agentName} to commit, push and open a pull request instead of ending`}
              onClick={() =>
                run(async () => {
                  const result = await api.shipSession(session.id);
                  ui.openPanel(session.id);
                  reportShip(ui, session.id, result);
                })
              }
            >
              ⇪ Ship instead
            </button>
          )}
          <button type="button" class={`btn sm ${severity === "danger" ? "danger" : "primary"}`} disabled={!endConfirmable(session, status, busy)} onClick={() => void confirm()}>
            {pulling ? "Pulling…" : severity === "danger" ? "End anyway" : running ? "End session" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

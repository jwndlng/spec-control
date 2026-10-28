// Ending a session, from a card or from the panel, goes through this one dialog. It asks as loudly as the work in the
// worktree is unshipped, on the strength of a status read at this moment rather than the list's cached one, and it is
// where the user can bring the repository's main checkout up to date with work that landed. For a change that is
// archived and merged it offers the stale cleanup in place of the plain removal (agent-sessions: "Ending a session
// cleans up a stale change's leftovers").
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { PullResult, StaleCleanupPreview, StaleCleanupResult, WorkStatus } from "../shared/types.ts";
import { api } from "./api.ts";
import { PullBlockedList, usePull } from "./pull.tsx";
import { pullNeedsReport, pullOutcome } from "./pullState.ts";
import { inPlaceLeftover } from "./inPlaceText.ts";
import { endConfirmable, endSeverity, endWarning, pullOffer, removalPreselected, reportShip, worktreeRemovalPossible } from "./sessionState.ts";
import { useSessionUi } from "./sessions.tsx";
import { outsideNote, StaleCleanupOutcome, StaleLeftoverList } from "./staleCleanup.tsx";
import { cleanupNeedsReport, endCleanupOffer, keptUntilStale, outsidePaths, staleRequest } from "./staleState.ts";

interface Status {
  removable: boolean;
  reason?: string;
  work?: WorkStatus;
}

/** What is left of the dialog once the session has ended but the pull or the cleanup needs saying. */
interface Report {
  result?: PullResult;
  cleanup?: StaleCleanupResult;
  worktreeRemoved: boolean;
}

/**
 * One option: a short label, with what it does as the label's hover text and, for assistive technology, as a
 * visually hidden description outside the label so it is not read again as part of the name.
 */
function Option({ id, label, description, checked, onChange }: { id: string; label: ComponentChildren; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <>
      <label class="check" title={description}>
        <input type="checkbox" checked={checked} aria-describedby={id} onChange={(e) => onChange(e.currentTarget.checked)} />
        {/* One flex item: `.check` is a flex row, and a repository name would otherwise become a column of its own. */}
        <span>{label}</span>
      </label>
      <span id={id} class="visually-hidden">
        {description}
      </span>
    </>
  );
}

export function EndSessionDialog() {
  const ui = useSessionUi();
  const pulls = usePull();
  const id = ui.endingId;
  const session = ui.sessions.find((s) => s.id === id);
  const repo = ui.snapshot?.repos.find((r) => r.id === session?.repoId);
  const [status, setStatus] = useState<Status>();
  const [remove, setRemove] = useState(false);
  // The `?ending=` preview, read only for a change the snapshot knows is archived on the default branch.
  const [stale, setStale] = useState<StaleCleanupPreview>();
  const [cleanupChoice, setCleanupChoice] = useState<boolean>();
  const [stalePending, setStalePending] = useState(false);
  // Undefined until the user touches it, so the offer can stay in step with a status or snapshot that arrives later.
  const [pullChoice, setPullChoice] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setStatus(undefined);
    setRemove(false);
    setStale(undefined);
    setCleanupChoice(undefined);
    setStalePending(false);
    setPullChoice(undefined);
    setBusy(false);
    setPulling(false);
    setReport(undefined);
    setError(undefined);
    if (!id) return;
    // An in-place session has no worktree: nothing to check, nothing to remove.
    if (!worktreeRemovalPossible(session)) return;
    let gone = false;
    api
      .worktreeStatus(id)
      .then((result) => {
        if (gone) return;
        setStatus(result);
        setRemove(removalPreselected(result)); // nothing would be lost: removing the worktree is what is left to do
      })
      .catch(() => !gone && setStatus({ removable: false, reason: "could not check the worktree" }));
    if (session && "change" in session && session.change && repo?.changes.some((c) => c.name === session.change && c.stale)) {
      setStalePending(true);
      api
        .staleCleanupPreview(session.repoId, session.change, session.state === "running" ? session.id : undefined)
        .then((preview) => !gone && setStale(preview))
        .catch(() => undefined) // without it, the plain removal is offered as before
        .finally(() => !gone && setStalePending(false));
    }
    return () => {
      gone = true;
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
  const cleanupOffer = hasWorktree ? endCleanupOffer(stale, session) : { offered: false, preselected: false };
  const leftovers = stale?.stale?.leftovers ?? [];
  const cleanupSelected = cleanupOffer.offered && (cleanupChoice ?? cleanupOffer.preselected);
  const outside = cleanupOffer.offered ? outsidePaths(leftovers) : [];
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
      const result = await api.closeSession(session.id, !cleanupOffer.offered && remove && status?.removable === true);
      worktreeRemoved = result.worktree?.removable === true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return;
    }
    // End, clean up, pull: the cleanup removes the main checkout's leftover copy before the fast-forward.
    let cleanup: StaleCleanupResult | undefined;
    if (cleanupSelected && "change" in session && session.change) {
      try {
        // Selecting the offer is the acknowledgement for files outside the change, which the offer named.
        cleanup = await api.staleCleanup(session.repoId, session.change, staleRequest(leftovers, true));
        worktreeRemoved = cleanup.items.some((i) => i.kind === "worktree" && i.outcome !== "kept" && (i.id === session.worktreePath || i.branch === session.branch));
      } catch (err) {
        cleanup = { repoId: session.repoId, name: session.change, items: [], refused: err instanceof Error ? err.message : String(err) };
      }
    }
    const reportCleanup = cleanup && cleanupNeedsReport(cleanup) ? cleanup : undefined;
    if (!pullSelected) {
      await ui.refresh();
      if (!reportCleanup) {
        close();
        return;
      }
      setReport({ cleanup: reportCleanup, worktreeRemoved });
      setBusy(false);
      return;
    }
    setPulling(true);
    const result = await pulls.pull(session.repoId); // never rejects; a failed call comes back as a `failed` result
    await ui.refresh();
    if (!pullNeedsReport(result) && !reportCleanup) {
      close();
      return;
    }
    setReport({ result: pullNeedsReport(result) ? result : undefined, cleanup: reportCleanup, worktreeRemoved });
    setPulling(false);
    setBusy(false);
  };

  if (report && !report.result) {
    return (
      <div class="overlay end-overlay">
        <div class="dialog end-dialog" role="alertdialog" aria-modal="true" aria-labelledby="end-title" aria-describedby="end-body">
          <strong id="end-title">
            Leftovers of <span class="mono">{session.change}</span>
          </strong>
          <div id="end-body" class="dialog-body">
            {report.cleanup && <StaleCleanupOutcome result={report.cleanup} />}
            <div class="hint">Session ended{report.worktreeRemoved ? ", worktree removed" : ""}.</div>
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

  if (report?.result) {
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
            {report.cleanup && <StaleCleanupOutcome result={report.cleanup} />}
            {(result.blocking !== undefined || result.resolved !== undefined) && (
              <PullBlockedList result={result} running={live === "running"} onResolve={(claim) => void pulls.resolve(session.repoId, claim)} />
            )}
            <div class="hint">Session ended{report.worktreeRemoved ? ", worktree removed" : ""}.</div>
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
          {running ? "End session" : "Clean up"} · <span class="mono">{session.change}</span>
        </strong>
        <div id="end-body" class="dialog-body">
          {!hasWorktree ? (
            <div class="hint">
              The agent's changes stay in <span class="mono">{session.worktreePath}</span>
              {inPlaceLeftover(repo?.isGit)}
            </div>
          ) : (
            (cleanupOffer.offered || status?.removable || offer.offered) && <div class="hint">Tidy up after the session — choose what to do:</div>
          )}
          {(stalePending || !status) && hasWorktree && <div class="hint">Checking the worktree…</div>}
          {warning && !cleanupOffer.offered && (
            <div class={`notice ${severity === "danger" ? "danger" : "warn"}`}>
              <strong>{severity === "danger" ? "⚠ Not shipped. " : "Note: "}</strong>
              {warning}
            </div>
          )}
          {cleanupOffer.offered && (
            <>
              <Option
                id="end-cleanup-desc"
                label="Clean up leftovers"
                description="The change is archived and merged on the default branch, so the worktrees and branches listed below are no longer needed. Uncommitted files are copied under the dashboard's home first; ignored files (dependencies, build output, local environment files) are deleted without a copy. Remote branches are never touched."
                checked={cleanupSelected}
                onChange={setCleanupChoice}
              />
              {outside.length > 0 && <div class="hint">{outsideNote(leftovers)}</div>}
              <StaleLeftoverList leftovers={leftovers} kept={stale?.stale?.kept ?? []} compact />
            </>
          )}
          {hasWorktree &&
            !cleanupOffer.offered &&
            (status?.removable ? (
              <Option
                id="end-remove-desc"
                label="Remove worktree"
                description={`Removes ${session.worktreePath}: it is clean, and its work is merged or exists elsewhere.${session.branch ? ` The branch ${session.branch} is kept.` : ""}`}
                checked={remove}
                onChange={setRemove}
              />
            ) : (
              status?.reason && (
                <div class="hint">
                  Worktree kept: {status.reason}. {keptUntilStale}
                </div>
              )
            ))}
          {offer.offered && (
            <Option
              id="end-pull-desc"
              label={
                <>
                  Pull <span class="mono">{repo?.name}</span>
                </>
              }
              description="Fetches the repository's remote and fast-forwards its main checkout, so the board does not keep showing this change as unmerged. Never merges, rebases, stashes or switches branches; off the default branch it only fetches."
              checked={pullSelected}
              onChange={setPullChoice}
            />
          )}
          {error && <div class="notice danger">{error}</div>}
        </div>
        <div class="row">
          <button type="button" class="btn sm ghost" onClick={close}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          {severity === "danger" && !cleanupOffer.offered && (
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
          <button
            type="button"
            class={`btn sm ${severity === "danger" ? "danger" : "primary"}`}
            title={running ? `Stops ${session.agentName}, as if you closed its terminal window` : undefined}
            disabled={!endConfirmable(session, status, busy) || stalePending}
            onClick={() => void confirm()}
          >
            {pulling ? "Pulling…" : severity === "danger" ? "End anyway" : running ? "End session" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

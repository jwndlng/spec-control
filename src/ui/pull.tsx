// The Pull controls. A pull contacts the repository's remote and fast-forwards its main checkout — the one thing in
// the dashboard that does — so it only ever happens from these buttons.
import { type ComponentChildren, createContext } from "preact";
import { useContext, useRef, useState } from "preact/hooks";
import type { PullResolve, PullResult } from "../shared/types.ts";
import { api } from "./api.ts";
import { Modal } from "./modal.tsx";
import type { ActionDescription } from "./projectDetails.ts";
import { blockingNote, type FetchNoteInput, fetchNote, pullOutcome, resolveSummary, shownPullResult } from "./pullState.ts";

type PullState = "running" | PullResult;

interface PullUi {
  states: Record<string, PullState>;
  /**
   * Starts a pull and resolves with its outcome — never rejects; a failed call becomes a `failed` result. A pull
   * already running for this repository is joined rather than started again, so the caller gets that one's outcome.
   */
  pull(repoId: string): Promise<PullResult>;
  /**
   * Confirms Resolve and pull for one repository. Shares the pull's in-flight map, so the Pull button shows it running
   * and a pull started meanwhile joins it; like `pull` it never rejects.
   */
  resolve(repoId: string, claim: PullResolve): Promise<PullResult>;
  pullAll(repoIds: string[]): void;
  allRunning: boolean;
}

const NO_PROVIDER = (repoId: string): PullResult => ({ repoId, fetched: false, update: "failed", reason: "no pull provider" });

const Context = createContext<PullUi>({
  states: {},
  pull: (repoId) => Promise.resolve(NO_PROVIDER(repoId)),
  resolve: (repoId) => Promise.resolve(NO_PROVIDER(repoId)),
  pullAll: () => {},
  allRunning: false,
});

/** For anything outside this module that starts a pull and wants to say what came of it (the end-session dialog). */
export const usePull = () => useContext(Context);

/** Outcomes live here, in memory: a reload forgets them, the repositories keep what the pull did. */
export function PullProvider({ onPulled, children }: { onPulled: () => void; children: ComponentChildren }) {
  const [states, setStates] = useState<Record<string, PullState>>({});
  const [allRunning, setAllRunning] = useState(false);
  const set = (repoId: string, state: PullState) => setStates((prev) => ({ ...prev, [repoId]: state }));
  const failed = (repoId: string, err: unknown): PullResult => ({ repoId, fetched: false, update: "failed", reason: err instanceof Error ? err.message : String(err) });
  // The pull running for a repository, by id. A ref, not state: `pull` must see it in the call, not after a render.
  const inFlight = useRef<Record<string, Promise<PullResult>>>({});

  /** The one path both Pull and Resolve and pull take: one request per repository, its outcome kept for the badge. */
  const start = (repoId: string, request: () => Promise<PullResult>): Promise<PullResult> => {
    const running = inFlight.current[repoId];
    if (running) return running; // one pull per repository, whether it came from here or from "Pull all"
    set(repoId, "running");
    const done = request()
      .then(
        (result) => result,
        (err) => failed(repoId, err),
      )
      .then((result) => {
        delete inFlight.current[repoId];
        set(repoId, result);
        onPulled();
        return result;
      });
    inFlight.current[repoId] = done;
    return done;
  };

  const pull = (repoId: string): Promise<PullResult> => start(repoId, () => api.pullRepo(repoId));
  const resolve = (repoId: string, claim: PullResolve): Promise<PullResult> => start(repoId, () => api.resolvePull(repoId, claim));

  const pullAll = (repoIds: string[]) => {
    if (allRunning) return;
    setAllRunning(true);
    setStates((prev) => ({ ...prev, ...Object.fromEntries(repoIds.map((id) => [id, "running" as const])) }));
    const done = api.pullAll().then(
      ({ results }) => Object.fromEntries(repoIds.map((id) => [id, results.find((r) => r.repoId === id) ?? failed(id, "not pulled: not a tracked, scanned git repository")])),
      (err) => Object.fromEntries(repoIds.map((id) => [id, failed(id, err)])),
    );
    // Each repository gets its share of this run, so a single pull started meanwhile joins it instead of fetching twice.
    for (const id of repoIds) inFlight.current[id] = done.then((byId) => byId[id] as PullResult);
    void done.then((byId) => {
      for (const id of repoIds) delete inFlight.current[id];
      setStates((prev) => ({ ...prev, ...byId }));
      setAllRunning(false);
      onPulled();
    });
  };

  return <Context.Provider value={{ states, pull, resolve, pullAll, allRunning }}>{children}</Context.Provider>;
}

const PULL_HINT = "Fetch this repository's remote and fast-forward its main checkout. Never merges, rebases, stashes or switches branches; off the default branch it only fetches.";

/**
 * What a blocked pull shows: the files in the way, what each one is, and — when every one of them is a leftover of a
 * change created here — the Resolve and pull button. Nothing happens until that button is pressed; the list, the hint
 * and the summary above it are what the user confirms. Once a resolve has run, `result` is its outcome and this turns
 * into that: the files it replaced and where the copies are. Used inside the `Modal` below and inline in the
 * end-session dialog, so both places offer exactly one repository's resolution at a time.
 */
export function PullBlockedList({ result: shown, running, onResolve }: { result: PullResult; running: boolean; onResolve: (claim: PullResolve) => void }) {
  if (shown.resolved) {
    const copies = shown.resolved.filter((r) => r.copy);
    return (
      <div class="pull-blocked">
        <p class="hint">{pullOutcome(shown).detail}</p>
        <ul class="pull-blocked-files">
          {shown.resolved.map((r) => (
            <li key={r.path}>
              <span class="mono">{r.path}</span> <span class="badge success">replaced</span>
            </li>
          ))}
        </ul>
        {copies.length > 0 && (
          <div class="notice">
            {copies.length === 1 ? "A copy of the version that was here is kept at" : "Copies of the versions that were here are kept at"}
            <ul class="pull-blocked-files">
              {copies.map((r) => (
                <li key={r.path}>
                  <span class="mono">{r.copy}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const blocking = shown.blocking ?? [];
  const claim = shown.resolvable;
  return (
    <div class="pull-blocked">
      {shown.reason && <p class="hint">{shown.reason}</p>}
      <ul class="pull-blocked-files">
        {blocking.map((file) => (
          <li key={file.path}>
            <span class="mono">{file.path}</span> <span class={`badge ${file.kind === "leftover" ? (file.differs ? "warning" : "") : "danger"}`}>{blockingNote(file)}</span>
          </li>
        ))}
      </ul>
      {shown.hint && <p class="hint">{shown.hint}</p>}
      {claim && (
        <>
          <p class="hint">{resolveSummary(claim.files)}</p>
          <div class="row pull-blocked-actions">
            <span style={{ flex: 1 }} />
            <button type="button" class="btn sm primary" disabled={running} onClick={() => onResolve(claim)}>
              {running ? "Resolving…" : "Resolve and pull"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** `overview`: a row or tile of the projects overview, bordered and as tall as the Console button beside it. */
/** `description` (the board's): the tooltip, and the accessible description through the element with its id. */
export function PullButton({ repoId, repoName, variant = "board", description }: { repoId: string; repoName?: string; variant?: "board" | "overview"; description?: ActionDescription }) {
  const ui = usePull();
  const [open, setOpen] = useState(false);
  const state = ui.states[repoId];
  const running = state === "running";
  const result = state && state !== "running" ? state : undefined;
  // The last finished outcome, which the open list keeps showing while Resolve and pull runs.
  const last = useRef<PullResult>();
  if (result) last.current = result;
  const outcome = result ? pullOutcome(result) : undefined;
  // A refusal over uncommitted files has more to say than a tooltip can: the badge becomes the way in.
  const blocked = result?.blocking !== undefined || result?.resolved !== undefined;
  return (
    <span class="pull">
      <button
        type="button"
        class={`btn sm pull-btn${variant === "overview" ? " on-overview" : ""}`}
        title={description?.text ?? PULL_HINT}
        aria-describedby={description?.id}
        disabled={running}
        onClick={(e) => {
          e.stopPropagation(); // in an overview row, a click must not open the repository
          void ui.pull(repoId);
        }}
      >
        {running ? "Pulling…" : "⇣ Pull"}
      </button>
      {outcome && result && blocked && (
        <button
          type="button"
          class={`badge ${outcome.tone} pull-badge-button`}
          title={`${outcome.detail} Opens the list of files.`}
          onClick={(e) => {
            e.stopPropagation(); // in an overview row, a click must not open the repository
            setOpen(true);
          }}
        >
          {outcome.label}
        </button>
      )}
      {outcome && !blocked && (
        <span class={`badge ${outcome.tone}`} title={outcome.detail}>
          {outcome.label}
        </span>
      )}
      {open && <BlockedPullModal repoId={repoId} repoName={repoName} result={shownPullResult(state, last.current)} running={running} onClose={() => setOpen(false)} onResolve={(claim) => void ui.resolve(repoId, claim)} />}
    </span>
  );
}

/** The Blocked pull list in its modal; nothing until there is an outcome to show. Hook-free, so it can be asserted on. */
export function BlockedPullModal({
  repoId,
  repoName,
  result,
  running,
  onClose,
  onResolve,
}: {
  repoId: string;
  repoName?: string;
  result: PullResult | undefined;
  running: boolean;
  onClose: () => void;
  onResolve: (claim: PullResolve) => void;
}) {
  if (!result) return null;
  return (
    <Modal label={`Blocked pull for ${repoName ?? repoId}`} title="Blocked pull" subtitle={<span class="mono">{repoName ?? repoId}</span>} onClose={onClose}>
      <PullBlockedList result={result} running={running} onResolve={onResolve} />
    </Modal>
  );
}

/** Beside Pull on the overview, in the board's quick view: when the repository was last fetched, and whether its automatic fetch failed. Nothing without a remote. */
export function FetchNoteBadge({ input, now }: { input: FetchNoteInput; now: number }) {
  const note = fetchNote(input, now);
  if (!note) return null;
  return (
    <span class={`badge fetch-note ${note.tone}`} title={note.detail}>
      {note.label}
    </span>
  );
}

export function PullAllButton({ repoIds }: { repoIds: string[] }) {
  const ui = usePull();
  const results = repoIds.map((id) => ui.states[id]).filter((s): s is PullResult => s !== undefined && s !== "running");
  const counts = results.reduce<Record<string, number>>((acc, r) => {
    const label = pullOutcome(r).label.startsWith("+") ? "updated" : pullOutcome(r).label;
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <span class="pull">
      <button type="button" class="btn sm" title={`${PULL_HINT} Runs for every tracked git repository, a few at a time.`} disabled={ui.allRunning || repoIds.length === 0} onClick={() => ui.pullAll(repoIds)}>
        {ui.allRunning ? "Pulling all…" : "⇣ Pull all"}
      </button>
      {!ui.allRunning && results.length > 0 && (
        <span class="hint" title="Each repository's own outcome is shown in its row">
          {Object.entries(counts)
            .map(([label, n]) => `${n} ${label}`)
            .join(" · ")}
        </span>
      )}
    </span>
  );
}

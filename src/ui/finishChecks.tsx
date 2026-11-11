import { useRef, useState } from "preact/hooks";
import { mergedImplementation } from "../shared/pullRequestLink.ts";
import type { ChangeSnapshot } from "../shared/types.ts";
import { api } from "./api.ts";
import { relTime } from "./format.ts";
import { usePullRequests } from "./pullRequests.tsx";
import { useSessionUi } from "./sessions.tsx";
import { sessionsEnabledFor } from "./sessionState.ts";

export function FinishChecks({ card }: { card: Pick<ChangeSnapshot, "repoId" | "name"> }) {
  const ui = useSessionUi();
  const prs = usePullRequests();
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const [error, setError] = useState<string>();
  const change = ui.snapshot?.repos.find((r) => r.id === card.repoId)?.changes.find((c) => c.name === card.name && !c.archived);
  const pr = change && mergedImplementation(change, prs.data?.repos);
  if (!pr || !sessionsEnabledFor(ui.config, card.repoId)) return null;
  const list = prs.data?.repos.find((r) => r.repoId === card.repoId);
  const age = relTime(list?.fetchedAt);
  const refreshFailed = list?.status === "failed" || !!prs.error;
  return (
    <>
      <button
        type="button"
        class="btn sm"
        disabled={busy}
        title="Ask the agent to finish unresolved checks"
        onClick={async () => {
          if (guard.current) return;
          guard.current = true;
          setBusy(true);
          setError(undefined);
          try {
            const result = await api.finishChecks(card.repoId, card.name);
            await ui.refresh();
            ui.openChangeConsole(card.repoId, card.name, result.id);
            ui.reportUnsent(result.submitted ? undefined : result.id);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            guard.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? "Starting…" : "Finish checks"}
      </button>
      <details class="hint">
        <summary>PR freshness</summary>
        <span>
          Cached PR #{pr.number}. {age === "—" ? "Fetch time unknown." : `Fetched ${age === "just now" ? age : `${age} ago`}.`}
          {list?.fetchedAt && <> <time dateTime={list.fetchedAt}>{list.fetchedAt}</time></>}
        </span>
      </details>
      {refreshFailed && (
        <span class="notice danger" role="status">
          PR refresh failed.{' '}
          <button type="button" class="btn sm" disabled={prs.running !== undefined} onClick={() => void prs.refresh({ repoId: card.repoId, force: true })}>
            {prs.running !== undefined ? "Refreshing…" : "Retry PR refresh"}
          </button>
        </span>
      )}
      {error && (
        <span class="notice danger" role="status">
          {error}
        </span>
      )}
    </>
  );
}

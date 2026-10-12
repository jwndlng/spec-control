// The one store of GitHub clones the UI keeps (github-repositories): the Add from GitHub dialog, the setup wizard and the
// overview's Unmanaged projects read it, so a clone started in one is seen in the others, and closing the dialog or
// reloading the page loses nothing — the server holds the list. Polled every second while a clone is queued or runs,
// never otherwise.
import { useEffect, useState } from "preact/hooks";
import type { GithubClone } from "../shared/types.ts";
import { api } from "./api.ts";
import type { CloneActions } from "./cloneRow.tsx";
import { createGithubClonesStore, type GithubClonesState } from "./githubState.ts";

export const githubClones = createGithubClonesStore(() => api.githubClones());

/** The clones as they are now; asks the server once when first used, which also tells whether git is installed. */
export function useGithubClones(): GithubClonesState {
  const [state, setState] = useState(githubClones.get());
  useEffect(() => {
    const unsubscribe = githubClones.subscribe(() => setState(githubClones.get()));
    void githubClones.refresh();
    return unsubscribe;
  }, []);
  return state;
}

/** Cancel, Retry and Dismiss of clones, by clone id. Retry clones again into the same folder under the same rules. */
export function useCloneActions(): CloneActions {
  const [busy, setBusy] = useState<CloneActions["busy"]>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = async (id: string, action: "cancel" | "retry" | "dismiss", work: () => Promise<void>) => {
    if (busy[id]) return;
    setBusy((b) => ({ ...b, [id]: action }));
    setErrors(({ [id]: _old, ...rest }) => rest);
    try {
      await work();
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : String(err) }));
      // A cancel refused because the clone finished first: show what it became.
      if (action === "cancel") void githubClones.refresh();
    } finally {
      setBusy(({ [id]: _done, ...rest }) => rest);
    }
  };
  return {
    busy,
    errors,
    cancel: (clone: GithubClone) => void run(clone.id, "cancel", async () => githubClones.updated(await api.cancelGithubClone(clone.id))),
    retry: (clone: GithubClone) => void run(clone.id, "retry", async () => githubClones.started(await api.cloneGithub(clone.repo, clone.root, clone.name))),
    dismiss: (clone: GithubClone) =>
      void run(clone.id, "dismiss", async () => {
        await api.dismissGithubClone(clone.id);
        await githubClones.refresh();
      }),
  };
}

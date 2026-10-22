import type { RepoSnapshot, Worktree } from "../shared/types.ts";
import { checkoutMarkers } from "./checkoutMarkers.ts";
import { branchesWithActiveChange, canDelete, noActiveChange } from "./deleteBranchState.ts";
import { splitBranchLabel } from "./format.ts";
import { IconGitBranch } from "./icons.tsx";
import { checkoutSummary } from "./overviewState.ts";

/**
 * Branch name that never outgrows its container: the head is clipped with an ellipsis, the tail always
 * shows. All characters stay in the DOM (copyable); the full name is the tooltip and accessible name.
 */
export function BranchBadge({ branch, hint }: { branch: string; hint: string }) {
  const { head, tail } = splitBranchLabel(branch);
  return (
    <span class="badge branch mono truncate" title={`${branch} — ${hint}`} role="img" aria-label={`branch ${branch}`}>
      <span aria-hidden="true">⎇</span>
      <span class="text" aria-hidden="true">
        <span class="head">{head}</span>
        {tail && <span class="tail">{tail}</span>}
      </span>
    </span>
  );
}

/** One checkout of a repository — the main checkout or a linked worktree — with its state as text markers. Offers no action. */
export function CheckoutChip({ checkout }: { checkout: Worktree }) {
  const where = checkout.isMain ? "main checkout" : "worktree";
  return (
    <span class="checkout">
      {checkout.branch ? (
        <BranchBadge branch={checkout.branch} hint={`${where} at ${checkout.path}`} />
      ) : (
        <span class="badge mono" title={`${checkout.bare ? "bare repository" : "detached HEAD"} — ${where} at ${checkout.path}`}>
          {checkout.bare ? "bare" : `detached${checkout.head ? ` @ ${checkout.head}` : ""}`}
        </span>
      )}
      {checkout.isMain && <span class="where">main checkout</span>}
      {checkoutMarkers(checkout).map((m) => (
        <span key={m.kind} class={`marker ${m.kind}`} title={m.title} role="img" aria-label={m.title}>
          {m.text}
        </span>
      ))}
    </span>
  );
}

const NO_ACTIVE_CHANGE = "No active change of this project is on this branch — it may be left over";

export function CheckoutChips({ checkouts }: { checkouts: Worktree[] }) {
  return (
    <>
      {checkouts.map((w) => (
        <CheckoutChip key={w.path} checkout={w} />
      ))}
    </>
  );
}

/** Checkouts with work the user should look at: uncommitted, unpushed or stale. */
export function checkoutsNeedingAttention(checkouts: Worktree[]): number {
  return checkouts.filter((w) => checkoutMarkers(w).some((m) => m.kind === "uncommitted" || m.kind === "unpushed" || m.kind === "stale")).length;
}

/**
 * Every checkout of a repository with its path; in the project details overlay's Checkouts section. A linked worktree
 * whose branch belongs to no active change carries a `no active change` marker, and with `onDelete` every worktree that
 * can be deleted offers **Delete…** (repository-cleanup: "One branch and its worktree can be deleted whatever they hold").
 */
export function CheckoutList({ repo, onDelete }: { repo: RepoSnapshot; onDelete?: (worktree: Worktree, opener: HTMLElement) => void }) {
  const active = branchesWithActiveChange(repo);
  return (
    <ul class="checkout-list">
      {repo.worktrees.map((w) => {
        const orphan = noActiveChange(repo, w, active);
        return (
          <li key={w.path} class={orphan ? "no-change" : undefined}>
            <CheckoutChip checkout={w} />
            {orphan && (
              <span class="marker no-change" title={NO_ACTIVE_CHANGE} role="img" aria-label={NO_ACTIVE_CHANGE}>
                no active change
              </span>
            )}
            <code class="checkout-path">{w.path}</code>
            {onDelete && canDelete(repo, w) && (
              <button
                type="button"
                class="btn sm ghost checkout-delete"
                aria-haspopup="dialog"
                title={w.branch ? `Delete ${w.branch} and its worktree — shows what would be lost first` : "Remove this worktree — shows what would be lost first"}
                onClick={(e) => onDelete(w, e.currentTarget)}
              >
                Delete…
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The repository header's checkouts, calm: the main checkout's chip, and one control — `5 branches` — that opens the
 * project details at its checkouts (`onOpen`). When checkouts hold uncommitted, unpushed or stale work, it says how many.
 */
export function CheckoutSummaryButton({ checkouts, onOpen }: { checkouts: Worktree[]; onOpen: (opener: HTMLElement) => void }) {
  const main = checkouts.find((w) => w.isMain);
  const summary = checkoutSummary(checkouts);
  const attention = checkoutsNeedingAttention(checkouts);
  return (
    <>
      {main && <CheckoutChip checkout={main} />}
      <button
        type="button"
        class={`control branches-button ${attention ? "attention" : ""}`}
        aria-haspopup="dialog"
        onClick={(e) => onOpen(e.currentTarget)}
        title="Every checkout of this repository, in the project details"
      >
        <IconGitBranch size={13} />
        {summary.branches} {summary.branches === 1 ? "branch" : "branches"}
        {attention > 0 && <span class="control-value">{attention} with work</span>}
      </button>
    </>
  );
}

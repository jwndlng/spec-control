// The one confirmation before the proposal's console ends its session to start the next step, asked only while the
// proposal is not pushed (one-console-per-change D2; the rule is `endProposalConfirmation`). Nothing is removed either
// way: the proposal's worktree and branch are kept, so this is not the end-session dialog.
import { useEffect, useRef } from "preact/hooks";

export function EndProposalDialog({ change, branch, actionLabel, warning, onAnswer }: { change: string; branch?: string; actionLabel: string; warning: string; onAnswer: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Cancel takes focus: Enter on an unread warning must not be what ends the agent.
  useEffect(() => cancelRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onAnswer(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onAnswer]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the backdrop is a pointer shortcut; Escape and Cancel are its keyboard equivalents
    <div
      class="overlay end-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onAnswer(false);
      }}
    >
      <div class="dialog end-dialog" role="alertdialog" aria-modal="true" aria-labelledby="end-proposal-title" aria-describedby="end-proposal-body">
        <strong id="end-proposal-title">
          End the proposal session of <span class="mono">{change}</span>?
        </strong>
        <div id="end-proposal-body" class="dialog-body">
          <div class="notice warn">{warning}</div>
          <div class="hint">
            {actionLabel} then starts in a new session{branch ? <>; <span class="mono">{branch}</span> stays as it is</> : null}.
          </div>
        </div>
        <div class="row">
          <button type="button" class="btn sm ghost" ref={cancelRef} onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" class="btn sm primary" onClick={() => onAnswer(true)}>
            End proposal session and {actionLabel.toLowerCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

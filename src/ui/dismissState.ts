// DOM-free logic of dismissing a change (openspec/specs/change-dismissal): whether the detail header offers it, and
// what the confirmation and the notice afterwards say. The server decides; this only keeps the UI honest about it.
import type { ChangeSnapshot, DeleteFilesPreview, DeleteFilesResult, DismissPreview, DismissResult } from "../shared/types.ts";

export type DismissOffer = { shown: false } | { shown: true; disabledReason?: string };

/**
 * Offered for every active change; dismissal applies across all its checkout copies.
 */
export function dismissOffer(change: ChangeSnapshot): DismissOffer {
  if (change.archived) return { shown: false };
  return { shown: true };
}

export function lostFiles(preview: DeleteFilesPreview): number {
  return preview.files.filter((f) => f.state === "lost").length;
}

/** The warning above the file list, when anything cannot be brought back. */
export function lossWarning(preview: DeleteFilesPreview): string | undefined {
  const lost = lostFiles(preview);
  if (lost === 0) return undefined;
  if (!preview.isGit) return "This folder has no git: every file below is deleted for good.";
  if (lost === preview.files.length) return `None of these files is committed: all ${lost} are deleted for good.`;
  return `${lost} of these files ${lost === 1 ? "has" : "have"} changes that are not committed and cannot be restored.`;
}

/** What the change leaves behind in git, for the line under the list. */
export function stagingNote(preview: DeleteFilesPreview): string {
  if (!preview.isGit) return "Nothing is committed or staged: this folder has no git.";
  return "The removal is staged in the main checkout, ready for you to commit. Nothing is committed.";
}

/** The notice once the change is gone. */
export function dismissedNotice(result: DismissResult, _preview: DismissPreview): string {
  return `Dismissed ${result.name}. Its files are preserved, and any running agent continues. Use Show dismissed to restore it.`;
}

export function deletedFilesNotice(result: DeleteFilesResult): string {
  return `Deleted the main checkout's files for ${result.name}.${result.staged ? " The removal is staged." : " The removal was not staged."} This did not dismiss other checkout copies.`;
}

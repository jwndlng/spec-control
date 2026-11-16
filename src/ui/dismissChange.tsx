import { useEffect, useRef, useState } from "preact/hooks";
import type { DeleteFilesPreview, DeleteFilesResult, DismissPreview, DismissResult } from "../shared/types.ts";
import { api, ApiError } from "./api.ts";
import { lossWarning, stagingNote } from "./dismissState.ts";
import { Modal } from "./modal.tsx";

/** Reversible board dismissal: it records an identity in the dashboard home and leaves every checkout untouched. */
export function DismissDialog({ repoId, repoName, change, onClose, onDismissed }: { repoId: string; repoName: string; change: string; onClose: () => void; onDismissed: (result: DismissResult, preview: DismissPreview) => void }) {
  const [preview, setPreview] = useState<DismissPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let stale = false;
    api.dismissPreview(repoId, change).then((p) => !stale && setPreview(p), (err) => !stale && setError(err instanceof Error ? err.message : String(err)));
    return () => { stale = true; };
  }, [repoId, change]);
  useEffect(() => cancel.current?.focus(), []);

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    try { onDismissed(await api.dismissChange(repoId, change, preview.identity), preview); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal label={`Dismiss change ${change}`} title="Dismiss change" subtitle={<><span class="mono">{change}</span> in {repoName}</>} onClose={onClose} canClose={() => !busy}>
      <div class="dismiss-body">
        <p class="hint">This hides the change from the board and saves a reversible dismissal record in the dashboard. Its files stay in every checkout; any running agent continues.</p>
        {preview && <>
          <p class="hint">{preview.copies.length ? `The change is present in ${preview.copies.length} checkout${preview.copies.length === 1 ? "" : "s"}.` : "The change is present in the scanned repository."}</p>
          {preview.copies.length > 0 && <ul class="dismiss-files">{preview.copies.map((copy) => <li key={copy.path}><span class="mono">{copy.path}</span>{copy.branch && <> <span class="badge">{copy.branch}</span></>}</li>)}</ul>}
        </>}
        {!preview && !error && <p class="hint">Checking the change…</p>}
        {error && <div class="notice danger" role="alert">{error}</div>}
      </div>
      <div class="row dismiss-actions">
        <button ref={cancel} type="button" class="btn sm" disabled={busy} onClick={onClose}>Cancel</button>
        <span style={{ flex: 1 }} />
        <button type="button" class="btn sm" disabled={busy || !preview} onClick={() => void confirm()}>{busy ? "Dismissing…" : "Dismiss change"}</button>
      </div>
    </Modal>
  );
}

/** Destructive, main-checkout-only operation kept separate from reversible Dismiss. */
export function DeleteFilesDialog({ repoId, repoName, change, onClose, onDeleted }: { repoId: string; repoName: string; change: string; onClose: () => void; onDeleted: (result: DeleteFilesResult, preview: DeleteFilesPreview) => void }) {
  const [preview, setPreview] = useState<DeleteFilesPreview>();
  const [error, setError] = useState<string>();
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let stale = false;
    setPreview(undefined);
    api.deleteFilesPreview(repoId, change).then((p) => !stale && setPreview(p), (err) => !stale && setError(err instanceof Error ? err.message : String(err)));
    return () => { stale = true; };
  }, [repoId, change, generation]);
  useEffect(() => cancel.current?.focus(), []);
  const lookAgain = () => { setError(undefined); setRefused(false); setGeneration((n) => n + 1); };
  const confirm = async () => {
    if (!preview) return;
    setBusy(true); setError(undefined);
    try { onDeleted(await api.deleteChangeFiles(repoId, change, preview.fingerprint), preview); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setRefused(err instanceof ApiError && err.status === 409); }
    finally { setBusy(false); }
  };
  const warning = preview && lossWarning(preview);
  return (
    <Modal label={`Delete change files ${change}`} title="Delete change files" subtitle={<><span class="mono">{change}</span> in {repoName}</>} onClose={onClose} canClose={() => !busy}>
      <div class="dismiss-body">
        <p class="hint">Deletes only <span class="mono">openspec/changes/{change}/</span> from the main checkout. Linked checkout copies remain, and this does not dismiss the logical change.</p>
        {!preview && !error && <p class="hint">Looking at the main checkout's files…</p>}
        {preview && <>
          {warning && <div class="notice danger" role="alert">{warning}</div>}
          {preview.files.length === 0 ? <p class="hint">The directory is empty.</p> : <ul class="dismiss-files">{preview.files.map((f) => <li key={f.path}><span class="mono">{f.path}</span> {f.state === "lost" ? <span class="badge danger">lost for good</span> : <span class="badge">restorable from git</span>}</li>)}</ul>}
          {preview.copies.length > 0 && <div class="notice warn">Linked copies are preserved:{" "}{preview.copies.map((c) => c.branch ?? c.path).join(", ")}</div>}
          <p class="hint">{stagingNote(preview)}</p>
        </>}
        {error && <div class="notice danger" role="alert">{error}{refused && <> <button type="button" class="btn sm" onClick={lookAgain}>Show current state</button></>}</div>}
      </div>
      <div class="row dismiss-actions"><button ref={cancel} type="button" class="btn sm" disabled={busy} onClick={onClose}>Cancel</button><span style={{ flex: 1 }} /><button type="button" class="btn sm danger" disabled={busy || !preview || refused} onClick={() => void confirm()}>{busy ? "Deleting…" : "Delete change files"}</button></div>
    </Modal>
  );
}

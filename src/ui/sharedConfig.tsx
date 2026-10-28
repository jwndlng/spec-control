import { useEffect, useMemo, useState } from "preact/hooks";
import type { Config, SharedConfig, SharedConfigApplyResult, SharedConfigAssignment, SharedConfigPreview, SharedProfile, Snapshot } from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import { foldDiff, lineDiff } from "./lineDiff.ts";
import { carriedIds, type GridRow, isPending, pendingAssignments, profileIdFrom, utf8Bytes, withDigests } from "./sharedConfigState.ts";

const MAX_CONTEXT_BYTES = 50 * 1024;
const FALLBACK_ARTIFACTS = ["proposal", "design", "specs", "tasks"];

function Diff({ before, after }: { before: string; after: string }) {
  const hunks = useMemo(() => foldDiff(lineDiff(before, after)), [before, after]);
  return (
    <pre class="diff">
      {hunks.map((hunk, i) =>
        hunk.kind === "skipped" ? (
          <div key={`s${i}`} class="skip">
            ⋯ {hunk.count} unchanged {hunk.count === 1 ? "line" : "lines"}
          </div>
        ) : (
          hunk.lines.map((line, j) => (
            <div key={`${i}.${j}`} class={line.kind}>
              {line.kind === "add" ? "+ " : line.kind === "del" ? "− " : "  "}
              {line.text}
            </div>
          ))
        ),
      )}
    </pre>
  );
}

/** The assignments a preview was produced for, kept with it: Apply sends these, never what the grid shows by then. */
interface Previewed {
  assignments: SharedConfigAssignment[];
  previews: SharedConfigPreview[];
}

function PreviewDialog({ previewed: { assignments, previews }, names, onApply, onClose }: { previewed: Previewed; names: Map<string, string>; onApply: (assignments: SharedConfigAssignment[]) => Promise<SharedConfigApplyResult[]>; onClose: () => void }) {
  const [results, setResults] = useState<SharedConfigApplyResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writable = previews.filter((p) => !p.refusal && p.after !== p.before);
  const resultOf = (repoId: string) => results?.find((r) => r.repoId === repoId);

  const apply = async () => {
    setBusy(true);
    try {
      setResults(await onApply(withDigests(assignments, previews)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Preview shared config changes">
      <div class="dialog">
        <div class="row">
          <h1 class="grow">Preview · {writable.length} of {previews.length} would change</h1>
          <button type="button" class="btn sm ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <p class="hint">
          Only <code>openspec/config.yaml</code> is written, and only its managed sections. Nothing is committed: each repository ends up with an ordinary uncommitted change to review.
        </p>
        <div class="dialog-body">
          {previews.map((p) => {
            const result = resultOf(p.repoId);
            return (
              <details key={p.repoId} open={!p.refusal && p.after !== p.before}>
                <summary>
                  <span class="mono">{names.get(p.repoId) ?? p.repoId}</span>
                  {p.refusal ? <span class="badge danger">refused</span> : p.after === p.before ? <span class="badge">no change</span> : <span class="badge info">will change</span>}
                  {result && <span class={`badge ${result.result === "written" ? "success" : result.result === "refused" ? "danger" : ""}`}>{result.result}</span>}
                </summary>
                {(p.refusal || result?.reason) && <div class="notice danger">{result?.reason ?? p.refusal}</div>}
                {!p.refusal && p.after !== p.before && <Diff before={p.before} after={p.after} />}
              </details>
            );
          })}
        </div>
        {error && <div class="notice danger">{error}</div>}
        <div class="row">
          <button type="button" class="btn primary" onClick={apply} disabled={busy || results !== null || writable.length === 0}>
            {busy ? "Applying…" : results ? "Applied" : `Apply to ${writable.length} ${writable.length === 1 ? "repository" : "repositories"}`}
          </button>
          {results && <span class="hint">Review and commit the changes in each repository.</span>}
        </div>
      </div>
    </div>
  );
}

function ProfileEditor({ profile, artifactIds, onChange }: { profile: SharedProfile; artifactIds: string[]; onChange: (next: SharedProfile) => void }) {
  const [newArtifact, setNewArtifact] = useState("");
  const bytes = utf8Bytes(profile.context);
  const ids = [...new Set([...Object.keys(profile.rules), ...artifactIds])];
  const setRules = (artifact: string, list: string[]) => {
    const rules = { ...profile.rules, [artifact]: list };
    if (list.length === 0) delete rules[artifact];
    onChange({ ...profile, rules });
  };

  return (
    <div class="profile-editor">
      <label class="field">
        <span>Name</span>
        <input class="input" value={profile.name} onInput={(e) => onChange({ ...profile, name: e.currentTarget.value })} />
        <span class="hint mono" title="Written into the markers in each repository; fixed once created">
          id: {profile.id}
        </span>
      </label>
      <label class="field stack">
        <span>
          Context <span class="hint">— shown to the agent for every artifact</span>
        </span>
        <textarea class="input mono" rows={6} value={profile.context} onInput={(e) => onChange({ ...profile, context: e.currentTarget.value })} />
        <span class={`hint ${bytes > MAX_CONTEXT_BYTES ? "over" : ""}`}>
          {(bytes / 1024).toFixed(1)}KB of 50KB — shared and a project's own context count together; OpenSpec ignores context above the limit
        </span>
      </label>
      <div class="field stack">
        <span>
          Rules <span class="hint">— per artifact, one line each</span>
        </span>
        {ids.map((artifact) => {
          const list = profile.rules[artifact] ?? [];
          return (
            <div key={artifact} class="rules">
              <span class="badge mono">{artifact}</span>
              <div class="list grow">
                {list.map((rule, i) => (
                  <div key={i} class="row">
                    <input class="input grow" value={rule} onInput={(e) => setRules(artifact, list.map((r, k) => (k === i ? e.currentTarget.value : r)))} />
                    <button type="button" class="btn sm ghost" title="Remove rule" onClick={() => setRules(artifact, list.filter((_, k) => k !== i))}>
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" class="btn sm ghost add" onClick={() => setRules(artifact, [...list, ""])}>
                  + rule
                </button>
              </div>
            </div>
          );
        })}
        <div class="row">
          <input class="input mono" placeholder="other artifact id" value={newArtifact} onInput={(e) => setNewArtifact(e.currentTarget.value)} />
          <button
            type="button"
            class="btn sm"
            disabled={!/^[A-Za-z0-9._-]+$/.test(newArtifact) || ids.includes(newArtifact)}
            onClick={() => {
              setRules(newArtifact, [""]);
              setNewArtifact("");
            }}
          >
            Add artifact
          </button>
        </div>
      </div>
    </div>
  );
}

/** Settings panel: profiles of shared OpenSpec config, and which repositories carry which. */
export function SharedConfigPanel({ config, snapshot, onApplied }: { config: Config; snapshot: Snapshot | null; onApplied: () => void }) {
  const [saved, setSaved] = useState<SharedConfig | null>(null);
  const [draft, setDraft] = useState<SharedProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [previewed, setPreviewed] = useState<Previewed | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.sharedConfig().then((c) => {
      setSaved(c);
      setDraft(c.profiles);
      setActiveId(c.profiles[0]?.id ?? null);
    }, (err) => setMessage({ kind: "danger", text: String(err) }));
  }, []);

  const profiles = saved?.profiles ?? [];
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved.profiles);
  const active = draft.find((p) => p.id === activeId) ?? null;
  const artifactIds = useMemo(() => {
    const seen = (snapshot?.repos ?? []).flatMap((r) => r.changes.flatMap((c) => c.artifacts.map((a) => a.id)));
    return [...new Set(seen.length ? seen : FALLBACK_ARTIFACTS)];
  }, [snapshot]);

  const rows: GridRow[] = config.repos
    .filter((r) => r.enabled)
    .map((r) => {
      const current = snapshot?.repos.find((s) => s.id === r.id)?.sharedConfig;
      return { repoId: r.id, name: r.name, current, selected: selection[r.id] ?? carriedIds(current, profiles) };
    });
  const pending = pendingAssignments(rows, profiles);
  const names = new Map(config.repos.map((r) => [r.id, r.name]));

  const replace = (next: SharedProfile) => setDraft(draft.map((p) => (p.id === next.id ? next : p)));
  const move = (id: string, by: number) => {
    const i = draft.findIndex((p) => p.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };
  const add = () => {
    const id = profileIdFrom(newName, draft.map((p) => p.id));
    setDraft([...draft, { id, name: newName.trim(), context: "", rules: {} }]);
    setActiveId(id);
    setNewName("");
  };
  // Functional updates: several ticks can land before the next render, and each must build on the one before.
  const toggle = (repoId: string, profileId: string, on: boolean, carried: string[]) =>
    setSelection((prev) => {
      const from = prev[repoId] ?? carried;
      return { ...prev, [repoId]: on ? [...new Set([...from, profileId])] : from.filter((id) => id !== profileId) };
    });
  const toggleColumn = (profileId: string) => {
    const usable = rows.filter((r) => r.current && !r.current.unreadable);
    const all = usable.every((r) => r.selected.includes(profileId));
    setSelection((prev) => ({ ...prev, ...Object.fromEntries(usable.map((r) => [r.repoId, all ? r.selected.filter((id) => id !== profileId) : [...new Set([...r.selected, profileId])]])) }));
  };

  const save = async () => {
    setBusy(true);
    try {
      // drop rules left empty while editing; the server refuses blank rules on purpose
      const cleaned = draft.map((p) => ({ ...p, rules: Object.fromEntries(Object.entries(p.rules).map(([k, v]) => [k, v.filter((r) => r.trim() !== "")] as const).filter(([, v]) => v.length > 0)) }));
      const next = await api.saveSharedConfig({ profiles: cleaned });
      setSaved(next);
      setDraft(next.profiles);
      setMessage({ kind: "ok", text: "Profiles saved. Nothing was written to any repository — use the grid below to apply." });
      onApplied();
    } catch (err) {
      setMessage({ kind: "danger", text: err instanceof ApiError && err.issues.length ? err.issues.join("; ") : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    setBusy(true);
    try {
      const assignments = pending;
      setPreviewed({ assignments, previews: (await api.previewSharedConfig(assignments)).previews });
    } catch (err) {
      setMessage({ kind: "danger", text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const apply = async (assignments: SharedConfigAssignment[]) => {
    const { results } = await api.applySharedConfig(assignments);
    setSelection({});
    onApplied();
    return results;
  };

  return (
    <section class="panel shared-config">
      <h2>Shared OpenSpec config</h2>
      <p class="hint">
        Profiles of guidance for agents — a <code>context</code> text and per-artifact <code>rules</code> — kept here once and merged into repositories' <code>openspec/config.yaml</code>. A repository can carry several profiles; a project's own context and rules are never touched.
      </p>

      <div class="profiles">
        <div class="profile-list">
          {draft.map((p, i) => (
            <div key={p.id} class={`item ${p.id === activeId ? "on" : ""}`}>
              <button type="button" class="pick" onClick={() => setActiveId(p.id)}>
                {p.name || p.id}
              </button>
              <button type="button" class="btn sm ghost" title="Move up (profiles are written in this order)" disabled={i === 0} onClick={() => move(p.id, -1)}>
                ↑
              </button>
              <button type="button" class="btn sm ghost" title="Move down" disabled={i === draft.length - 1} onClick={() => move(p.id, 1)}>
                ↓
              </button>
              <button
                type="button"
                class="btn sm ghost"
                title="Delete profile (repositories carrying it will report it as orphaned until you apply)"
                onClick={() => {
                  setDraft(draft.filter((d) => d.id !== p.id));
                  if (activeId === p.id) setActiveId(draft.find((d) => d.id !== p.id)?.id ?? null);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div class="row">
            <input class="input grow" placeholder="New profile name" value={newName} onInput={(e) => setNewName(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && newName.trim() && add()} />
            <button type="button" class="btn sm" disabled={!newName.trim()} onClick={add}>
              Add
            </button>
          </div>
        </div>
        {active ? <ProfileEditor profile={active} artifactIds={artifactIds} onChange={replace} /> : <p class="hint">Add a profile to get started, e.g. "Base" for conventions every project shares.</p>}
      </div>

      <div class="row">
        <button type="button" class="btn primary" onClick={save} disabled={!dirty || busy || draft.some((p) => !p.name.trim())}>
          Save profiles
        </button>
        {dirty && <span class="badge warning">unsaved profile changes</span>}
        {message && <span class={`notice ${message.kind}`}>{message.text}</span>}
      </div>

      {profiles.length > 0 && (
        <>
          <h3>Repositories</h3>
          <p class="hint">Tick the profiles each repository should carry. Ticks start from what each repository's file carries now; nothing is written until you confirm the preview.</p>
          <div class="grid-wrap">
            <table class="assign">
              <thead>
                <tr>
                  <th scope="col" class="assign-col">Repository</th>
                  {profiles.map((p) => (
                    <th key={p.id} scope="col" class="assign-col">
                      <button type="button" class="sort" title={`Tick or untick "${p.name}" for every repository`} onClick={() => toggleColumn(p.id)}>
                        {p.name}
                      </button>
                    </th>
                  ))}
                  <th scope="col" class="assign-col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const usable = row.current !== undefined && !row.current.unreadable;
                  const orphans = row.current?.applied.filter((p) => p.state === "orphaned") ?? [];
                  return (
                    <tr key={row.repoId}>
                      <th scope="row" class="assign-repo">{row.name}</th>
                      {profiles.map((p) => {
                        const state = row.current?.applied.find((a) => a.id === p.id)?.state;
                        return (
                          <td key={p.id}>
                            <label class="check">
                              <input type="checkbox" disabled={!usable} checked={row.selected.includes(p.id)} onChange={(e) => toggle(row.repoId, p.id, e.currentTarget.checked, row.selected)} aria-label={`${p.name} for ${row.name}`} />
                              {state === "in-sync" && <span class="hint">in sync</span>}
                              {state === "outdated" && <span class="badge warning">outdated</span>}
                            </label>
                          </td>
                        );
                      })}
                      <td>
                        {row.current === undefined && <span class="hint">not scanned yet</span>}
                        {row.current?.unreadable && (
                          <span class="badge danger" title="openspec/config.yaml is missing, not valid YAML, or has malformed markers">
                            config unreadable
                          </span>
                        )}
                        {orphans.map((o) => (
                          <span key={o.id} class="badge warning" title="Sections of a profile that no longer exists; applying removes them">
                            orphaned: {o.id}
                          </span>
                        ))}
                        {isPending(row, profiles) && <span class="badge info">pending</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div class="row">
            <button type="button" class="btn primary" onClick={preview} disabled={busy || dirty || pending.length === 0}>
              Preview &amp; apply… ({pending.length})
            </button>
            {dirty && <span class="hint">Save the profiles first.</span>}
            {Object.keys(selection).length > 0 && (
              <button type="button" class="btn sm ghost" onClick={() => setSelection({})}>
                reset ticks
              </button>
            )}
          </div>
        </>
      )}

      {previewed && <PreviewDialog previewed={previewed} names={names} onApply={apply} onClose={() => setPreviewed(null)} />}
    </section>
  );
}

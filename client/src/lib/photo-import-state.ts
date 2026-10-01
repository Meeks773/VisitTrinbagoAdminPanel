import type { PhotoImportPlan } from "@shared/photo-import-types";
import type { LocalIssueRecord, SourceTotals } from "./photo-import-api";

export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const qKey = (id: string) => `photo-import-pending-issues:${id}`;
const tKey = (id: string) => `photo-import-source-totals:${id}`;
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

function sanitize(raw: unknown): LocalIssueRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((i) => i && typeof i.filename === "string" && typeof i.code === "string").map((i) => ({
    filename: clip(i.filename, 300), bytes: Number(i.bytes) || 0, code: clip(i.code, 40), message: clip(i.message, 300),
  }));
}

export function loadQueue(s: KeyValueStorage, id: string): LocalIssueRecord[] {
  try { return sanitize(JSON.parse(s.getItem(qKey(id)) ?? "[]")); } catch { return []; }
}

/** Persist one issue synchronously BEFORE any network call. Metadata only. */
export function enqueueIssue(s: KeyValueStorage, id: string, issue: LocalIssueRecord): LocalIssueRecord[] {
  const [clean] = sanitize([issue]);
  const q = loadQueue(s, id);
  if (!q.some((i) => i.filename === clean.filename && i.code === clean.code)) q.push(clean);
  s.setItem(qKey(id), JSON.stringify(q));
  return q;
}

export function saveTotals(s: KeyValueStorage, id: string, t: SourceTotals) {
  s.setItem(tKey(id), JSON.stringify({ selectedFiles: Number(t.selectedFiles) || 0, selectedBytes: Number(t.selectedBytes) || 0 }));
}
export function loadTotals(s: KeyValueStorage, id: string): SourceTotals | undefined {
  try { const t = JSON.parse(s.getItem(tKey(id)) ?? "null"); return t ? { selectedFiles: Number(t.selectedFiles) || 0, selectedBytes: Number(t.selectedBytes) || 0 } : undefined; } catch { return undefined; }
}

/** Send queued issues in chunks <=100; remove only server-acked chunks. Throws on first failure, leaving the rest queued. */
export async function flushQueue(s: KeyValueStorage, id: string, send: (issues: LocalIssueRecord[], totals?: SourceTotals) => Promise<unknown>): Promise<void> {
  const totals = loadTotals(s, id);
  let q = loadQueue(s, id);
  if (q.length === 0 && totals) { await send([], totals); return; }
  while (q.length > 0) {
    const chunk = q.slice(0, 100);
    await send(chunk, totals);
    q = loadQueue(s, id).filter((i) => !chunk.some((c) => c.filename === i.filename && c.code === i.code));
    if (q.length === 0) s.removeItem(qKey(id)); else s.setItem(qKey(id), JSON.stringify(q));
  }
}

export interface Choices { assign: Record<string, number>; covers: Record<number, string>; excluded: string[] }

export function choicesFromPlan(plan: PhotoImportPlan): Choices {
  const assign: Record<string, number> = {}; const covers: Record<number, string> = {};
  for (const e of plan.entries) { covers[e.listingId] = e.coverFileId; for (const f of e.fileIds) assign[f] = e.listingId; }
  return { assign, covers, excluded: [...plan.excludedFileIds] };
}

export function planMatchesChoices(plan: PhotoImportPlan | null, c: Choices): boolean {
  if (!plan) return false;
  const p = choicesFromPlan(plan);
  const eqRec = (a: Record<string, unknown>, b: Record<string, unknown>) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => String(a[k]) === String(b[k])); };
  return eqRec(p.assign, c.assign) && eqRec(p.covers, c.covers) && [...p.excluded].sort().join("|") === [...c.excluded].sort().join("|");
}

/**
 * Per-batch report gate. The durable queue in storage is the synchronous source of truth
 * (a recovered or newly enqueued issue blocks immediately, before any network call);
 * inFlight/failed cover the window while a flush runs or after it fails.
 */
export class ReportGate {
  private inFlight = new Map<string, number>();
  private failed = new Set<string>();
  constructor(private storage: KeyValueStorage) {}
  isBlocked(id: string): boolean {
    return loadQueue(this.storage, id).length > 0 || (this.inFlight.get(id) ?? 0) > 0 || this.failed.has(id);
  }
  /** Returns true when the server acked everything and the caller must refresh the batch (report invalidates the plan). */
  async flush(id: string, send: (issues: LocalIssueRecord[], totals?: SourceTotals) => Promise<unknown>): Promise<{ ok: boolean; refresh: boolean; error?: Error }> {
    this.inFlight.set(id, (this.inFlight.get(id) ?? 0) + 1);
    try {
      await flushQueue(this.storage, id, send);
      this.failed.delete(id);
      return { ok: true, refresh: true };
    } catch (e) {
      this.failed.add(id);
      return { ok: false, refresh: false, error: e as Error };
    } finally {
      const n = (this.inFlight.get(id) ?? 1) - 1;
      if (n <= 0) this.inFlight.delete(id); else this.inFlight.set(id, n);
    }
  }
}

/** Single policy used by both button disabled state and action handlers. */
export function canReviewOrApply(gate: ReportGate, id: string | null | undefined): boolean {
  return !!id && !gate.isBlocked(id);
}

/** A late refresh can restore local copies of old errors; server resolution wins
 * only for an exact record. Never remove queued reports or bypass their gate. */
export function unresolvedIssueCopies<T extends { filename: string; bytes: number; code: string; error: string }>(
  local: T[],
  saved: Array<LocalIssueRecord & { resolved?: boolean }>,
): T[] {
  return local.filter((issue) => !saved.some((record) => record.resolved === true
    && record.filename === issue.filename && record.bytes === issue.bytes
    && record.code === issue.code && record.message === issue.error));
}

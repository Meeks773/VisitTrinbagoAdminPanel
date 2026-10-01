import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PhotoImportBatch, PhotoImportBatchResponse, PhotoImportFile } from "@shared/photo-import-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import { photoImportApi, PhotoImportApiError, type PhotoImportSummary, type LocalIssueRecord, type SourceTotals } from "@/lib/photo-import-api";
import { inspectOriginal, processPhoto, putObject, withRetry, naturalCompare, orderFileIds, issueCode, mergeIssues } from "@/lib/photo-processing";
import { ReportGate, canReviewOrApply, enqueueIssue, loadQueue, saveTotals, planMatchesChoices, choicesFromPlan, unresolvedIssueCopies, type Choices } from "@/lib/photo-import-state";
import { Download, FolderOpen, Loader2, RefreshCw, ShieldAlert } from "lucide-react";

const LIST_KEY = ["/api/photo-imports"];
const STORE = "photo-import-current-batch"; // batch id only; no secrets
const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : `${(n / 1024).toFixed(1)} KiB`);

interface LocalIssue { filename: string; error: string; bytes: number; code: string }
interface BatchExt { localIssues?: Array<LocalIssueRecord & { resolved?: boolean }>; localIssuesAcknowledged?: boolean; sourceTotals?: SourceTotals }
type Confirm = "apply" | "restore" | null;

export default function PhotoImportPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [batchId, setBatchId] = useState<string | null>(() => sessionStorage.getItem(STORE));
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<PhotoImportBatchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [rights, setRights] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [issues, setIssues] = useState<LocalIssue[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [conflict, setConflict] = useState(false);
  const cancelRef = useRef(false);
  const gateRef = useRef(new ReportGate(sessionStorage));
  const currentIdRef = useRef<string | null>(batchId);
  const [reportPending, setReportPending] = useState(false);
  const syncGate = (id: string) => { if (currentIdRef.current === id) setReportPending(!canReviewOrApply(gateRef.current, id)); };
  const [ack, setAck] = useState(false);
  const [localTotals, setLocalTotals] = useState({ selected: 0, selectedBytes: 0 });
  const [persistError, setPersistError] = useState("");
  const locked = running || busy;

  const list = useQuery<{ batches: PhotoImportSummary[] }>({ queryKey: LIST_KEY, staleTime: 0 });

  const openBatch = (id: string | null) => {
    currentIdRef.current = id;
    setBatchId(id); setPersistError(""); setReportPending(false); setError(""); setBusy(false); setRunning(false);
    if (id) sessionStorage.setItem(STORE, id); else sessionStorage.removeItem(STORE);
    setDetail(null); setLocalFiles([]); setIssues([]); setAck(false); setLocalTotals({ selected: 0, selectedBytes: 0 }); setConflict(false); setRights(false);
  };

  // Clear handles on logout
  useEffect(() => { if (!user) { openBatch(null); } }, [user]);

  const load = useCallback(async (id: string, keepChoices = false) => {
    setLoading(true); setError("");
    try {
      const d = await photoImportApi.get(id);
      if (currentIdRef.current !== id) return;
      setDetail(d);
      if ((d.batch as Partial<BatchExt>).localIssuesAcknowledged) setAck(true);
      const queued = loadQueue(sessionStorage, id);
      syncGate(id);
      if (queued.length > 0) {
        setIssues((prev) => mergeIssues(prev, queued.map((i) => ({ filename: i.filename, error: i.message, bytes: i.bytes, code: i.code }))));
        void flushPending(id);
      }
      if (d.batch.plan && !keepChoices) {
        const c = choicesFromPlan(d.batch.plan);
        setAssign(Object.fromEntries(Object.entries(c.assign).map(([k, v]) => [k, String(v)])));
        setExcluded(new Set(c.excluded));
        setCovers(Object.fromEntries(Object.entries(c.covers).map(([k, v]) => [k, v])));
        return;
      }
      setAssign((prev) => {
        const next = { ...prev };
        for (const f of d.batch.files) {
          if (next[f.id] !== undefined) continue;
          { const m = d.matches[f.id]; if (m?.status === "candidate" && m.candidateIds.length === 1) next[f.id] = String(m.candidateIds[0]); }
        }
        return next;
      });
    } catch (e) {
      if (e instanceof PhotoImportApiError && e.status === 404) openBatch(null);
      else setError(e instanceof Error ? e.message : "Failed to load batch");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (batchId) void load(batchId); }, [batchId, load]);

  const batch = detail?.batch ?? null;
  const catalog = detail?.catalog ?? [];
  const files = useMemo(() => (batch ? [...batch.files].sort((a, b) => naturalCompare(a.filename, b.filename)) : []), [batch]);
  const ext = (batch ?? {}) as Partial<BatchExt>;
  const allIssues: LocalIssue[] = useMemo(() => mergeIssues(
    (ext.localIssues ?? []).filter((i) => !i.resolved).map((i) => ({ filename: i.filename, error: i.message, bytes: i.bytes, code: i.code })),
    unresolvedIssueCopies(issues, ext.localIssues ?? [])),
    [ext.localIssues, issues]);
  const readyCount = files.filter((f) => f.status === "ready").length;
  const names = useMemo(() => Object.fromEntries(files.map((f) => [f.id, f.filename])), [files]);
  const editable = batch?.status === "staging" || batch?.status === "reviewed";

  const createBatch = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const { batch: b } = await photoImportApi.create(name.trim());
      setName(""); await queryClient.invalidateQueries({ queryKey: LIST_KEY }); openBatch(b.id);
    } catch (e) { toast({ title: "Could not create batch", description: String((e as Error).message), variant: "destructive" }); }
    finally { setCreating(false); }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []).sort((a, b) => naturalCompare(a.name, b.name));
    setLocalFiles(picked); setAck(false);
    setLocalTotals({ selected: picked.length, selectedBytes: picked.reduce((n, f) => n + f.size, 0) });
    e.target.value = "";
  };

  const flushPending = async (id: string) => {
    syncGate(id); // synchronous: queue/in-flight already block review and apply
    const p = gateRef.current.flush(id, (list, totals) => photoImportApi.reportIssues(id, list, totals));
    syncGate(id);
    const res = await p;
    if (currentIdRef.current !== id) return; // late result for a previous batch
    if (res.ok) { setPersistError(""); await load(id, true); } // report invalidates the plan: refresh, never keep the old review
    else setPersistError(`Could not save file errors to the batch: ${res.error?.message ?? "request failed"}`);
    syncGate(id);
  };

  const runUpload = async () => {
    if (!batch || !rights || locked) return;
    cancelRef.current = false; setRunning(true); setAck(false); setIssues([]);
    const problems: LocalIssue[] = [];
    saveTotals(sessionStorage, batch.id, { selectedFiles: localFiles.length, selectedBytes: localFiles.reduce((n, f) => n + f.size, 0) });
    const flag = (file: File, error: string) => {
      const code = issueCode(error);
      problems.push({ filename: file.name, error, bytes: file.size, code });
      setIssues((prev) => mergeIssues(prev, [{ filename: file.name, error, bytes: file.size, code }]));
      enqueueIssue(sessionStorage, batch.id, { filename: file.name, bytes: file.size, code, message: error }); // durable before network
      void flushPending(batch.id);
    };
    const total = localFiles.length;
    setProgress({ done: 0, total, current: "" });
    let current = batch;
    try {
      for (let i = 0; i < total; i++) {
        if (cancelRef.current) break;
        const file = localFiles[i];
        setProgress({ done: i, total, current: file.name });
        try {
          const info = await inspectOriginal(file);
          if ("error" in info) { flag(file, info.error); continue; }
          const existing = current.files.find((f) => f.filename === file.name);
          if (existing && existing.sha256 !== info.sha256) { flag(file, "Same filename but different content than the recorded file. Rename the file to import it as a new photo."); continue; }
          if (existing?.status === "ready") continue;
          const proc = await processPhoto(file, info.contentType, info.sha256);
          if ("error" in proc) { flag(file, proc.error); continue; }
          const reg = await photoImportApi.addFiles(current.id, [{ filename: file.name, sha256: info.sha256, bytes: file.size, contentType: info.contentType }]);
          current = reg.batch;
          const rec = current.files.find((f) => f.filename === file.name && f.sha256 === info.sha256);
          if (!rec) { flag(file, "Server did not record file"); continue; }
          if (rec.status === "ready") continue;
          const slots = await photoImportApi.uploadUrls(current.id, rec.id, proc.card.decl, proc.detail.decl);
          if (slots.ready) continue;
          await putObject(slots.original.uploadURL, file, info.contentType);
          await putObject(slots.card.uploadURL, proc.card.blob, proc.card.contentType);
          await putObject(slots.detail.uploadURL, proc.detail.blob, proc.detail.contentType);
          current = (await withRetry(() => photoImportApi.finalize(current.id, rec.id), 3, (e) => !(e instanceof PhotoImportApiError && [401, 403, 409, 422].includes(e.status)))).batch;
        } catch (e) {
          if (e instanceof PhotoImportApiError && e.status === 401) { toast({ title: "Signed out", description: "Sign in again, then reselect the folder to resume.", variant: "destructive" }); break; }
          flag(file, e instanceof Error ? e.message : "Upload failed");
        }
      }
    } finally {
      await flushPending(batch.id);
      setProgress((p) => ({ ...p, done: total, current: "" })); setRunning(false);
      await load(batch.id); void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    }
  };

  const activeFiles = files.filter((f) => f.status === "ready" && !excluded.has(f.id));
  const unresolved = activeFiles.filter((f) => !assign[f.id]);
  const notReady = files.filter((f) => f.status !== "ready" && !excluded.has(f.id));
  const placeGroups = useMemo(() => {
    const g: Record<string, PhotoImportFile[]> = {};
    for (const f of activeFiles) if (assign[f.id]) (g[assign[f.id]] ||= []).push(f);
    return g;
  }, [activeFiles, assign]);

  const coverFor = (lid: string) => {
    const ids = orderFileIds((placeGroups[lid] ?? []).map((f) => f.id), names, null);
    return covers[lid] && ids.includes(covers[lid]) ? covers[lid] : ids[0];
  };

  const dryRun = async () => {
    if (!batch || locked || !canReviewOrApply(gateRef.current, batch.id)) return;
    setBusy(true);
    try {
      const { batch: b } = await photoImportApi.review(batch.id, {
        assignments: activeFiles.map((f) => ({ fileId: f.id, listingId: Number(assign[f.id]) })),
        covers: Object.keys(placeGroups).map((lid) => ({ listingId: Number(lid), fileId: coverFor(lid) })),
        excludedFileIds: files.filter((f) => excluded.has(f.id)).map((f) => f.id),
        ...(allIssues.length > 0 ? { acknowledgeLocalIssues: ack } : {}),
      });
      setDetail((d) => (d ? { ...d, batch: b } : d));
      toast({ title: "Dry run built", description: "Nothing has been changed yet." });
    } catch (e) { toast({ title: "Dry run failed", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const mutate = async (kind: "apply" | "restore") => {
    if (!batch || locked) return;
    if (kind === "apply" && !canReviewOrApply(gateRef.current, batch.id)) { setConfirm(null); return; }
    setBusy(true); setConfirm(null);
    try {
      const { batch: b } = kind === "apply" ? await photoImportApi.apply(batch.id, batch.plan!.reviewToken) : await photoImportApi.restore(batch.id);
      setDetail((d) => (d ? { ...d, batch: b } : d));
      toast({ title: kind === "apply" ? "Photos applied (listings not published)" : "Previous photos restored" });
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    } catch (e) {
      if (e instanceof PhotoImportApiError && e.status === 409) { setConflict(true); await load(batch.id, true); }
      else toast({ title: `${kind} failed`, description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const downloadReport = (b: PhotoImportBatch) => {
    const report = { private: true, batchId: b.id, name: b.name, status: b.status, generatedAt: new Date().toISOString(), plan: b.plan, source: { selectedFiles: (b as Partial<BatchExt>).sourceTotals?.selectedFiles ?? localTotals.selected, selectedBytes: (b as Partial<BatchExt>).sourceTotals?.selectedBytes ?? localTotals.selectedBytes, registeredFiles: b.files.length, readyFiles: b.files.filter((f) => f.status === "ready").length }, localIssues: allIssues, localIssuesAcknowledged: ack || (b as Partial<BatchExt>).localIssuesAcknowledged === true, excludedByReviewer: b.files.filter((f) => excluded.has(f.id)).map((f) => f.filename), files: b.files.map((f) => ({ id: f.id, filename: f.filename, sha256: f.sha256, bytes: f.bytes, status: f.status, error: f.error, duplicateOf: f.duplicateOf })) };
    const auditReport = { ...report, resolvedIssues: (b.localIssues ?? []).filter((i) => i.resolved) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(auditReport, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `photo-import-${b.id}-private-report.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const planBytes = (ids: string[]) => ids.reduce((s, id) => { const f = batch?.files.find((x) => x.id === id); return s + (f?.photo ? f.photo.card.bytes + f.photo.detail.bytes : 0); }, 0);
  const currentChoices: Choices = {
    assign: Object.fromEntries(activeFiles.filter((f) => assign[f.id]).map((f) => [f.id, Number(assign[f.id])])),
    covers: Object.fromEntries(Object.keys(placeGroups).map((lid) => [Number(lid), coverFor(lid)])),
    excluded: files.filter((f) => excluded.has(f.id)).map((f) => f.id),
  };
  const planDirty = !!batch?.plan && editable && !planMatchesChoices(batch.plan, currentChoices);
  const planStale = !!batch?.plan && batch.status === "reviewed" && !planDirty;

  // ---------- History view ----------
  if (!batchId) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-photo-import-title">Photo Import</h1>
          <p className="text-sm text-muted-foreground">Match a folder of photos to existing places. Nothing changes on a listing until you review a dry run and apply it.</p>
        </div>
        <Card className="p-4 flex gap-2">
          <Input placeholder="Batch name, e.g. Tobago north coast, spring shoot" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-batch-name" />
          <Button onClick={createBatch} disabled={creating || !name.trim()} data-testid="button-create-batch">{creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Start batch</Button>
        </Card>
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">History</h2>
          {list.isLoading && [0, 1, 2].map((i) => <Card key={i} className="h-14 animate-pulse" />)}
          {list.isError && <Card className="p-4 flex items-center justify-between"><span className="text-sm text-destructive">{(list.error as Error).message}</span><Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button></Card>}
          {list.data && list.data.batches.length === 0 && <Card className="p-8 text-center text-sm text-muted-foreground">No photo batches yet. Name one above to begin.</Card>}
          {list.data?.batches.map((b) => (
            <Card key={b.id} className="p-4 flex items-center justify-between gap-3 hover-elevate cursor-pointer" onClick={() => openBatch(b.id)} data-testid={`row-batch-${b.id}`}>
              <div className="min-w-0"><div className="font-semibold truncate">{b.name}</div><div className="text-xs text-muted-foreground">{b.fileCount} files, updated {new Date(b.updatedAt).toLocaleString()}</div></div>
              <Badge variant="secondary" className="capitalize">{b.status}</Badge>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ---------- Batch view ----------
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" disabled={locked} onClick={() => openBatch(null)} data-testid="button-back-history">All batches</Button>
          <h1 className="text-2xl font-bold">{batch?.name ?? "Loading batch"}</h1>
          {batch && <Badge variant="secondary" className="capitalize">{batch.status}</Badge>}
        </div>
        {batch && <Button variant="outline" onClick={() => downloadReport(batch)} data-testid="button-download-report"><Download className="h-4 w-4 mr-2" />Private report</Button>}
      </div>

      {loading && !batch && <Card className="h-40 animate-pulse" />}
      {error && <Card className="p-4 flex items-center justify-between"><span className="text-sm text-destructive">{error}</span><Button size="sm" variant="outline" onClick={() => load(batchId)}>Retry</Button></Card>}
      {persistError && (
        <Card className="p-4 border-destructive flex items-center justify-between gap-3" data-testid="alert-persist">
          <span className="text-sm">{persistError} Review is disabled until this is saved.</span>
          <Button size="sm" variant="outline" disabled={locked} onClick={() => batch && flushPending(batch.id)}>Retry saving</Button>
        </Card>
      )}
      {conflict && (
        <Card className="p-4 border-destructive flex items-center justify-between gap-3" data-testid="alert-conflict">
          <div className="text-sm"><b>Listings changed since the dry run.</b> Nothing was overwritten. Review the refreshed data and build a new dry run.</div>
          <Button size="sm" variant="outline" onClick={() => { setConflict(false); void load(batchId, true); }}><RefreshCw className="h-4 w-4 mr-2" />Refreshed</Button>
        </Card>
      )}

      {batch && editable && (
        <Card className="p-4 space-y-4">
          <div className="flex gap-2 items-start text-sm"><ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Originals are stored privately and never shown publicly. Only resized copies (card 640 px, detail 1600 px, metadata removed) can appear in the app. Only upload photos you have the right to publish.</p></div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex"><input type="file" disabled={locked} className="hidden" multiple accept="image/jpeg,image/png,image/webp" onChange={onPick} data-testid="input-files" /><span className="inline-flex items-center rounded-md border px-3 py-2 text-sm cursor-pointer hover-elevate">Choose files</span></label>
            <label className="inline-flex"><input type="file" disabled={locked} className="hidden" onChange={onPick} data-testid="input-folder" webkitdirectory="" directory="" /><span className="inline-flex items-center rounded-md border px-3 py-2 text-sm cursor-pointer hover-elevate"><FolderOpen className="h-4 w-4 mr-2" />Choose folder</span></label>
            <span className="text-sm self-center text-muted-foreground">{localFiles.length} selected, {readyCount} of {files.length} already uploaded. Reselect the same folder to resume; ready files are skipped.</span>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={rights} onCheckedChange={(v) => setRights(v === true)} data-testid="checkbox-rights" />I confirm we have the rights to use these photos.</label>
          <div className="flex gap-2">
            <Button onClick={runUpload} disabled={!rights || locked || localFiles.length === 0} data-testid="button-upload">{running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Process and upload</Button>
            {running && <Button variant="outline" onClick={() => { cancelRef.current = true; }}>Stop after this file</Button>}
          </div>
          {(running || progress.total > 0) && <div className="space-y-1"><Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} /><div className="text-xs text-muted-foreground">{progress.done} of {progress.total}{progress.current && `, working on ${progress.current}`}</div></div>}
          {allIssues.length > 0 && (
            <div className="rounded-md border border-destructive p-3 text-sm space-y-1" data-testid="list-issues">
              <b>{allIssues.length} file(s) were not imported:</b>
              {allIssues.map((i) => <div key={`${i.filename}:${i.code}`}><span className="font-mono">{i.filename}</span>: {i.error}</div>)}
              <label className="flex items-center gap-2 pt-1"><Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="checkbox-ack-issues" />I acknowledge these files are excluded from this import and listed in the private report.</label>
            </div>
          )}
        </Card>
      )}

      {batch && files.length === 0 && !loading && <Card className="p-8 text-center text-sm text-muted-foreground">No files in this batch yet. Choose a folder above.</Card>}

      {batch && files.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex justify-between flex-wrap gap-2 text-sm">
            <h2 className="font-bold">Match photos to places</h2>
            <span className="text-muted-foreground">{unresolved.length} unresolved, {excluded.size} excluded, {notReady.length} not ready</span>
          </div>
          <div className="divide-y">
            {files.map((f) => {
              const m = detail?.matches[f.id];
              const isEx = excluded.has(f.id);
              const dupe = f.duplicateOf ? files.find((x) => x.id === f.duplicateOf) : null;
              return (
                <div key={f.id} className="py-2 grid gap-2 md:grid-cols-[1fr_16rem_auto] items-center" data-testid={`row-file-${f.id}`}>
                  <div className="min-w-0 flex gap-3 items-center">
                    {f.photo ? <img src={f.photo.card.url} alt={f.filename} width={96} height={72} loading="lazy" className="h-[72px] w-24 rounded-md object-cover shrink-0 bg-muted" /> : <div className="h-[72px] w-24 rounded-md bg-muted shrink-0" />}
                    <div className="min-w-0">
                    <div className="font-mono text-sm truncate">{f.filename}</div>
                    <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                      <span>{fmtBytes(f.bytes)}</span>
                      <Badge variant={f.status === "failed" ? "destructive" : "secondary"}>{f.status}</Badge>
                      {m?.status === "ambiguous" && <span>Ambiguous match: choose manually</span>}
                      {m?.status === "no_match" && <span>No match: choose manually</span>}
                      {dupe && <span>Duplicate of {dupe.filename}</span>}
                      {f.error && <span className="text-destructive">{f.error}</span>}
                    </div>
                    </div>
                  </div>
                  <select className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50" disabled={locked || isEx || !editable || f.status !== "ready"} value={assign[f.id] ?? ""} onChange={(e) => setAssign((a) => ({ ...a, [f.id]: e.target.value }))} data-testid={`select-place-${f.id}`}>
                    <option value="">Select place</option>
                    {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}{c.location ? `, ${c.location}` : ""} ({c.category}, {c.status})</option>)}
                  </select>
                  <Button size="sm" variant={isEx ? "default" : "outline"} disabled={locked || !editable} onClick={() => setExcluded((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}>{isEx ? "Include" : "Exclude"}</Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {batch && editable && Object.keys(placeGroups).length > 0 && (
        <Card className="p-4 space-y-3">
          <h2 className="font-bold">Cover photo per place</h2>
          {Object.entries(placeGroups).map(([lid, fs]) => {
            const place = catalog.find((c) => String(c.id) === lid);
            const ordered = orderFileIds(fs.map((f) => f.id), names, null);
            return (
              <div key={lid} className="flex gap-3 items-center flex-wrap text-sm">
                <span className="font-semibold min-w-48">{place?.name ?? lid}</span>
                <select className="h-9 rounded-md border bg-background px-2" disabled={locked} value={coverFor(lid)} onChange={(e) => setCovers((c) => ({ ...c, [lid]: e.target.value }))} data-testid={`select-cover-${lid}`}>
                  {ordered.map((id) => <option key={id} value={id}>{names[id]}</option>)}
                </select>
                <div className="flex gap-2 flex-wrap">
                  {ordered.map((id) => { const ph = fs.find((x) => x.id === id)?.photo; const isCover = id === coverFor(lid); return ph ? (
                    <button type="button" key={id} disabled={locked} onClick={() => setCovers((c) => ({ ...c, [lid]: id }))} className={`rounded-md overflow-hidden border-2 ${isCover ? "border-primary" : "border-transparent"}`} aria-label={`Use ${names[id]} as cover`} aria-pressed={isCover}>
                      <img src={ph.card.url} alt={names[id]} width={96} height={72} className="h-[72px] w-24 object-cover" />
                    </button>) : null; })}
                </div>
                <span className="text-xs text-muted-foreground">{ordered.length} photo(s); cover first, then filename order</span>
              </div>
            );
          })}
        </Card>
      )}

      {batch && editable && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={dryRun} disabled={locked || (allIssues.length > 0 && !ack) || !!persistError || reportPending || unresolved.length > 0 || notReady.length > 0 || activeFiles.length + excluded.size === 0} data-testid="button-dry-run">{busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Build dry run</Button>
          {(unresolved.length > 0 || notReady.length > 0) && <span className="text-sm text-muted-foreground">Assign or exclude every file, and finish uploading, before building a dry run.</span>}
        </div>
      )}

      {batch?.plan && (
        <Card className="p-4 space-y-3" data-testid="card-plan">
          <div className="flex justify-between flex-wrap gap-2">
            <h2 className="font-bold">Dry run</h2>
            <span className="text-sm text-muted-foreground">{batch.plan.entries.length} places, {batch.plan.excludedFileIds.length} excluded, {fmtBytes(planBytes(batch.plan.entries.flatMap((e) => e.fileIds)))} of display copies</span>
          </div>
          {batch.plan.entries.map((e) => (
            <div key={e.listingId} className="rounded-md border p-3 text-sm grid md:grid-cols-2 gap-3">
              <div className="md:col-span-2 font-semibold">{e.listingName} <span className="font-normal text-muted-foreground">({e.fileIds.length} new photo(s), cover {names[e.coverFileId] ?? e.coverFileId})</span></div>
              <div><div className="text-xs uppercase text-muted-foreground">Before</div>Cover: <span className="break-all">{e.before.featuredImage ?? "none"}</span><br />Existing gallery: {e.before.galleryImages?.length ?? 0} (kept)</div>
              <div><div className="text-xs uppercase text-muted-foreground">After</div>Cover: <span className="break-all">{e.after.featuredImage ?? "none"}</span><br />Gallery: {e.after.galleryImages?.length ?? 0}</div>
            </div>
          ))}
          {batch.plan.excludedFileIds.length > 0 && <div className="text-xs text-muted-foreground">Excluded: {batch.plan.excludedFileIds.map((id) => names[id] ?? id).join(", ")}</div>}
          {planDirty && <p className="text-sm text-destructive" data-testid="text-plan-dirty">Your choices changed after this dry run. Build a new dry run before applying.</p>}
          <p className="text-xs text-muted-foreground">Applying updates photo fields only. Draft listings stay drafts; nothing is published.</p>
          <div className="flex gap-2">
            {planStale && <Button onClick={() => setConfirm("apply")} disabled={locked || reportPending || !!persistError} data-testid="button-apply">Apply reviewed import</Button>}
            {batch.status === "applied" && <Button variant="outline" onClick={() => setConfirm("restore")} disabled={locked} data-testid="button-restore">Restore previous photos</Button>}
          </div>
        </Card>
      )}
      {batch?.status === "applied" && batch.report && <div className="text-sm text-muted-foreground">Applied: {batch.report.photoCount} photos across {batch.report.listingCount} places.</div>}
      {batch?.status === "restored" && <div className="text-sm text-muted-foreground">This batch was restored to the previous photos.</div>}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "apply" ? "Apply reviewed photo import?" : "Restore previous photos?"}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "apply" ? "This changes photo fields on the listed places. Existing photos are kept and nothing is published. If a listing changed after the dry run, the apply is refused." : "This puts back each place's prior photo fields. No files or listings are deleted."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && mutate(confirm)} data-testid="button-confirm">{confirm === "apply" ? "Apply" : "Restore"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

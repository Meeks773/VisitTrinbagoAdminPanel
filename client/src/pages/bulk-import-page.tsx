import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CATEGORY_LABELS } from "@shared/schema";
import type { ImportBatchSummary, ImportCommitResponse, ImportPreviewResponse } from "@shared/import-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Download, Loader2, Upload } from "lucide-react";

const PAGE_SIZE = 20;
const MAX_SIZE = 5 * 1024 * 1024;

async function errorFrom(res: Response): Promise<Error> {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    return new Error(body.message || body.error || text || `Request failed (${res.status})`);
  } catch {
    return new Error(text || `Request failed (${res.status})`);
  }
}

export default function BulkImportPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<"preview" | "commit" | "template" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [error, setError] = useState("");
  const batches = useQuery<ImportBatchSummary[]>({ queryKey: ["/api/imports"] });

  const eligible = preview?.rows.filter((row) => row.existingId == null) ?? [];
  const filtered = preview?.rows.filter((row) =>
    `${row.data.name} ${row.data.category} ${row.sheet} ${row.rowNumber} ${row.data.location ?? ""}`
      .toLowerCase().includes(search.toLowerCase())) ?? [];
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE);
  const visibleEligible = visible.filter((row) => row.existingId == null);

  async function loadPreview() {
    if (!file) return;
    setBusy("preview");
    setError("");
    setPreview(null);
    setResult(null);
    try {
      const res = await fetch("/api/imports/preview", {
        method: "POST", credentials: "include",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      if (!res.ok) throw await errorFrom(res);
      const data: ImportPreviewResponse = await res.json();
      setPreview(data);
      setSelected(data.rows.filter((row) => row.existingId == null).map((row) => row.key));
      setPage(1);
      setSearch("");
      await queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      setError(message);
      toast({ title: "Preview failed", description: message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function downloadTemplate() {
    setBusy("template");
    setError("");
    try {
      const res = await fetch("/api/imports/template", { credentials: "include" });
      if (!res.ok) throw await errorFrom(res);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "place-import-template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Template download failed";
      setError(message);
      toast({ title: "Template download failed", description: message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!preview || !selected.length) return;
    setConfirm(false);
    setBusy("commit");
    setError("");
    try {
      const res = await fetch(`/api/imports/${preview.batchId}/commit`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: selected }),
      });
      if (!res.ok) throw await errorFrom(res);
      const data: ImportCommitResponse = await res.json();
      setResult(data);
      setPreview(null);
      setSelected([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/imports"] }),
        queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/listings") }),
      ]);
      toast({ title: `${data.importedCount} drafts imported` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      setError(message);
      toast({ title: "Import failed", description: message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-widest text-primary">Content workflow</p><h1 className="text-3xl font-black uppercase">Bulk Import</h1><p className="text-sm text-muted-foreground">Preview an XLSX workbook before creating hidden drafts. Existing listings are never overwritten.</p></div>
        <Button variant="outline" onClick={downloadTemplate} disabled={!!busy}><Download className="h-4 w-4 mr-2" />{busy === "template" ? "Downloading..." : "Download template"}</Button>
      </div>
      <Card className="p-5 space-y-4">
        <label htmlFor="import-file" className="block text-sm font-bold">XLSX workbook (maximum 5 MB)</label>
        <div className="flex flex-wrap gap-3 items-center">
          <Input id="import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="max-w-md" disabled={!!busy} onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setPreview(null); setResult(null); setSelected([]); setError("");
            if (next && (!next.name.toLowerCase().endsWith(".xlsx") || next.size > MAX_SIZE || next.size === 0)) {
              setFile(null); setError("Choose a non-empty .xlsx file no larger than 5 MB.");
              return;
            }
            setFile(next);
          }} />
          <Button onClick={loadPreview} disabled={!file || !!busy}>{busy === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}Preview workbook</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </Card>
      {result && <Card className="p-5 space-y-2"><h2 className="font-black uppercase">Import complete</h2><p>{result.importedCount} hidden drafts created; {result.skippedCount} skipped.{result.alreadyImported ? " This batch was already imported." : ""}</p><Button asChild><Link href="/drafts">Review drafts</Link></Button></Card>}
      {preview && <div className="space-y-5">
        <Card className="p-5 space-y-3">
          <h2 className="font-black uppercase">Preview: {preview.fileName}</h2>
          <p className="text-sm">{preview.rows.length} preview rows · {eligible.length} eligible · {preview.rows.length - eligible.length} existing listings · {preview.skipped.length} skipped rows</p>
          <div className="flex flex-wrap gap-2">{preview.sheets.map((sheet) => <Badge variant="outline" key={sheet.name}>{sheet.name}: {sheet.rows} {sheet.category ? `(${CATEGORY_LABELS[sheet.category]})` : `(not imported${sheet.reason ? `: ${sheet.reason}` : ""})`}</Badge>)}</div>
          {preview.notices.length > 0 && <div className="text-sm space-y-1"><h3 className="font-bold">Notices</h3>{preview.notices.map((notice, i) => <p key={i}>{notice}</p>)}</div>}
          {preview.skipped.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-bold">Skipped rows ({preview.skipped.length})</summary><ul className="list-disc pl-5 mt-2">{preview.skipped.map((row, i) => <li key={i}>{row.sheet} row {row.rowNumber}{row.name ? ` · ${row.name}` : ""}: {row.reason}</li>)}</ul></details>}
        </Card>
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-black uppercase">Select rows to import ({selected.length} of {eligible.length})</h2>
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setSelected(eligible.map((r) => r.key))}>Select all eligible</Button><Button variant="outline" size="sm" onClick={() => setSelected([])}>Select none</Button></div>
          </div>
          <label htmlFor="import-search" className="sr-only">Search preview rows</label>
          <Input id="import-search" placeholder="Search name, category, sheet or location" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <div className="flex items-center gap-2 text-sm"><Checkbox id="select-visible" checked={visibleEligible.length > 0 && visibleEligible.every((r) => selected.includes(r.key))} onCheckedChange={(checked) => setSelected((old) => checked ? Array.from(new Set([...old, ...visibleEligible.map((r) => r.key)])) : old.filter((key) => !visibleEligible.some((r) => r.key === key)))} disabled={!visibleEligible.length} /><label htmlFor="select-visible">Select eligible on this page</label></div>
          <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="border-b"><th className="p-2">Select</th><th className="p-2">Name</th><th className="p-2">Category</th><th className="p-2">Source</th><th className="p-2">Review</th></tr></thead><tbody>{visible.map((row) => <tr className="border-b align-top" key={row.key}><td className="p-2"><Checkbox aria-label={`Import ${row.data.name} from ${row.sheet} row ${row.rowNumber}`} checked={selected.includes(row.key)} disabled={row.existingId != null} onCheckedChange={(checked) => setSelected((old) => checked ? [...old, row.key] : old.filter((key) => key !== row.key))} /></td><td className="p-2 font-semibold">{row.data.name}</td><td className="p-2">{CATEGORY_LABELS[row.data.category]}</td><td className="p-2">{row.sheet} · row {row.rowNumber}</td><td className="p-2">{row.existingId != null ? <span className="text-destructive">Existing listing #{row.existingId} — cannot reimport</span> : <div>{row.verified ? "Verified" : "Unverified"}{row.warnings.length > 0 && <ul className="list-disc pl-5 text-destructive">{row.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}</div>}</td></tr>)}</tbody></table>{!filtered.length && <p className="p-4 text-muted-foreground">No matching rows.</p>}</div>
          <div className="flex items-center justify-between gap-3"><span className="text-sm">Page {Math.min(page, pages)} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>
          <Button disabled={!selected.length || !!busy} onClick={() => setConfirm(true)}>{busy === "commit" ? "Importing..." : `Import ${selected.length} as drafts`}</Button>
        </Card>
      </div>}
      <Card className="p-5 space-y-3"><h2 className="font-black uppercase">Recent imports</h2>{batches.isLoading ? <p>Loading...</p> : batches.isError ? <p role="alert" className="text-destructive">Could not load imports: {batches.error.message}</p> : !batches.data?.length ? <p className="text-sm text-muted-foreground">No imports yet.</p> : <ul className="divide-y">{batches.data.map((batch) => <li key={batch.id} className="py-2 text-sm flex flex-wrap justify-between gap-2"><span>{batch.fileName} · {new Date(batch.createdAt).toLocaleString()}</span><span>{batch.status} · {batch.importedCount} imported · {batch.skippedCount} skipped</span></li>)}</ul>}</Card>
      <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Import {selected.length} rows as drafts?</AlertDialogTitle><AlertDialogDescription>{preview?.rows.length ?? 0} rows previewed; {selected.length} selected; {(preview?.rows.length ?? 0) - eligible.length} existing listings cannot be imported; {preview?.skipped.length ?? 0} rows skipped during parsing. Imported listings are hidden drafts until reviewed and published. No existing listing will be overwritten.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={commit}>Create drafts</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
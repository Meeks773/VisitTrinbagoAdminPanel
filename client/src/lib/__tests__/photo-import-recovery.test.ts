import test from "node:test";
import assert from "node:assert/strict";
import { ReportGate, canReviewOrApply, enqueueIssue, loadQueue, unresolvedIssueCopies } from "../photo-import-state";

const report = { filename: "museum.jpg", bytes: 1000, code: "failed", message: "Display image contains metadata" };
const copy = { filename: report.filename, bytes: report.bytes, code: report.code, error: report.message };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
}
test("queued historical error restored during retry disappears after authoritative resolution, without bypassing reporting", async () => {
  const s = storage(), id = "batch", gate = new ReportGate(s);
  enqueueIssue(s, id, report);
  const restoredCopies = loadQueue(s, id).map((i) => ({ filename: i.filename, bytes: i.bytes, code: i.code, error: i.message }));
  assert.deepEqual(unresolvedIssueCopies(restoredCopies, [report]), [copy]);
  assert.equal(canReviewOrApply(gate, id), false);
  const audit = [{ ...report, resolved: true }];
  assert.deepEqual(unresolvedIssueCopies(restoredCopies, audit), [], "late local UI copy no longer falsely requires exclusion acknowledgement");
  assert.equal(canReviewOrApply(gate, id), false, "resolved UI cannot bypass pending reports");
  let sent = 0;
  assert.equal((await gate.flush(id, async (issues) => { sent += issues.length; })).ok, true);
  assert.equal(sent, 1);
  assert.equal(canReviewOrApply(gate, id), true);
  assert.equal(audit.length, 1, "resolved historical report is retained for audit/export");
  assert.deepEqual(unresolvedIssueCopies([copy], audit), [], "a later refresh cannot revive the stale copy");
});
test("resolution requires exact filename, bytes, code and message, preserving unrelated current errors", () => {
  const others = [
    { ...copy, filename: "other.jpg" }, { ...copy, bytes: 1001 },
    { ...copy, code: "changed" }, { ...copy, error: "Different content" },
  ];
  assert.deepEqual(unresolvedIssueCopies([copy, ...others], [{ ...report, resolved: true }]), others);
  assert.deepEqual(unresolvedIssueCopies([copy], [{ ...report, resolved: false }]), [copy]);
});
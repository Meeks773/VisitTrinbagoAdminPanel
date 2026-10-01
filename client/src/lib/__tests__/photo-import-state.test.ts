import test from "node:test";
import assert from "node:assert/strict";
import { enqueueIssue, flushQueue, loadQueue, saveTotals, loadTotals, planMatchesChoices, choicesFromPlan, type KeyValueStorage } from "../photo-import-state";
import type { PhotoImportPlan } from "@shared/photo-import-types";

const fakeStorage = (): KeyValueStorage & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
const issue = (n: string) => ({ filename: n, bytes: 5, code: "corrupt", message: "bad" });

test("issue is persisted before network and survives failed request + reload", async () => {
  const s = fakeStorage();
  enqueueIssue(s, "b1", issue("a.jpg"));
  assert.equal(loadQueue(s, "b1").length, 1); // before any send
  await assert.rejects(flushQueue(s, "b1", async () => { throw new Error("net"); }));
  assert.equal(loadQueue(s, "b1").length, 1); // retained
  assert.equal(loadQueue(s, "b2").length, 0); // scoped per batch
  const sent: number[] = [];
  await flushQueue(s, "b1", async (i) => { sent.push(i.length); });
  assert.deepEqual(sent, [1]);
  assert.equal(loadQueue(s, "b1").length, 0);
});
test("flush chunks of 100 and keeps unacked remainder", async () => {
  const s = fakeStorage();
  for (let i = 0; i < 150; i++) enqueueIssue(s, "b", issue(`f${i}`));
  let calls = 0;
  await assert.rejects(flushQueue(s, "b", async () => { if (++calls === 2) throw new Error("x"); }));
  assert.equal(loadQueue(s, "b").length, 50);
});
test("no duplicates, totals stored safely", () => {
  const s = fakeStorage();
  enqueueIssue(s, "b", issue("a")); enqueueIssue(s, "b", issue("a"));
  assert.equal(loadQueue(s, "b").length, 1);
  saveTotals(s, "b", { selectedFiles: 3, selectedBytes: 99 });
  assert.deepEqual(loadTotals(s, "b"), { selectedFiles: 3, selectedBytes: 99 });
});

const plan: PhotoImportPlan = { reviewToken: "t", createdAt: "", excludedFileIds: ["x"], entries: [{ listingId: 1, listingName: "A", fileIds: ["f1", "f2"], coverFileId: "f2", before: {} as never, after: {} as never }] };
test("plan choice comparison", () => {
  const c = choicesFromPlan(plan);
  assert.ok(planMatchesChoices(plan, c));
  assert.ok(!planMatchesChoices(plan, { ...c, covers: { 1: "f1" } }));
  assert.ok(!planMatchesChoices(plan, { ...c, excluded: [] }));
  assert.ok(!planMatchesChoices(plan, { ...c, assign: { ...c.assign, f1: 2 } }));
  assert.ok(!planMatchesChoices(null, c));
});

import { ReportGate, canReviewOrApply } from "../photo-import-state";

test("reviewed batch with recovered pending report cannot review/apply until server ack and refresh", async () => {
  const s = fakeStorage();
  const gate = new ReportGate(s);
  let plan: string | null = "token-1"; // reviewed batch on server
  enqueueIssue(s, "b1", issue("bad.png")); // recovered after reload, no network yet
  assert.equal(canReviewOrApply(gate, "b1"), false); // synchronous gate
  assert.equal(canReviewOrApply(gate, "b2"), true); // other batch unaffected

  let release!: () => void;
  const slow = gate.flush("b1", () => new Promise<void>((r) => { release = r; }));
  assert.equal(canReviewOrApply(gate, "b1"), false); // in flight
  release();
  const res = await slow; // server acked; server invalidates plan
  plan = null;
  assert.ok(res.ok && res.refresh);
  assert.equal(canReviewOrApply(gate, "b1"), true);
  assert.equal(plan, null); // caller refreshed: old review is gone

  enqueueIssue(s, "b1", issue("worse.png"));
  const failed = await gate.flush("b1", async () => { throw new Error("net"); });
  assert.equal(failed.ok, false);
  assert.equal(canReviewOrApply(gate, "b1"), false); // failed stays blocked
  await gate.flush("b1", async () => undefined);
  assert.equal(canReviewOrApply(gate, "b1"), true);
});

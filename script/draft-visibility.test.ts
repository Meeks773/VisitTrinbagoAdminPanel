import test from "node:test";
import assert from "node:assert/strict";
import { insertListingSchema, type Listing } from "../shared/schema";
import { publicationErrors, publicListing } from "../server/publication";

const complete = {
  status: "published" as const,
  name: "A place",
  category: "beaches",
  interest: "Nature",
  subInterest: "Coast",
  description: "A description",
  latitude: null,
  longitude: null,
};

test("published records require complete content, allowed category and paired valid coordinates", () => {
  assert.deepEqual(publicationErrors(complete), []);
  for (const field of ["name", "interest", "subInterest", "description"] as const) {
    assert.ok(publicationErrors({ ...complete, [field]: "  " }).some((e) => e.includes(field)));
  }
  assert.ok(publicationErrors({ ...complete, category: "unknown" }).some((e) => e.includes("category")));
  assert.ok(publicationErrors({ ...complete, latitude: 10.5 }).some((e) => e.includes("both")));
  assert.ok(publicationErrors({ ...complete, latitude: 91, longitude: 0 }).length);
  assert.ok(publicationErrors({ ...complete, latitude: 10, longitude: Infinity }).length);
  assert.deepEqual(publicationErrors({ ...complete, latitude: 10.5, longitude: -61.5 }), []);
});

test("drafts may be incomplete; publishing a draft validates the resulting merged record", () => {
  const draft = { ...complete, status: "draft" as const, name: "", description: "", category: "" };
  assert.deepEqual(publicationErrors(draft), []);
  assert.ok(publicationErrors({ ...draft, status: "published" }).length);
  assert.deepEqual(publicationErrors({ ...draft, ...complete }), []);
});

test("normal listing payloads never accept private import provenance", () => {
  const parsed = insertListingSchema.parse({
    ...complete,
    importKey: "private-key",
    importDetails: { rawColumns: { contact: "private" } },
  });
  assert.equal("importKey" in parsed, false);
  assert.equal("importDetails" in parsed, false);
  assert.equal(insertListingSchema.safeParse({ ...complete, status: "unknown" }).success, false);
  assert.equal(insertListingSchema.safeParse({ ...complete, status: "draft" }).success, true);
});

test("public listing representation excludes status and import provenance", () => {
  const listing = {
    ...complete,
    id: 1,
    importKey: "private-key",
    importDetails: { rawColumns: { contact: "private" } },
  } as Listing;
  const visible = publicListing(listing);
  assert.equal(visible.name, "A place");
  assert.equal("status" in visible, false);
  assert.equal("importKey" in visible, false);
  assert.equal("importDetails" in visible, false);
});
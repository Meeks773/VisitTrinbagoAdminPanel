---
name: Media publication boundary
description: Why legacy photos require catalogue-aware serving rather than blanket public or private storage routes.
---

Preserve already-published photos while keeping originals and unpublished uploads
private. Do not treat the old uploads prefix or object custom metadata as proof
of permission to serve publicly.

**Why:** The photo handoff identified anonymous object serving, but existing
published images use the same legacy namespace. Blanket denial would break those
images; blanket permission would expose private or unused uploads. Media
visibility must follow publication and original/display intent.

**How to apply:** Future upload/import changes must preserve that distinction.
If introducing event drafts, new media variants, or shared/CDN caches, update
their publication checks and invalidation behavior together.
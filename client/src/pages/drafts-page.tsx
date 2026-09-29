import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { type Category, CATEGORIES, CATEGORY_LABELS } from "@shared/schema";
import type { AdminListing } from "@/lib/import-listing";
import { missingPublicationFields } from "@/lib/import-listing";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function DraftsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const { data, isLoading, error } = useQuery<AdminListing[]>({ queryKey: ["/api/listings"] });
  const drafts = data?.filter((listing) => listing.status === "draft") ?? [];
  const filtered = drafts.filter((listing) =>
    (category === "all" || listing.category === category) &&
    `${listing.name} ${listing.description} ${listing.subInterest} ${listing.importDetails?.fileName ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
    <div className="flex flex-wrap justify-between gap-3 items-end"><div><p className="text-xs font-bold text-primary uppercase tracking-widest">Content workflow</p><h1 className="text-3xl font-black uppercase">Draft Review</h1><p className="text-sm text-muted-foreground">Drafts are hidden from the public until published after review.</p></div><Button variant="outline" asChild><Link href="/imports">Bulk Import</Link></Button></div>
    <div className="flex flex-wrap gap-3 items-end">
      <div className="flex-1 min-w-48"><label htmlFor="draft-search" className="text-sm font-semibold">Search drafts</label><Input id="draft-search" placeholder="Name, description or source file" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div><label htmlFor="draft-category" className="text-sm font-semibold block">Category</label><select id="draft-category" className="h-9 rounded-md border bg-background px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{CATEGORIES.map((cat) => <option value={cat} key={cat}>{CATEGORY_LABELS[cat]}</option>)}</select></div>
    </div>
    {isLoading ? <p>Loading drafts...</p> : error ? <p role="alert" className="text-destructive">Could not load drafts: {error.message}</p> : <>
      <p className="text-sm font-bold">{filtered.length} matching drafts · {drafts.length} total</p>
      {!filtered.length ? <Card className="p-8 text-center text-muted-foreground">No drafts match your filters.</Card> : <div className="space-y-3">{filtered.map((listing) => {
        const missing = missingPublicationFields(listing);
        const warnings = listing.importDetails?.warnings ?? [];
        return <Card key={listing.id} className="p-4 flex flex-wrap justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]"><h2 className="font-black">{listing.name || "Untitled draft"}</h2><p className="text-sm">{CATEGORY_LABELS[listing.category as Category] ?? listing.category} · {listing.subInterest || "No sub-interest"}</p>
            {listing.importDetails && <p className="text-xs text-muted-foreground">Source: {listing.importDetails.fileName} · {listing.importDetails.sheet} row {listing.importDetails.rowNumber}</p>}
            {missing.length > 0 && <p className="text-sm text-destructive">Missing required publication fields: {missing.join(", ")}</p>}
            {warnings.length > 0 && <div className="text-sm text-destructive"><strong>{warnings.length} import warning{warnings.length === 1 ? "" : "s"}:</strong><ul className="list-disc pl-5">{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
          </div><Button asChild><Link href={`/category/${listing.category}/edit/${listing.id}`}>Edit & review</Link></Button>
        </Card>;
      })}</div>}
    </>}
  </div>;
}
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { type Category, CATEGORY_LABELS, CATEGORIES } from "@shared/schema";
import { categoryIcons } from "@/lib/category-config";
import { ListingForm } from "@/components/listing-form";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from "react";
import type { AdminListing } from "@/lib/import-listing";
import { missingPublicationFields } from "@/lib/import-listing";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ListingFormPage() {
  const [, paramsNew] = useRoute("/category/:category/new");
  const [, paramsEdit] = useRoute("/category/:category/edit/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [animateIn, setAnimateIn] = useState(false);

  const category = (paramsNew?.category || paramsEdit?.category) as Category;
  const editId = paramsEdit?.id ? Number(paramsEdit.id) : null;
  const isEdit = editId !== null;

  const isValidCategory = CATEGORIES.includes(category as any);
  const Icon = isValidCategory ? categoryIcons[category] : null;
  const label = isValidCategory ? CATEGORY_LABELS[category] : "Unknown";

  useEffect(() => {
    requestAnimationFrame(() => setAnimateIn(true));
  }, []);

  const { data: listing, isLoading: isLoadingListing, error: listingError } = useQuery<AdminListing>({
    queryKey: ["/api/listings", editId],
    queryFn: async () => {
      const res = await fetch(`/api/listings/${editId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load listing (${res.status}): ${await res.text()}`);
      return res.json();
    },
    enabled: isEdit && isValidCategory,
  });

  // Snapshot of media exactly as first fetched, for backend compare-and-swap (never derived from edited values).
  const expectedMediaRef = useRef<{ id: number; media: Record<string, unknown> } | null>(null);
  if (listing && editId !== null && expectedMediaRef.current?.id !== editId) {
    const l = listing as unknown as Record<string, any>;
    expectedMediaRef.current = { id: editId, media: { featuredImage: l.featuredImage ?? null, galleryImages: l.galleryImages ?? null, photoMedia: l.photoMedia ?? null } };
  }
  const expectedMedia = () => expectedMediaRef.current?.id === editId ? expectedMediaRef.current?.media : undefined;

  const invalidateAndGoBack = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/listings");
      },
    });
    setAnimateIn(false);
    setTimeout(() => navigate(`/category/${category}`), 200);
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/listings", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Listing created successfully" });
      invalidateAndGoBack();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/listings/${editId}`, { ...(listing?.status === "draft" ? { ...data, status: "draft" } : data), expectedMedia: expectedMedia() });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Listing updated successfully" });
      invalidateAndGoBack();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (status: "draft") => {
      const res = await apiRequest("PATCH", `/api/listings/${editId}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/listings") });
      toast({ title: "Listing returned to draft" });
      navigate("/drafts");
    },
    onError: (err: Error) => toast({ title: "Status change failed", description: err.message, variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/listings/${editId}`, { ...data, status: "published", expectedMedia: expectedMedia() });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Listing published" });
      invalidateAndGoBack();
    },
    onError: (err: Error) => toast({ title: "Could not publish listing", description: err.message, variant: "destructive" }),
  });

  const handleBack = () => {
    setAnimateIn(false);
    setTimeout(() => navigate(`/category/${category}`), 200);
  };

  if (!isValidCategory) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-muted-foreground font-semibold">Category not found.</p>
      </div>
    );
  }

  if (isEdit && isLoadingListing) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-muted-foreground font-semibold">Loading listing...</p>
      </div>
    );
  }

  if (isEdit && (listingError || !listing)) {
    return <div role="alert" className="p-8 text-destructive">Could not load listing: {listingError?.message ?? "Listing not found"}</div>;
  }

  return (
    <div
      className="transition-all duration-300 ease-out"
      style={{
        opacity: animateIn ? 1 : 0,
        transform: animateIn ? "translateY(0)" : "translateY(24px)",
      }}
    >
      <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
        <div>
          <Button variant="ghost" onClick={() => listing?.status === "draft" ? navigate("/drafts") : handleBack()} data-testid="button-back" className="mb-4 -ml-2 font-semibold uppercase tracking-wide text-muted-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to {listing?.status === "draft" ? "Draft Review" : label}
          </Button>

          <div className="flex items-center gap-4">
            {Icon && (
              <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary">
                <Icon className="h-6 w-6 text-primary-foreground" />
              </div>
            )}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
                {isEdit ? "Edit Listing" : "New Listing"}
              </p>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight uppercase" data-testid="text-form-title">
                {isEdit ? listing?.name || "Edit" : `Add ${label}`}
              </h1>
            </div>
          </div>
        </div>

        {isEdit && listing && <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div><Badge variant={listing.status === "draft" ? "outline" : "secondary"} className="uppercase">{listing.status === "draft" ? "Draft · hidden" : "Published"}</Badge><p className="text-sm text-muted-foreground mt-2">{listing.status === "draft" ? "Saving changes keeps this listing hidden. Publish only after reviewing all fields." : "This listing is visible until returned to draft."}</p></div>
            {listing.status !== "draft" && <Button type="button" variant="outline" disabled={statusMutation.isPending || updateMutation.isPending || publishMutation.isPending} onClick={() => statusMutation.mutate("draft")}>Return to draft</Button>}
          </div>
          {listing.status === "draft" && missingPublicationFields(listing).length > 0 && <p className="text-sm text-destructive font-semibold">Current saved draft is missing publication fields: {missingPublicationFields(listing).join(", ")}. Complete them in the form before publishing.</p>}
          {listing.importDetails && <details className="border-t pt-3 text-sm"><summary className="cursor-pointer font-bold">Private import source &amp; review notes (admin only)</summary>
            <div className="mt-3 space-y-2"><p><strong>File:</strong> {listing.importDetails.fileName} · <strong>Sheet:</strong> {listing.importDetails.sheet} · <strong>Row:</strong> {listing.importDetails.rowNumber} · <strong>Batch:</strong> {listing.importDetails.batchId} · {listing.importDetails.verified ? "Verified" : "Unverified"}</p>
              {listing.importDetails.warnings.length > 0 && <div className="text-destructive"><strong>Import warnings:</strong><ul className="list-disc pl-5">{listing.importDetails.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
              <p className="font-bold">Original spreadsheet values (private; not public metadata)</p>
              <dl className="grid gap-2 sm:grid-cols-2">{Object.entries(listing.importDetails.rawColumns).map(([key, value]) => <div className="border rounded p-2 min-w-0" key={key}><dt className="font-semibold break-words">{key}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
            </div>
          </details>}
        </Card>}

        <ListingForm
          key={isEdit ? editId : "new"}
          category={category}
          listing={isEdit ? listing : undefined}
          onSubmit={(data) => isEdit ? updateMutation.mutate(data) : createMutation.mutate(data)}
          onSubmitPublish={listing?.status === "draft" ? (data) => publishMutation.mutate(data) : undefined}
          isPending={isEdit ? updateMutation.isPending || publishMutation.isPending || statusMutation.isPending : createMutation.isPending}
        />
      </div>
    </div>
  );
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { type Category, type Listing, CATEGORY_LABELS, CATEGORIES } from "@shared/schema";
import { categoryIcons } from "@/lib/category-config";
import { ListingForm } from "@/components/listing-form";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";

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

  const { data: listing, isLoading: isLoadingListing } = useQuery<Listing>({
    queryKey: ["/api/listings", editId],
    queryFn: async () => {
      const res = await fetch(`/api/listings/${editId}`);
      if (!res.ok) throw new Error("Failed to load listing");
      return res.json();
    },
    enabled: isEdit && isValidCategory,
  });

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
      const res = await apiRequest("PATCH", `/api/listings/${editId}`, data);
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
          <Button variant="ghost" onClick={handleBack} data-testid="button-back" className="mb-4 -ml-2 font-semibold uppercase tracking-wide text-muted-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to {label}
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

        <ListingForm
          key={isEdit ? editId : "new"}
          category={category}
          listing={isEdit ? listing : undefined}
          onSubmit={(data) => isEdit ? updateMutation.mutate(data) : createMutation.mutate(data)}
          isPending={isEdit ? updateMutation.isPending : createMutation.isPending}
        />
      </div>
    </div>
  );
}

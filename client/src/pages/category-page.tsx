import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { type Category, type Listing, CATEGORY_LABELS, CATEGORIES } from "@shared/schema";
import { categoryIcons } from "@/lib/category-config";
import { ListingForm } from "@/components/listing-form";
import { ListingCard } from "@/components/listing-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function CategoryPage() {
  const [, params] = useRoute("/category/:category");
  const category = params?.category as Category;
  const [showForm, setShowForm] = useState(false);
  const [editListing, setEditListing] = useState<Listing | null>(null);
  const [deleteListing, setDeleteListing] = useState<Listing | null>(null);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const isValidCategory = CATEGORIES.includes(category as any);
  const Icon = isValidCategory ? categoryIcons[category] : null;
  const label = isValidCategory ? CATEGORY_LABELS[category] : "Unknown";

  const { data: listings, isLoading } = useQuery<Listing[]>({
    queryKey: [`/api/listings?category=${category}`],
    enabled: isValidCategory,
  });

  const invalidateListings = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/listings");
      },
    });
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/listings", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateListings();
      setShowForm(false);
      toast({ title: "Listing created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/listings/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateListings();
      setEditListing(null);
      toast({ title: "Listing updated successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/listings/${id}`);
    },
    onSuccess: () => {
      invalidateListings();
      setDeleteListing(null);
      toast({ title: "Listing deleted successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filteredListings = listings?.filter(
    (l) =>
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.description.toLowerCase().includes(search.toLowerCase()) ||
      l.subInterest.toLowerCase().includes(search.toLowerCase()),
  );

  if (!isValidCategory) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-muted-foreground font-semibold">Category not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          {Icon && (
            <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary">
              <Icon className="h-6 w-6 text-primary-foreground" />
            </div>
          )}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Category</p>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight uppercase" data-testid="text-category-title">{label}</h1>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              {isLoading ? "Loading..." : `${listings?.length ?? 0} listings`}
            </p>
          </div>
        </div>
        <Button onClick={() => setShowForm(true)} data-testid="button-add-listing" className="font-bold uppercase tracking-wide">
          <Plus className="h-4 w-4 mr-2" />
          Add {label}
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={`Search ${label.toLowerCase()}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 font-medium"
          data-testid="input-search"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : filteredListings && filteredListings.length > 0 ? (
        <div className="space-y-3">
          {filteredListings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onEdit={() => setEditListing(listing)}
              onDelete={() => setDeleteListing(listing)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          {Icon && <Icon className="h-16 w-16 text-muted-foreground/20 mb-4" />}
          <h3 className="font-extrabold text-lg uppercase tracking-wide text-muted-foreground">No listings yet</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 font-medium">
            Add your first {label.toLowerCase()} listing to get started.
          </p>
          <Button className="mt-6 font-bold uppercase tracking-wide" onClick={() => setShowForm(true)} data-testid="button-add-first">
            <Plus className="h-4 w-4 mr-2" />
            Add {label}
          </Button>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="font-black uppercase tracking-wide">Add New {label}</DialogTitle>
            <DialogDescription>Fill in the details below to create a new {label.toLowerCase()} listing.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] p-6 pt-4">
            <ListingForm
              category={category}
              onSubmit={(data) => createMutation.mutate(data)}
              isPending={createMutation.isPending}
            />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editListing} onOpenChange={() => setEditListing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="font-black uppercase tracking-wide">Edit {editListing?.name}</DialogTitle>
            <DialogDescription>Update the listing details below.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] p-6 pt-4">
            {editListing && (
              <ListingForm
                key={editListing.id}
                category={category}
                listing={editListing}
                onSubmit={(data) => updateMutation.mutate({ id: editListing.id, data })}
                isPending={updateMutation.isPending}
              />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteListing} onOpenChange={() => setDeleteListing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-black uppercase">Delete "{deleteListing?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently remove the listing from the system and the mobile app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteListing && deleteMutation.mutate(deleteListing.id)}
              className="bg-destructive text-destructive-foreground font-bold uppercase"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

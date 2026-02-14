import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { CATEGORIES, CATEGORY_LABELS, type Category, type Listing } from "@shared/schema";
import { categoryIcons } from "@/lib/category-config";
import { ArrowRight, Globe, TrendingUp, Layers } from "lucide-react";

export default function Dashboard() {
  const { data: listings, isLoading } = useQuery<Listing[]>({
    queryKey: ["/api/listings"],
  });

  const categoryCounts = CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat] = listings?.filter((l) => l.category === cat).length ?? 0;
      return acc;
    },
    {} as Record<string, number>,
  );

  const totalListings = listings?.length ?? 0;
  const totalRewardPoints = listings?.reduce((sum, l) => sum + (l.rewardPoints ?? 0), 0) ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Manage your VisitTrinbago content across all categories.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">Total Listings</p>
              {isLoading ? (
                <Skeleton className="h-8 w-16 mt-1" />
              ) : (
                <p className="text-2xl font-bold" data-testid="text-total-listings">{totalListings}</p>
              )}
            </div>
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
              <Layers className="h-5 w-5 text-primary" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">Categories</p>
              <p className="text-2xl font-bold" data-testid="text-total-categories">{CATEGORIES.length}</p>
            </div>
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
              <Globe className="h-5 w-5 text-primary" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">Total Reward Points</p>
              {isLoading ? (
                <Skeleton className="h-8 w-16 mt-1" />
              ) : (
                <p className="text-2xl font-bold" data-testid="text-total-points">{totalRewardPoints}</p>
              )}
            </div>
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Categories</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {CATEGORIES.map((cat) => {
            const Icon = categoryIcons[cat as Category];
            const count = categoryCounts[cat];
            return (
              <Link key={cat} href={`/category/${cat}`}>
                <Card className="p-4 hover-elevate cursor-pointer" data-testid={`card-category-${cat}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{CATEGORY_LABELS[cat as Category]}</p>
                        {isLoading ? (
                          <Skeleton className="h-4 w-12 mt-1" />
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {count} {count === 1 ? "listing" : "listings"}
                          </p>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {!isLoading && listings && listings.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Recently Added</h2>
          <div className="space-y-2">
            {listings.slice(-5).reverse().map((listing) => {
              const Icon = categoryIcons[listing.category as Category];
              return (
                <Card key={listing.id} className="p-3" data-testid={`card-recent-${listing.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 shrink-0">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{listing.name}</p>
                      <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[listing.category as Category]}</p>
                    </div>
                    <Badge variant="secondary">{listing.subInterest}</Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

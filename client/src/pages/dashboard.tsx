import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { CATEGORIES, CATEGORY_LABELS, type Category, type Listing, type Event } from "@shared/schema";
import { categoryIcons } from "@/lib/category-config";
import { ArrowRight, Layers, TrendingUp, Calendar } from "lucide-react";

export default function Dashboard() {
  const { data: listings, isLoading } = useQuery<Listing[]>({
    queryKey: ["/api/listings"],
  });

  const { data: events, isLoading: isLoadingEvents } = useQuery<Event[]>({
    queryKey: ["/api/events"],
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
    <div className="p-6 md:p-8 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-1" data-testid="text-dashboard-label">Admin Overview</p>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight uppercase" data-testid="text-dashboard-title">Dashboard</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-0 overflow-hidden">
          <div className="flex">
            <div className="w-1.5 bg-primary shrink-0"></div>
            <div className="p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Total Listings</p>
              {isLoading ? (
                <Skeleton className="h-10 w-20 mt-2" />
              ) : (
                <p className="text-4xl font-black mt-1" data-testid="text-total-listings">{totalListings}</p>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="flex">
            <div className="w-1.5 bg-foreground shrink-0"></div>
            <div className="p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Events</p>
              {isLoadingEvents ? (
                <Skeleton className="h-10 w-20 mt-2" />
              ) : (
                <p className="text-4xl font-black mt-1" data-testid="text-total-events">{events?.length ?? 0}</p>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="flex">
            <div className="w-1.5 bg-foreground shrink-0"></div>
            <div className="p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Categories</p>
              <p className="text-4xl font-black mt-1" data-testid="text-total-categories">{CATEGORIES.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="flex">
            <div className="w-1.5 bg-primary shrink-0"></div>
            <div className="p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Reward Points</p>
              {isLoading ? (
                <Skeleton className="h-10 w-20 mt-2" />
              ) : (
                <p className="text-4xl font-black mt-1" data-testid="text-total-points">{totalRewardPoints.toLocaleString()}</p>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-6 bg-primary rounded-sm"></div>
          <h2 className="text-lg font-extrabold uppercase tracking-wide">Categories</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CATEGORIES.map((cat) => {
            const Icon = categoryIcons[cat as Category];
            const count = categoryCounts[cat];
            return (
              <Link key={cat} href={`/category/${cat}`}>
                <Card className="p-4 hover-elevate cursor-pointer group" data-testid={`card-category-${cat}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-bold text-sm uppercase tracking-wide">{CATEGORY_LABELS[cat as Category]}</p>
                        {isLoading ? (
                          <Skeleton className="h-3 w-12 mt-1" />
                        ) : (
                          <p className="text-xs text-muted-foreground font-medium">
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
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-6 bg-foreground rounded-sm"></div>
            <h2 className="text-lg font-extrabold uppercase tracking-wide">Recently Added</h2>
          </div>
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
                      <p className="font-bold text-sm truncate">{listing.name}</p>
                      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{CATEGORY_LABELS[listing.category as Category]}</p>
                    </div>
                    <Badge variant="secondary" className="font-semibold">{listing.subInterest}</Badge>
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

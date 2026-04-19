import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CATEGORY_LABELS, type Category } from "@shared/schema";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { format, parseISO } from "date-fns";

interface UsageData {
  totals: {
    requests: number;
    requests24h: number;
    requests7d: number;
    requests30d: number;
    uniqueIps30d: number;
    avgDurationMs: number;
    errorRate: number;
  };
  requestsByDay: { day: string; count: number }[];
  requestsByRoute: { routeKey: string; count: number; avgDurationMs: number }[];
  topListings: { listingId: number; name: string; category: string; views: number }[];
  topEvents: { eventId: number; name: string; eventCategory: string; views: number }[];
  topSearches: { query: string; count: number }[];
  topCategoriesQueried: { category: string; count: number }[];
  topEventCategoriesQueried: { eventCategory: string; count: number }[];
  nearbyHotspots: { lat: number; lng: number; count: number }[];
  hasData: boolean;
}

interface AnalyticsData {
  totals: {
    listings: number;
    events: number;
    upcomingEvents: number;
    pastEvents: number;
    freeEvents: number;
    paidEvents: number;
    listingRewardPoints: number;
    eventRewardPoints: number;
    avgListingRewardPoints: number;
    avgEventRewardPoints: number;
  };
  listingsByCategory: { category: string; count: number; rewardTotal: number; rewardAvg: number }[];
  eventsByCategory: { category: string; count: number }[];
  dataQuality: {
    listingsTotal: number;
    missingWebsite: number;
    missingPhone: number;
    missingCoordinates: number;
    missingFeaturedImage: number;
    missingGallery: number;
    shortDescription: number;
  };
  geographic: { trinidad: number; tobago: number; unknown: number };
  topRewardListings: { id: number; name: string; category: string; rewardPoints: number }[];
  topRewardEvents: { id: number; name: string; eventCategory: string; rewardPoints: number; startDateTime: string }[];
  listingsCreatedByMonth: { month: string; count: number }[];
  eventsCreatedByMonth: { month: string; count: number }[];
  upcomingEventsByWeek: { weekStart: string; count: number }[];
  topOrganizers: { name: string; count: number }[];
}

const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--foreground))", "#888", "#bbb", "#ddd"];

function StatCard({ label, value, accent = "primary" }: { label: string; value: string | number; accent?: "primary" | "foreground" }) {
  const bar = accent === "primary" ? "bg-primary" : "bg-foreground";
  const testid = `stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex">
        <div className={`w-1.5 ${bar} shrink-0`} />
        <div className="p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
          <p className="text-3xl font-black mt-1" data-testid={testid}>
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
        </div>
      </div>
    </Card>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1 h-6 bg-primary rounded-sm" />
      <h2 className="text-lg font-extrabold uppercase tracking-wide">{title}</h2>
    </div>
  );
}

function QualityRow({ label, missing, total }: { label: string; missing: number; total: number }) {
  const complete = total - missing;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
  return (
    <div className="space-y-1.5" data-testid={`quality-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-muted-foreground font-medium">
          {complete} / {total} ({pct}%)
        </span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

export default function AnalyticsPage() {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/analytics"],
  });
  const { data: usage } = useQuery<UsageData>({
    queryKey: ["/api/analytics/usage"],
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 md:p-8 space-y-8 max-w-6xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const monthData = data.listingsCreatedByMonth.map((m, i) => ({
    month: format(parseISO(`${m.month}-01`), "MMM"),
    listings: m.count,
    events: data.eventsCreatedByMonth[i]?.count ?? 0,
  }));

  const upcomingData = data.upcomingEventsByWeek.map((w) => ({
    week: format(parseISO(w.weekStart), "MMM d"),
    events: w.count,
  }));

  const listingCatData = data.listingsByCategory.map((c) => ({
    category: CATEGORY_LABELS[c.category as Category] ?? c.category,
    count: c.count,
    avg: c.rewardAvg,
  }));

  const eventCatData = data.eventsByCategory.map((c) => ({ name: c.category, value: c.count }));

  const geoData = [
    { name: "Trinidad", value: data.geographic.trinidad },
    { name: "Tobago", value: data.geographic.tobago },
    { name: "No coords", value: data.geographic.unknown },
  ].filter((d) => d.value > 0);

  const freePaidData = [
    { name: "Free", value: data.totals.freeEvents },
    { name: "Paid", value: data.totals.paidEvents },
  ].filter((d) => d.value > 0);

  return (
    <div className="p-6 md:p-8 space-y-10 max-w-6xl mx-auto">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-1">Insights</p>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight uppercase" data-testid="text-analytics-title">
          Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-2 font-medium">
          Content inventory, reward economy and calendar density across all categories.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Listings" value={data.totals.listings} />
        <StatCard label="Events" value={data.totals.events} accent="foreground" />
        <StatCard label="Upcoming Events" value={data.totals.upcomingEvents} />
        <StatCard label="Past Events" value={data.totals.pastEvents} accent="foreground" />
        <StatCard label="Listing Points" value={data.totals.listingRewardPoints} accent="foreground" />
        <StatCard label="Event Points" value={data.totals.eventRewardPoints} />
        <StatCard label="Avg Listing Pts" value={data.totals.avgListingRewardPoints} accent="foreground" />
        <StatCard label="Avg Event Pts" value={data.totals.avgEventRewardPoints} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <SectionHeader title="Content Created (12 months)" />
          <div className="h-72" data-testid="chart-content-created">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="listings" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="events" stroke="hsl(var(--foreground))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Upcoming Events (next 12 weeks)" />
          <div className="h-72" data-testid="chart-upcoming-weeks">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={upcomingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="events" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <SectionHeader title="Listings by Category" />
        <div className="h-80" data-testid="chart-listings-by-category">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={listingCatData} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
              <YAxis type="category" dataKey="category" stroke="hsl(var(--muted-foreground))" fontSize={12} width={110} />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-5">
          <SectionHeader title="Events by Category" />
          {eventCatData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="h-64" data-testid="chart-events-category">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={eventCatData} dataKey="value" nameKey="name" outerRadius={80} label={(e: any) => e.name}>
                    {eventCatData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeader title="Geographic Coverage" />
          {geoData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No listings yet.</p>
          ) : (
            <div className="h-64" data-testid="chart-geographic">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={geoData} dataKey="value" nameKey="name" outerRadius={80} label={(e: any) => `${e.name}: ${e.value}`}>
                    {geoData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeader title="Free vs Paid Events" />
          {freePaidData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="h-64" data-testid="chart-free-paid">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={freePaidData} dataKey="value" nameKey="name" outerRadius={80} label={(e: any) => `${e.name}: ${e.value}`}>
                    {freePaidData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <SectionHeader title="Listing Data Quality" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <QualityRow label="Has Website" missing={data.dataQuality.missingWebsite} total={data.dataQuality.listingsTotal} />
          <QualityRow label="Has Phone" missing={data.dataQuality.missingPhone} total={data.dataQuality.listingsTotal} />
          <QualityRow label="Has Coordinates" missing={data.dataQuality.missingCoordinates} total={data.dataQuality.listingsTotal} />
          <QualityRow label="Has Featured Image" missing={data.dataQuality.missingFeaturedImage} total={data.dataQuality.listingsTotal} />
          <QualityRow label="Has Gallery" missing={data.dataQuality.missingGallery} total={data.dataQuality.listingsTotal} />
          <QualityRow label="Description ≥80 chars" missing={data.dataQuality.shortDescription} total={data.dataQuality.listingsTotal} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <SectionHeader title="Top Reward Listings" />
          {data.topRewardListings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No listings yet.</p>
          ) : (
            <div className="space-y-2">
              {data.topRewardListings.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-3 p-2 rounded-md border"
                  data-testid={`top-listing-${l.id}`}
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{l.name}</p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      {CATEGORY_LABELS[l.category as Category] ?? l.category}
                    </p>
                  </div>
                  <Badge variant="secondary" className="font-bold shrink-0">
                    {l.rewardPoints} pts
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeader title="Top Reward Events" />
          {data.topRewardEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="space-y-2">
              {data.topRewardEvents.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 p-2 rounded-md border"
                  data-testid={`top-event-${e.id}`}
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{e.name}</p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      {e.eventCategory} · {format(new Date(e.startDateTime), "MMM d, yyyy")}
                    </p>
                  </div>
                  <Badge variant="secondary" className="font-bold shrink-0">
                    {e.rewardPoints} pts
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <SectionHeader title="Top Organizers" />
        {data.topOrganizers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No organizers recorded yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.topOrganizers.map((o) => (
              <div
                key={o.name}
                className="flex items-center justify-between gap-3 p-2 rounded-md border"
                data-testid={`organizer-${o.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
              >
                <p className="font-bold text-sm truncate">{o.name}</p>
                <Badge variant="secondary" className="font-bold shrink-0">
                  {o.count} {o.count === 1 ? "event" : "events"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="pt-4 border-t-2 border-foreground/10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-1">Mobile App</p>
        <h2 className="text-2xl md:text-3xl font-black tracking-tight uppercase" data-testid="text-usage-title">
          API Usage
        </h2>
        <p className="text-sm text-muted-foreground mt-2 font-medium">
          Live traffic from the public API. Logging began when this feature was deployed.
        </p>
      </div>

      {!usage || !usage.hasData ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-muted-foreground" data-testid="text-no-usage-data">
            No public API requests recorded yet. Once the mobile app starts hitting the public endpoints,
            traffic and popularity stats will appear here.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Requests 24h" value={usage.totals.requests24h} />
            <StatCard label="Requests 7d" value={usage.totals.requests7d} accent="foreground" />
            <StatCard label="Requests 30d" value={usage.totals.requests30d} />
            <StatCard label="Total Requests" value={usage.totals.requests} accent="foreground" />
            <StatCard label="Unique IPs 30d" value={usage.totals.uniqueIps30d} accent="foreground" />
            <StatCard label="Avg Response" value={`${usage.totals.avgDurationMs} ms`} />
            <StatCard label="Error Rate" value={`${usage.totals.errorRate}%`} accent="foreground" />
            <StatCard label="Active Routes" value={usage.requestsByRoute.length} />
          </div>

          <Card className="p-5">
            <SectionHeader title="Requests Per Day (last 30 days)" />
            <div className="h-72" data-testid="chart-requests-per-day">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usage.requestsByDay.map((d) => ({ ...d, label: format(parseISO(d.day), "MMM d") }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Top Routes" />
            <div className="space-y-2">
              {usage.requestsByRoute.map((r) => (
                <div
                  key={r.routeKey}
                  className="flex items-center justify-between gap-3 p-2 rounded-md border"
                  data-testid={`route-${r.routeKey.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                >
                  <code className="text-xs font-mono truncate">{r.routeKey}</code>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px] font-semibold">
                      {r.avgDurationMs} ms
                    </Badge>
                    <Badge variant="secondary" className="font-bold">
                      {r.count.toLocaleString()}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5">
              <SectionHeader title="Most Viewed Listings" />
              {usage.topListings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No listing detail views yet.</p>
              ) : (
                <div className="space-y-2">
                  {usage.topListings.map((l) => (
                    <div
                      key={l.listingId}
                      className="flex items-center justify-between gap-3 p-2 rounded-md border"
                      data-testid={`viewed-listing-${l.listingId}`}
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{l.name}</p>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                          {CATEGORY_LABELS[l.category as Category] ?? l.category}
                        </p>
                      </div>
                      <Badge variant="secondary" className="font-bold shrink-0">
                        {l.views.toLocaleString()} views
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <SectionHeader title="Most Viewed Events" />
              {usage.topEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No event detail views yet.</p>
              ) : (
                <div className="space-y-2">
                  {usage.topEvents.map((e) => (
                    <div
                      key={e.eventId}
                      className="flex items-center justify-between gap-3 p-2 rounded-md border"
                      data-testid={`viewed-event-${e.eventId}`}
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{e.name}</p>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                          {e.eventCategory}
                        </p>
                      </div>
                      <Badge variant="secondary" className="font-bold shrink-0">
                        {e.views.toLocaleString()} views
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="p-5">
              <SectionHeader title="Top Searches" />
              {usage.topSearches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No search queries yet.</p>
              ) : (
                <div className="space-y-2">
                  {usage.topSearches.map((s) => (
                    <div
                      key={s.query}
                      className="flex items-center justify-between gap-3 p-2 rounded-md border"
                      data-testid={`search-${s.query.replace(/[^a-z0-9]+/gi, "-")}`}
                    >
                      <p className="font-semibold text-sm truncate">"{s.query}"</p>
                      <Badge variant="secondary" className="font-bold shrink-0">
                        {s.count}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <SectionHeader title="Popular Categories" />
              {usage.topCategoriesQueried.length === 0 ? (
                <p className="text-sm text-muted-foreground">No category filters used yet.</p>
              ) : (
                <div className="space-y-2">
                  {usage.topCategoriesQueried.map((c) => (
                    <div
                      key={c.category}
                      className="flex items-center justify-between gap-3 p-2 rounded-md border"
                      data-testid={`queried-category-${c.category}`}
                    >
                      <p className="font-semibold text-sm truncate uppercase tracking-wide">
                        {CATEGORY_LABELS[c.category as Category] ?? c.category}
                      </p>
                      <Badge variant="secondary" className="font-bold shrink-0">
                        {c.count}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <SectionHeader title="Popular Event Categories" />
              {usage.topEventCategoriesQueried.length === 0 ? (
                <p className="text-sm text-muted-foreground">No event category filters yet.</p>
              ) : (
                <div className="space-y-2">
                  {usage.topEventCategoriesQueried.map((c) => (
                    <div
                      key={c.eventCategory}
                      className="flex items-center justify-between gap-3 p-2 rounded-md border"
                      data-testid={`queried-event-category-${c.eventCategory.replace(/[^a-z0-9]+/gi, "-")}`}
                    >
                      <p className="font-semibold text-sm truncate">{c.eventCategory}</p>
                      <Badge variant="secondary" className="font-bold shrink-0">
                        {c.count}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <SectionHeader title="Nearby Search Hotspots" />
            {usage.nearbyHotspots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No nearby searches recorded yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {usage.nearbyHotspots.map((h) => (
                  <div
                    key={`${h.lat}-${h.lng}`}
                    className="flex items-center justify-between gap-3 p-2 rounded-md border"
                    data-testid={`hotspot-${h.lat}-${h.lng}`}
                  >
                    <code className="text-xs font-mono">
                      {h.lat.toFixed(2)}, {h.lng.toFixed(2)}
                    </code>
                    <Badge variant="secondary" className="font-bold shrink-0">
                      {h.count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

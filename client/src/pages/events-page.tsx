import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { type Event } from "@shared/schema";
import { type DateRange } from "react-day-picker";
import { EventCard } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Plus, Search, Calendar as CalendarIcon, Sparkles, Loader2, Globe } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function EventsPage() {
  const [, navigate] = useLocation();
  const [deleteEvent, setDeleteEvent] = useState<Event | null>(null);
  const [search, setSearch] = useState("");
  const [showPopulate, setShowPopulate] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + 7);
    return { from, to };
  });
  const { toast } = useToast();

  const { data: events, isLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      setDeleteEvent(null);
      toast({ title: "Event deleted successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const populateMutation = useMutation({
    mutationFn: async (range: { startDate: string; endDate: string }) => {
      const res = await apiRequest("POST", "/api/events/populate", range);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      setShowPopulate(false);
      if (data.created === 0) {
        toast({
          title: "No events could be created",
          description: "The web search found events but none could be saved. Please try again.",
          variant: "destructive",
        });
      } else if (data.errors?.length > 0) {
        toast({
          title: `${data.created} of ${data.total} events added`,
          description: `Some events could not be created. ${data.created} were successfully added.`,
        });
      } else {
        toast({
          title: `${data.created} events added`,
          description: `Found and created ${data.created} real events from the web.`,
        });
      }
    },
    onError: (err: Error) => {
      setShowPopulate(false);
      toast({ title: "Population failed", description: err.message, variant: "destructive" });
    },
  });

  const handlePopulate = () => {
    if (!dateRange?.from || !dateRange?.to) {
      toast({ title: "Select a date range", description: "Pick a start and end date on the calendar.", variant: "destructive" });
      return;
    }
    populateMutation.mutate({
      startDate: dateRange.from.toISOString(),
      endDate: dateRange.to.toISOString(),
    });
  };

  const filteredEvents = events?.filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase()) ||
      e.eventCategory.toLowerCase().includes(search.toLowerCase()),
  );

  const formatDateShort = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary">
            <CalendarIcon className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Events</p>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight uppercase" data-testid="text-events-title">Event Calendar</h1>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              {isLoading ? "Loading..." : `${events?.length ?? 0} events`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setShowPopulate(true)}
            data-testid="button-populate-events"
            className="font-bold uppercase tracking-wide"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Populate with AI
          </Button>
          <Button onClick={() => navigate("/events/new")} data-testid="button-add-event" className="font-bold uppercase tracking-wide">
            <Plus className="h-4 w-4 mr-2" />
            Add Event
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search events..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 font-medium"
          data-testid="input-search-events"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : filteredEvents && filteredEvents.length > 0 ? (
        <div className="space-y-3">
          {filteredEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onEdit={() => navigate(`/events/edit/${event.id}`)}
              onDelete={() => setDeleteEvent(event)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CalendarIcon className="h-16 w-16 text-muted-foreground/20 mb-4" />
          <h3 className="font-extrabold text-lg uppercase tracking-wide text-muted-foreground">No events yet</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 font-medium">
            Add your first event or populate from the web.
          </p>
          <div className="flex items-center gap-2 mt-6">
            <Button
              variant="outline"
              onClick={() => setShowPopulate(true)}
              className="font-bold uppercase tracking-wide"
              data-testid="button-populate-first-events"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Populate with AI
            </Button>
            <Button className="font-bold uppercase tracking-wide" onClick={() => navigate("/events/new")} data-testid="button-add-first-event">
              <Plus className="h-4 w-4 mr-2" />
              Add Event
            </Button>
          </div>
        </div>
      )}

      <Dialog open={showPopulate} onOpenChange={(open) => { if (!populateMutation.isPending) setShowPopulate(open); }}>
        <DialogContent className="sm:max-w-fit">
          <DialogHeader>
            <DialogTitle className="font-black uppercase tracking-wide flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Populate Events from Web
            </DialogTitle>
            <DialogDescription className="text-sm">
              Select a date range to search for real upcoming events in Trinidad & Tobago.
            </DialogDescription>
          </DialogHeader>

          {populateMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-bold uppercase tracking-wide text-sm">Searching the web...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Finding real events, fetching images, and creating entries. This may take a minute.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-center">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                  disabled={{ before: new Date() }}
                  data-testid="calendar-date-range"
                />
              </div>

              {dateRange?.from && dateRange?.to && (
                <p className="text-center text-sm font-medium text-muted-foreground" data-testid="text-selected-range">
                  {formatDateShort(dateRange.from)} — {formatDateShort(dateRange.to)}
                </p>
              )}

              <DialogFooter className="flex-col gap-2 sm:flex-col">
                <Button
                  onClick={handlePopulate}
                  disabled={!dateRange?.from || !dateRange?.to}
                  className="w-full font-bold uppercase tracking-wide"
                  data-testid="button-populate-search"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Search & Populate Events
                </Button>
                <p className="text-[10px] text-muted-foreground/60 font-medium text-center">
                  Powered by Perplexity AI web search
                </p>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteEvent} onOpenChange={() => setDeleteEvent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-black uppercase">Delete "{deleteEvent?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently remove the event from the system and the mobile app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-event">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteEvent && deleteMutation.mutate(deleteEvent.id)}
              className="bg-destructive text-destructive-foreground font-bold uppercase"
              data-testid="button-confirm-delete-event"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

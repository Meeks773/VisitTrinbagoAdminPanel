import { useMutation, useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { type Event } from "@shared/schema";
import { EventForm } from "@/components/event-form";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";

export default function EventFormPage() {
  const [, paramsNew] = useRoute("/events/new");
  const [, paramsEdit] = useRoute("/events/edit/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [animateIn, setAnimateIn] = useState(false);

  const editId = paramsEdit?.id ? Number(paramsEdit.id) : null;
  const isEdit = editId !== null;

  useEffect(() => {
    requestAnimationFrame(() => setAnimateIn(true));
  }, []);

  const { data: event, isLoading: isLoadingEvent } = useQuery<Event>({
    queryKey: ["/api/events", editId],
    queryFn: async () => {
      const res = await fetch(`/api/events/${editId}`);
      if (!res.ok) throw new Error("Failed to load event");
      return res.json();
    },
    enabled: isEdit,
  });

  const invalidateAndGoBack = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    setAnimateIn(false);
    setTimeout(() => navigate("/events"), 200);
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/events", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Event created successfully" });
      invalidateAndGoBack();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/events/${editId}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Event updated successfully" });
      invalidateAndGoBack();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleBack = () => {
    setAnimateIn(false);
    setTimeout(() => navigate("/events"), 200);
  };

  if (isEdit && isLoadingEvent) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-muted-foreground font-semibold">Loading event...</p>
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
          <Button variant="ghost" onClick={handleBack} data-testid="button-back-events" className="mb-4 -ml-2 font-semibold uppercase tracking-wide text-muted-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Events
          </Button>

          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary">
              <Calendar className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
                {isEdit ? "Edit Event" : "New Event"}
              </p>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight uppercase" data-testid="text-event-form-title">
                {isEdit ? event?.name || "Edit" : "Add Event"}
              </h1>
            </div>
          </div>
        </div>

        <EventForm
          key={isEdit ? editId : "new"}
          event={isEdit ? event : undefined}
          onSubmit={(data) => isEdit ? updateMutation.mutate(data) : createMutation.mutate(data)}
          isPending={isEdit ? updateMutation.isPending : createMutation.isPending}
        />
      </div>
    </div>
  );
}

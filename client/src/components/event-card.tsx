import { type Event } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Star, Pencil, Trash2, Calendar, Clock, ImageIcon } from "lucide-react";

interface EventCardProps {
  event: Event;
  onEdit: () => void;
  onDelete: () => void;
}

function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-TT", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export function EventCard({ event, onEdit, onDelete }: EventCardProps) {
  const imageCount = (event.galleryImages?.length || 0) + (event.featuredImage ? 1 : 0);

  return (
    <Card className="overflow-visible hover-elevate" data-testid={`card-event-${event.id}`}>
      <div className="flex">
        {event.featuredImage ? (
          <div className="w-32 shrink-0 overflow-hidden rounded-l-md">
            <img
              src={event.featuredImage}
              alt={event.name}
              className="w-full h-full object-cover min-h-[7rem]"
              data-testid={`img-event-${event.id}`}
            />
          </div>
        ) : null}
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10 shrink-0">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-sm uppercase tracking-wide truncate" data-testid={`text-event-name-${event.id}`}>
                    {event.name}
                  </h3>
                  <Badge variant="secondary" className="shrink-0 font-semibold text-[10px] uppercase tracking-wider">
                    {event.eventCategory}
                  </Badge>
                  {event.isFreeEvent && (
                    <Badge variant="outline" className="shrink-0 font-semibold text-[10px] uppercase tracking-wider">
                      Free
                    </Badge>
                  )}
                  {imageCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                      <ImageIcon className="h-3 w-3" />
                      {imageCount}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2" data-testid={`text-event-desc-${event.id}`}>
                  {event.description}
                </p>
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
                    <Clock className="h-3 w-3" />
                    {formatDateTime(event.startDateTime)}
                  </span>
                  {event.location && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
                      <MapPin className="h-3 w-3" />
                      {event.location}
                    </span>
                  )}
                  {event.rewardPoints != null && event.rewardPoints > 0 && (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-primary">
                      <Star className="h-3 w-3" />
                      {event.rewardPoints} pts
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="icon" variant="ghost" onClick={onEdit} data-testid={`button-edit-event-${event.id}`}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onDelete} data-testid={`button-delete-event-${event.id}`}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

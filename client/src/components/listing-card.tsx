import { type Listing, type Category, CATEGORY_LABELS } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Star, Pencil, Trash2, ExternalLink, ImageIcon } from "lucide-react";
import { categoryIcons } from "@/lib/category-config";

interface ListingCardProps {
  listing: Listing;
  onEdit: () => void;
  onDelete: () => void;
}

export function ListingCard({ listing, onEdit, onDelete }: ListingCardProps) {
  const Icon = categoryIcons[listing.category as Category];
  const imageCount = (listing.galleryImages?.length || 0) + (listing.featuredImage ? 1 : 0);

  return (
    <Card className="overflow-visible hover-elevate" data-testid={`card-listing-${listing.id}`}>
      <div className="flex">
        {listing.featuredImage ? (
          <div className="w-28 h-28 shrink-0 overflow-hidden rounded-l-md">
            <img
              src={listing.featuredImage}
              alt={listing.name}
              className="w-full h-full object-cover"
              data-testid={`img-listing-${listing.id}`}
            />
          </div>
        ) : null}
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10 shrink-0">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold truncate" data-testid={`text-listing-name-${listing.id}`}>
                    {listing.name}
                  </h3>
                  <Badge variant="secondary" className="shrink-0">
                    {listing.subInterest}
                  </Badge>
                  {imageCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ImageIcon className="h-3 w-3" />
                      {imageCount}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2" data-testid={`text-listing-desc-${listing.id}`}>
                  {listing.description}
                </p>
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  {listing.location && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {listing.location}
                    </span>
                  )}
                  {listing.rewardPoints != null && listing.rewardPoints > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Star className="h-3 w-3" />
                      {listing.rewardPoints} pts
                    </span>
                  )}
                  {listing.website && (
                    <a
                      href={listing.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Website
                    </a>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="icon" variant="ghost" onClick={onEdit} data-testid={`button-edit-${listing.id}`}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onDelete} data-testid={`button-delete-${listing.id}`}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

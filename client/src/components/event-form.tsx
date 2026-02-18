import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type Event, EVENT_CATEGORIES } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TagInput } from "@/components/tag-input";
import { Card } from "@/components/ui/card";
import { ImageUpload, GalleryUpload } from "@/components/image-upload";
import { Save, Loader2, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EventFormProps {
  event?: Event;
  onSubmit: (data: any) => void;
  isPending?: boolean;
}

const eventFormSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  eventCategory: z.string().min(1, "Event category is required"),
  interest: z.string().min(1, "Interest is required"),
  subInterest: z.string().min(1, "Sub-interest is required"),
  description: z.string().min(1, "Description is required"),
  startDateTime: z.string().min(1, "Start date & time is required"),
  endDateTime: z.string().min(1, "End date & time is required"),
  location: z.string().optional().default(""),
  latitude: z.coerce.number().optional().default(0),
  longitude: z.coerce.number().optional().default(0),
  isFreeEvent: z.boolean().default(true),
  website: z.string().optional().default(""),
  bookingUrl: z.string().optional().default(""),
  organizerName: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  email: z.string().optional().default(""),
  dressCode: z.string().optional().default(""),
  rewardPoints: z.coerce.number().optional().default(0),
});

function getDefaults(event?: Event) {
  return {
    name: event?.name ?? "",
    eventCategory: event?.eventCategory ?? "",
    interest: event?.interest ?? "",
    subInterest: event?.subInterest ?? "",
    description: event?.description ?? "",
    startDateTime: event?.startDateTime ?? "",
    endDateTime: event?.endDateTime ?? "",
    location: event?.location ?? "",
    latitude: event?.latitude ?? 0,
    longitude: event?.longitude ?? 0,
    isFreeEvent: event?.isFreeEvent ?? true,
    website: event?.website ?? "",
    bookingUrl: event?.bookingUrl ?? "",
    organizerName: event?.organizerName ?? "",
    phone: event?.phone ?? "",
    email: event?.email ?? "",
    dressCode: event?.dressCode ?? "",
    rewardPoints: event?.rewardPoints ?? 0,
  };
}

export function EventForm({ event, onSubmit, isPending }: EventFormProps) {
  const { toast } = useToast();
  const [featuredImage, setFeaturedImage] = useState<string | null>(event?.featuredImage || null);
  const [galleryImages, setGalleryImages] = useState<string[]>(event?.galleryImages || []);
  const [videoUrls, setVideoUrls] = useState<string[]>(event?.videoUrls || []);
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm({
    resolver: zodResolver(eventFormSchema),
    defaultValues: getDefaults(event),
  });

  const handleAiGenerate = async () => {
    const name = form.getValues("name");
    const eventCategory = form.getValues("eventCategory");
    if (!name || name.trim().length < 2) {
      toast({
        title: "Enter an event name first",
        description: "Type the name of the event, then click AI Generate to fill in the rest.",
        variant: "destructive",
      });
      return;
    }
    if (!eventCategory) {
      toast({
        title: "Select an event category first",
        description: "Choose a category, then click AI Generate.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const res = await apiRequest("POST", "/api/ai/generate-event", {
        name: name.trim(),
        eventCategory,
      });
      const generated = await res.json();

      const fieldsToSet = [
        "interest", "subInterest", "description", "startDateTime", "endDateTime",
        "location", "latitude", "longitude", "isFreeEvent", "website", "bookingUrl",
        "organizerName", "phone", "email", "dressCode", "rewardPoints",
      ] as const;

      for (const key of fieldsToSet) {
        const value = generated[key];
        if (value !== undefined && value !== null) {
          if (key === "latitude" || key === "longitude" || key === "rewardPoints") {
            form.setValue(key, Number(value) || 0, { shouldDirty: true });
          } else if (key === "isFreeEvent") {
            form.setValue(key, Boolean(value), { shouldDirty: true });
          } else {
            form.setValue(key, String(value), { shouldDirty: true });
          }
        }
      }

      if (generated.featuredImage) setFeaturedImage(generated.featuredImage);
      if (generated.galleryImages?.length > 0) setGalleryImages(generated.galleryImages);

      toast({
        title: "Event content generated",
        description: "AI has filled in all fields. Review and edit as needed before saving.",
      });
    } catch (err: any) {
      toast({
        title: "Generation failed",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = (values: Record<string, any>) => {
    onSubmit({
      ...values,
      latitude: values.latitude || null,
      longitude: values.longitude || null,
      featuredImage: featuredImage || null,
      galleryImages: galleryImages.length > 0 ? galleryImages : [],
      videoUrls: videoUrls.length > 0 ? videoUrls : [],
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">AI Content Generator</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Enter the event name..." data-testid="input-event-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="eventCategory"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Category</FormLabel>
                  <FormControl>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <SelectTrigger data-testid="select-event-category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat} data-testid={`option-category-${cat}`}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <Button
            type="button"
            variant="default"
            onClick={handleAiGenerate}
            disabled={isGenerating}
            className="w-full md:w-auto"
            data-testid="button-ai-generate-event"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            <span className="font-bold uppercase tracking-wide">
              {isGenerating ? "Generating..." : "AI Generate"}
            </span>
          </Button>
          <p className="text-xs text-muted-foreground">
            Enter name and category above, then click AI Generate to auto-fill all fields with event content.
          </p>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Images</h3>
          <ImageUpload
            value={featuredImage}
            onChange={setFeaturedImage}
            label="Featured Image"
            data-testid="upload-event-featured"
          />
          <GalleryUpload
            value={galleryImages}
            onChange={setGalleryImages}
            label="Gallery Images"
            data-testid="upload-event-gallery"
          />
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="interest"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Interest</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Entertainment, Culture" data-testid="input-interest" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="subInterest"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sub Interest</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Live Band, DJ Set" data-testid="input-sub-interest" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="md:col-span-2">
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Describe the event..." className="min-h-[120px]" data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Date & Time</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="startDateTime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Date & Time</FormLabel>
                  <FormControl>
                    <Input {...field} type="datetime-local" data-testid="input-start-datetime" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="endDateTime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>End Date & Time</FormLabel>
                  <FormControl>
                    <Input {...field} type="datetime-local" data-testid="input-end-datetime" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Location</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Venue name and address" data-testid="input-location" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="latitude"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Latitude</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" step="any" placeholder="e.g. 10.6549" data-testid="input-latitude" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="longitude"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Longitude</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" step="any" placeholder="e.g. -61.5019" data-testid="input-longitude" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="isFreeEvent"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-free-event"
                    />
                  </FormControl>
                  <FormLabel className="cursor-pointer">This is a free event</FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Links & Media</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="website"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website URL</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="https://..." data-testid="input-website" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bookingUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Booking URL</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="https://..." data-testid="input-booking-url" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Video URLs</label>
            <TagInput
              value={videoUrls}
              onChange={setVideoUrls}
              placeholder="Add video URL and press Enter"
              data-testid="input-video-urls"
            />
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Organizer Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="organizerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organizer Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Organization or person name" data-testid="input-organizer" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="+1 (868) 555-0000" data-testid="input-phone" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="events@example.com" data-testid="input-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dressCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dress Code</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Smart Casual" data-testid="input-dress-code" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Rewards</h3>
          <FormField
            control={form.control}
            name="rewardPoints"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Set Reward Points</FormLabel>
                <FormControl>
                  <Input {...field} type="number" placeholder="0" data-testid="input-reward-points" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-submit-event">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            <span className="font-bold uppercase tracking-wide">{event ? "Update Event" : "Create Event"}</span>
          </Button>
        </div>
      </form>
    </Form>
  );
}

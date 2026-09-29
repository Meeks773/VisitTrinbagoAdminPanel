import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type Category, type Listing } from "@shared/schema";
import { categoryFields, type FieldConfig } from "@/lib/category-config";
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

interface ListingFormProps {
  category: Category;
  listing?: Listing;
  onSubmit: (data: any) => void;
  onSubmitPublish?: (data: any) => void;
  isPending?: boolean;
}

// Empty optional numbers must not be coerced to zero (particularly coordinates).
export function optionalNumber(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Enter a valid number");
  return number;
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string");
  if (typeof value === "string") return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function buildFormSchema(fields: FieldConfig[], isDraft = false) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (field.type === "checkbox") {
      shape[field.key] = z.boolean().default(false);
    } else if (field.type === "number") {
      shape[field.key] = field.key === "rewardPoints"
        ? z.preprocess((value) => value === "" || value == null ? 0 : value, z.coerce.number().finite())
        : z.preprocess((value) => value === "" || value == null ? null : value, z.coerce.number().finite().nullable());
    } else if (field.type === "tags") {
      shape[field.key] = z.array(z.string()).default([]);
    } else {
      if (!isDraft && (field.key === "name" || field.key === "description" || field.key === "interest" || field.key === "subInterest")) {
        shape[field.key] = z.string().min(1, `${field.label} is required`);
      } else {
        shape[field.key] = z.string().optional().default("");
      }
    }
  }
  return z.object(shape);
}

function getDefaultValues(fields: FieldConfig[], listing?: Listing) {
  const defaults: Record<string, any> = {};
  for (const field of fields) {
    const isCommon = !field.isMetadata;
    const value = listing
      ? isCommon
        ? (listing as any)[field.key]
        : listing.metadata?.[field.key]
      : undefined;

    if (field.type === "checkbox") {
      defaults[field.key] = value ?? false;
    } else if (field.type === "number") {
      defaults[field.key] = value ?? (field.key === "rewardPoints" ? 0 : "");
    } else if (field.type === "tags") {
      defaults[field.key] = normalizeTags(value);
    } else {
      defaults[field.key] = value ?? "";
    }
  }
  return defaults;
}

export function ListingForm({ category, listing, onSubmit, onSubmitPublish, isPending }: ListingFormProps) {
  const fields = categoryFields[category];
  const schema = buildFormSchema(fields, (listing as Listing & { status?: string } | undefined)?.status === "draft");
  const { toast } = useToast();

  const [featuredImage, setFeaturedImage] = useState<string | null>(listing?.featuredImage || null);
  const [galleryImages, setGalleryImages] = useState<string[]>(listing?.galleryImages || []);
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: getDefaultValues(fields, listing),
  });

  const handleAiGenerate = async () => {
    const name = form.getValues("name");
    if (!name || name.trim().length < 2) {
      toast({
        title: "Enter a name first",
        description: "Type the name of the place, then click AI Generate to fill in the rest.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const res = await apiRequest("POST", "/api/ai/generate-listing", {
        name: name.trim(),
        category,
      });
      const generated = await res.json();

      for (const field of fields) {
        if (field.key === "name") continue;

        let value;
        if (field.isMetadata) {
          value = generated.metadata?.[field.key];
        } else {
          value = generated[field.key];
        }

        if (value !== undefined && value !== null) {
          if (field.type === "number") {
            form.setValue(field.key, Number(value) || 0, { shouldDirty: true });
          } else if (field.type === "checkbox") {
            form.setValue(field.key, Boolean(value), { shouldDirty: true });
          } else if (field.type === "tags") {
            form.setValue(field.key, normalizeTags(value), { shouldDirty: true });
          } else {
            form.setValue(field.key, String(value), { shouldDirty: true });
          }
        }
      }

      if (generated.featuredImage) {
        setFeaturedImage(generated.featuredImage);
      }
      if (generated.galleryImages && Array.isArray(generated.galleryImages) && generated.galleryImages.length > 0) {
        setGalleryImages(generated.galleryImages);
      }

      const hasImages = generated.featuredImage || (generated.galleryImages && generated.galleryImages.length > 0);
      toast({
        title: "Content generated",
        description: hasImages
          ? "AI has filled in all fields including images. Review and edit as needed before saving."
          : "AI has filled in the fields. Review and edit as needed before saving.",
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

  const buildPayload = (values: Record<string, any>) => {
    const common: Record<string, any> = { category };
    const metadata: Record<string, any> = { ...(listing?.metadata ?? {}) };

    for (const field of fields) {
      if (field.isMetadata) {
        metadata[field.key] = field.type === "number" && field.key !== "rewardPoints" ? optionalNumber(values[field.key]) : values[field.key];
      } else {
        common[field.key] = field.type === "number" && field.key !== "rewardPoints" ? optionalNumber(values[field.key]) : values[field.key];
      }
    }

    return {
      ...common,
      metadata,
      featuredImage: featuredImage || null,
      galleryImages: galleryImages.length > 0 ? galleryImages : [],
    };
  };

  const commonFields = fields.filter((f) => !f.isMetadata);
  const metadataFields = fields.filter((f) => f.isMetadata);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => onSubmit(buildPayload(values)))} className="space-y-6">
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">AI Content Generator</h3>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter the name of the place..."
                        data-testid="input-name-ai"
                      />
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
              data-testid="button-ai-generate"
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
          </div>
          <p className="text-xs text-muted-foreground">
            Type the name above, then click AI Generate to auto-fill all fields with tourist-friendly content.
          </p>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Images</h3>
          <ImageUpload
            value={featuredImage}
            onChange={setFeaturedImage}
            label="Featured Image"
            data-testid="upload-featured-image"
          />
          <GalleryUpload
            value={galleryImages}
            onChange={setGalleryImages}
            label="Gallery Images"
            data-testid="upload-gallery-images"
          />
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {commonFields.filter((f) => f.key !== "name").map((fieldConfig) => (
              <div key={fieldConfig.key} className={fieldConfig.type === "textarea" ? "md:col-span-2" : ""}>
                <RenderField fieldConfig={fieldConfig} form={form} />
              </div>
            ))}
          </div>
        </Card>

        {metadataFields.length > 0 && (
          <Card className="p-4 space-y-4">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">Category Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {metadataFields.map((fieldConfig) => (
                <div key={fieldConfig.key} className={fieldConfig.type === "textarea" || fieldConfig.type === "tags" ? "md:col-span-2" : ""}>
                  <RenderField fieldConfig={fieldConfig} form={form} />
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="flex justify-end flex-wrap gap-2">
          {onSubmitPublish && <Button type="button" disabled={isPending} onClick={form.handleSubmit((values) => onSubmitPublish(buildPayload(values)))} data-testid="button-publish-listing">
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Publish reviewed listing
          </Button>}
          <Button type="submit" disabled={isPending} data-testid="button-submit-listing">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            <span className="font-bold uppercase tracking-wide">{listing?.status === "draft" ? "Save draft" : listing ? "Save Listing" : "Create Listing"}</span>
          </Button>
        </div>
      </form>
    </Form>
  );
}

function RenderField({ fieldConfig, form }: { fieldConfig: FieldConfig; form: any }) {
  const { key, label, type, placeholder, options } = fieldConfig;

  return (
    <FormField
      control={form.control}
      name={key}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {type === "textarea" ? (
              <Textarea {...field} placeholder={placeholder} data-testid={`input-${key}`} />
            ) : type === "checkbox" ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid={`checkbox-${key}`}
                />
                <span className="text-sm text-muted-foreground">Yes</span>
              </div>
            ) : type === "select" ? (
              <Select value={field.value || ""} onValueChange={field.onChange}>
                <SelectTrigger data-testid={`select-${key}`}>
                  <SelectValue placeholder={`Select ${label}`} />
                </SelectTrigger>
                <SelectContent>
                  {options?.map((opt) => (
                    <SelectItem key={opt} value={opt} data-testid={`option-${key}-${opt}`}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : type === "tags" ? (
              <TagInput
                value={field.value || []}
                onChange={field.onChange}
                placeholder={placeholder}
                data-testid={`input-${key}`}
              />
            ) : type === "datetime" ? (
              <Input
                {...field}
                type="datetime-local"
                data-testid={`input-${key}`}
              />
            ) : type === "time" ? (
              <Input
                {...field}
                type="time"
                data-testid={`input-${key}`}
              />
            ) : (
              <Input
                {...field}
                type={type === "number" ? "number" : "text"}
                step={type === "number" ? "any" : undefined}
                placeholder={placeholder}
                data-testid={`input-${key}`}
              />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

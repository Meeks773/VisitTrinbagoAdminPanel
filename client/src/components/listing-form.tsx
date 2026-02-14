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
import { Save, Loader2 } from "lucide-react";

interface ListingFormProps {
  category: Category;
  listing?: Listing;
  onSubmit: (data: any) => void;
  isPending?: boolean;
}

function buildFormSchema(fields: FieldConfig[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (field.type === "checkbox") {
      shape[field.key] = z.boolean().default(false);
    } else if (field.type === "number") {
      shape[field.key] = z.coerce.number().optional().default(0);
    } else if (field.type === "tags") {
      shape[field.key] = z.array(z.string()).default([]);
    } else {
      if (field.key === "name" || field.key === "description" || field.key === "interest" || field.key === "subInterest") {
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
      defaults[field.key] = value ?? 0;
    } else if (field.type === "tags") {
      defaults[field.key] = value ?? [];
    } else {
      defaults[field.key] = value ?? "";
    }
  }
  return defaults;
}

export function ListingForm({ category, listing, onSubmit, isPending }: ListingFormProps) {
  const fields = categoryFields[category];
  const schema = buildFormSchema(fields);

  const [featuredImage, setFeaturedImage] = useState<string | null>(listing?.featuredImage || null);
  const [galleryImages, setGalleryImages] = useState<string[]>(listing?.galleryImages || []);

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: getDefaultValues(fields, listing),
  });

  const handleSubmit = (values: Record<string, any>) => {
    const common: Record<string, any> = { category };
    const metadata: Record<string, any> = {};

    for (const field of fields) {
      if (field.isMetadata) {
        metadata[field.key] = values[field.key];
      } else {
        common[field.key] = values[field.key];
      }
    }

    onSubmit({
      ...common,
      metadata,
      featuredImage: featuredImage || null,
      galleryImages: galleryImages.length > 0 ? galleryImages : [],
    });
  };

  const commonFields = fields.filter((f) => !f.isMetadata);
  const metadataFields = fields.filter((f) => f.isMetadata);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <Card className="p-4 space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Images</h3>
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
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {commonFields.map((fieldConfig) => (
              <div key={fieldConfig.key} className={fieldConfig.type === "textarea" ? "md:col-span-2" : ""}>
                <RenderField fieldConfig={fieldConfig} form={form} />
              </div>
            ))}
          </div>
        </Card>

        {metadataFields.length > 0 && (
          <Card className="p-4 space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Category Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {metadataFields.map((fieldConfig) => (
                <div key={fieldConfig.key} className={fieldConfig.type === "textarea" || fieldConfig.type === "tags" ? "md:col-span-2" : ""}>
                  <RenderField fieldConfig={fieldConfig} form={form} />
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-submit-listing">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {listing ? "Update Listing" : "Create Listing"}
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

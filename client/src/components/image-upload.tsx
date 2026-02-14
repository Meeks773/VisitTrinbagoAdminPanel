import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ImageUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  "data-testid"?: string;
}

interface GalleryUploadProps {
  value: string[];
  onChange: (urls: string[]) => void;
  label?: string;
  "data-testid"?: string;
}

async function uploadFile(file: File): Promise<string> {
  const res = await fetch("/api/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to get upload URL");
  }

  const { uploadURL, objectPath } = await res.json();

  const uploadRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });

  if (!uploadRes.ok) {
    throw new Error("Failed to upload file");
  }

  return objectPath;
}

export function ImageUpload({ value, onChange, label = "Featured Image", ...props }: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Image must be under 10MB", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const objectPath = await uploadFile(file);
      onChange(objectPath);
      toast({ title: "Image uploaded" });
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }, [onChange, toast]);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {value ? (
        <div className="relative group">
          <img
            src={value}
            alt="Featured"
            className="w-full h-40 object-cover rounded-md border"
            data-testid={`${props["data-testid"]}-preview`}
          />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute top-2 right-2"
            onClick={() => onChange(null)}
            data-testid={`${props["data-testid"]}-remove`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-md cursor-pointer border-muted-foreground/25 bg-muted/30" data-testid={props["data-testid"]}>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            disabled={isUploading}
          />
          {isUploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">Click to upload image</span>
            </>
          )}
        </label>
      )}
    </div>
  );
}

export function GalleryUpload({ value, onChange, label = "Gallery Images", ...props }: GalleryUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast({ title: "Please select image files", variant: "destructive" });
      return;
    }

    const oversized = imageFiles.filter(f => f.size > 10 * 1024 * 1024);
    if (oversized.length > 0) {
      toast({ title: "Each image must be under 10MB", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const uploadPromises = imageFiles.map(f => uploadFile(f));
      const paths = await Promise.all(uploadPromises);
      onChange([...value, ...paths]);
      toast({ title: `${paths.length} image${paths.length > 1 ? "s" : ""} uploaded` });
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }, [value, onChange, toast]);

  const removeImage = useCallback((index: number) => {
    onChange(value.filter((_, i) => i !== index));
  }, [value, onChange]);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {value.map((url, index) => (
            <div key={index} className="relative group">
              <img
                src={url}
                alt={`Gallery ${index + 1}`}
                className="w-full h-24 object-cover rounded-md border"
                data-testid={`${props["data-testid"]}-preview-${index}`}
              />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute top-1 right-1 h-6 w-6"
                onClick={() => removeImage(index)}
                data-testid={`${props["data-testid"]}-remove-${index}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-md cursor-pointer border-muted-foreground/25 bg-muted/30" data-testid={props["data-testid"]}>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading}
        />
        {isUploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <>
            <ImageIcon className="h-6 w-6 text-muted-foreground mb-1" />
            <span className="text-xs text-muted-foreground">Click to add gallery images</span>
          </>
        )}
      </label>
    </div>
  );
}

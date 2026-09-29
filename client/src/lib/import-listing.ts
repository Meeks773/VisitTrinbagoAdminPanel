import { CATEGORIES, type Listing } from "@shared/schema";

export type AdminListing = Listing & {
  status?: "draft" | "published";
  importDetails?: {
    batchId: number;
    fileName: string;
    sheet: string;
    rowNumber: number;
    verified: boolean;
    warnings: string[];
    rawColumns: Record<string, string>;
  } | null;
};

export function missingPublicationFields(listing: AdminListing): string[] {
  const missing = (["name", "interest", "subInterest", "description"] as const)
    .filter((field) => !listing[field]?.trim())
    .map((field) => ({ name: "Name", interest: "Interest", subInterest: "Sub-interest", description: "Description" })[field]);
  if (!CATEGORIES.includes(listing.category as typeof CATEGORIES[number])) missing.push("Valid category");
  const { latitude, longitude } = listing;
  if ((latitude == null) !== (longitude == null)) missing.push("Latitude and longitude must both be provided or both left blank");
  else if (latitude != null && longitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) missing.push("Valid geographic coordinates");
  return missing;
}
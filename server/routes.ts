import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertListingSchema, CATEGORIES, CATEGORY_LABELS } from "@shared/schema";
import { z } from "zod";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { ObjectStorageService } from "./replit_integrations/object_storage/objectStorage";
import OpenAI from "openai";

const objectStorageService = new ObjectStorageService();

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

async function searchPexelsImages(query: string, count: number = 5): Promise<string[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
      { headers: { Authorization: apiKey } }
    );
    if (!response.ok) return [];

    const data = await response.json() as any;
    return (data.photos || []).map((p: any) => p.src?.large || p.src?.original);
  } catch {
    return [];
  }
}

async function uploadImageFromUrl(imageUrl: string): Promise<string | null> {
  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) return null;

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

    const presignedUrl = await objectStorageService.getObjectEntityUploadURL();

    const uploadResponse = await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: imageBuffer,
    });

    if (!uploadResponse.ok) return null;

    return objectStorageService.normalizeObjectEntityPath(presignedUrl);
  } catch (err) {
    console.error("Image upload error:", err);
    return null;
  }
}

const categoryMetadataFields: Record<string, { key: string; label: string; type: string; options?: string[] }[]> = {
  nightlife: [
    { key: "videoUrls", label: "Video URLs", type: "array" },
    { key: "openingHours", label: "Opening Hours", type: "text" },
    { key: "openingHoursNotes", label: "Opening Hours Notes", type: "text" },
    { key: "noCoverCharge", label: "No Cover Charge", type: "boolean" },
    { key: "currency", label: "Currency", type: "select", options: ["TTD", "USD", "EUR", "GBP"] },
    { key: "coverChargeAmount", label: "Cover Charge Amount", type: "number" },
    { key: "dressCode", label: "Dress Code", type: "text" },
    { key: "ageRestriction", label: "Age Restriction", type: "text" },
    { key: "bookingUrl", label: "Booking URL", type: "text" },
    { key: "amenities", label: "Amenities", type: "array" },
    { key: "specialNights", label: "Special Nights/Offers", type: "array" },
  ],
  beaches: [
    { key: "freeEntry", label: "Free Entry", type: "boolean" },
    { key: "currency", label: "Currency", type: "select", options: ["TTD", "USD", "EUR", "GBP"] },
    { key: "entryFeeAmount", label: "Entry Fee Amount", type: "number" },
    { key: "openingHours", label: "Opening Hours", type: "text" },
    { key: "openingHoursNotes", label: "Opening Hours Notes", type: "text" },
    { key: "amenities", label: "Amenities", type: "array" },
  ],
  wellness: [
    { key: "openingHours", label: "Opening Hours", type: "text" },
    { key: "openingHoursNotes", label: "Opening Hours Notes", type: "text" },
    { key: "amenities", label: "Amenities", type: "array" },
  ],
  festivals: [
    { key: "organizer", label: "Organizer", type: "text" },
    { key: "bookingUrl", label: "Booking URL", type: "text" },
    { key: "dateTime", label: "Date & Time", type: "datetime" },
    { key: "dressCode", label: "Dress Code", type: "text" },
  ],
  stay: [
    { key: "typeOfAccommodation", label: "Type of Accommodation", type: "select", options: ["Hotel", "Resort", "Guest House", "Villa", "Airbnb", "Hostel", "Boutique Hotel"] },
    { key: "currency", label: "Currency", type: "select", options: ["TTD", "USD", "EUR", "GBP"] },
    { key: "minPrice", label: "Minimum Price", type: "number" },
    { key: "maxPrice", label: "Maximum Price", type: "number" },
    { key: "priceNotes", label: "Price Notes", type: "text" },
    { key: "checkInTime", label: "Check-in Time", type: "time" },
    { key: "checkOutTime", label: "Check-out Time", type: "time" },
    { key: "amenities", label: "Amenities", type: "array" },
    { key: "bookingUrl", label: "Booking URL", type: "text" },
  ],
  transport: [
    { key: "bookingWebsite", label: "Booking Website", type: "text" },
  ],
  business: [
    { key: "typeOfFacility", label: "Type of Facility", type: "select", options: ["Conference Centre", "Co-working Space", "Office", "Business Lounge", "Meeting Room"] },
    { key: "guidesUrl", label: "Guides URL", type: "text" },
    { key: "bookingUrl", label: "Booking URL", type: "text" },
    { key: "specialFeatures", label: "Special Features", type: "array" },
  ],
  tours: [
    { key: "tourStartEndTime", label: "Tour Start & End Time", type: "text" },
    { key: "avgCostPerPerson", label: "Average Cost Per Person", type: "text" },
    { key: "dressCode", label: "Dress Code", type: "text" },
    { key: "bookingWebsite", label: "Booking Website", type: "text" },
    { key: "contactName", label: "Contact Name", type: "text" },
  ],
  eat_drink: [
    { key: "typeOfCuisine", label: "Type of Cuisine", type: "text" },
    { key: "priceRange", label: "Price Range", type: "select", options: ["$ (budget)", "$$ (mid-range)", "$$$ (upscale)", "$$$$ (fine dining)"] },
    { key: "openingHours", label: "Opening Hours", type: "text" },
    { key: "bookingUrl", label: "Booking URL", type: "text" },
    { key: "amenities", label: "Amenities", type: "array" },
  ],
  attractions: [
    { key: "freeEntry", label: "Free Entry", type: "boolean" },
    { key: "currency", label: "Currency", type: "select", options: ["TTD", "USD", "EUR", "GBP"] },
    { key: "entryFeeAmount", label: "Entry Fee Amount", type: "number" },
    { key: "openingHours", label: "Opening Hours", type: "text" },
    { key: "openingHoursNotes", label: "Opening Hours Notes", type: "text" },
    { key: "bookingUrl", label: "Booking URL", type: "text" },
    { key: "amenities", label: "Amenities", type: "array" },
  ],
  shopping: [
    { key: "typeOfFacility", label: "Type of Facility", type: "select", options: ["Market", "Craft", "Mall", "Boutique", "Souvenir Shop", "Duty-Free"] },
    { key: "openingHours", label: "Opening Hours", type: "text" },
    { key: "bookingUrl", label: "Booking URL", type: "text" },
    { key: "amenities", label: "Amenities", type: "array" },
  ],
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerObjectStorageRoutes(app);

  app.get("/api/listings", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const listings = await storage.getListings(category);
      res.json(listings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/listings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }
      const listing = await storage.getListing(id);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      res.json(listing);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/listings", async (req, res) => {
    try {
      const data = insertListingSchema.parse(req.body);
      const listing = await storage.createListing(data);
      res.status(201).json(listing);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors.map(e => e.message).join(", ") });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/listings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }
      const existing = await storage.getListing(id);
      if (!existing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      const partialSchema = insertListingSchema.partial();
      const validData = partialSchema.parse(req.body);
      const listing = await storage.updateListing(id, validData);
      res.json(listing);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors.map(e => e.message).join(", ") });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/listings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }
      const deleted = await storage.deleteListing(id);
      if (!deleted) {
        return res.status(404).json({ message: "Listing not found" });
      }
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── AI Content Generation ─────────────────────────────────────

  app.post("/api/ai/generate-listing", async (req, res) => {
    try {
      const { name, category } = req.body;

      if (!name || !category) {
        return res.status(400).json({ message: "Name and category are required" });
      }

      if (!CATEGORIES.includes(category)) {
        return res.status(400).json({ message: "Invalid category" });
      }

      const categoryLabel = CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS];
      const metaFields = categoryMetadataFields[category] || [];

      const metadataFieldsDescription = metaFields.map((f) => {
        let desc = `"${f.key}" (${f.label})`;
        if (f.type === "boolean") desc += " - true/false";
        if (f.type === "number") desc += " - numeric value";
        if (f.type === "array") desc += " - array of strings";
        if (f.type === "select" && f.options) desc += ` - one of: ${f.options.join(", ")}`;
        if (f.type === "datetime") desc += " - ISO datetime string (e.g. 2025-02-15T19:00)";
        if (f.type === "time") desc += " - time string in HH:MM format (e.g. 14:00)";
        return desc;
      }).join("\n    ");

      const prompt = `You are a tourism content writer for Trinidad and Tobago (T&T). Generate content for a "${categoryLabel}" listing called "${name}" in Trinidad and Tobago.

Your response must be valid JSON with these fields:
{
  "interest": "broad tourism interest category (e.g. Nature, Culture, Food, Entertainment, Adventure, Relaxation)",
  "subInterest": "specific sub-category within ${categoryLabel} (e.g. for beaches: Surf Beach, Calm Bay, etc.)",
  "description": "2-3 paragraph tourist-friendly description that is warm, inviting, and informative. Highlight what makes this place special, what visitors can expect, and why they should visit. Write it like a travel guide, not a Wikipedia article. Include sensory details and local flavor.",
  "location": "full address or location description in Trinidad and Tobago",
  "latitude": latitude as a number (approximate coordinates in Trinidad and Tobago, lat range roughly 10.0 to 11.5),
  "longitude": longitude as a number (approximate coordinates in Trinidad and Tobago, lng range roughly -62.0 to -60.5),
  "website": "a plausible website URL or empty string",
  "phone": "a plausible Trinidad phone number like +1 (868) XXX-XXXX or empty string",
  "email": "a plausible email or empty string",
  "rewardPoints": a suggested reward point value between 10 and 100,
  "metadata": {
    ${metadataFieldsDescription}
  }
}

Important rules:
- All content must be specific to Trinidad and Tobago
- Description should be 2-3 engaging paragraphs written for tourists
- Use TTD as the default currency if applicable
- For arrays (amenities, etc.), include 3-6 relevant items
- Make coordinates realistic for Trinidad and Tobago
- Return ONLY valid JSON, no markdown or extra text`;

      const searchQuery = `${name} Trinidad and Tobago ${categoryLabel}`;

      const [aiResponse, pexelsUrls] = await Promise.all([
        openai.chat.completions.create({
          model: "gpt-5-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          max_completion_tokens: 8192,
        }),
        searchPexelsImages(searchQuery, 5),
      ]);

      const content = aiResponse.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ message: "AI did not return content" });
      }

      const generated = JSON.parse(content);

      if (pexelsUrls.length > 0) {
        const uploadPromises = pexelsUrls.map((url) => uploadImageFromUrl(url));
        const uploadedPaths = (await Promise.all(uploadPromises)).filter(
          (p): p is string => p !== null
        );

        if (uploadedPaths.length > 0) {
          generated.featuredImage = uploadedPaths[0];
          generated.galleryImages = uploadedPaths.slice(1);
        }
      }

      res.json(generated);
    } catch (err: any) {
      console.error("AI generation error:", err);
      res.status(500).json({ message: "Failed to generate content. Please try again." });
    }
  });

  // ─── Public API for Mobile App ───────────────────────────────────

  app.get("/api/public/categories", async (_req, res) => {
    try {
      const counts = await storage.getCategoryCounts();
      const categories = CATEGORIES.map((cat) => ({
        id: cat,
        name: CATEGORY_LABELS[cat],
        count: counts[cat] || 0,
      }));
      res.json({ data: categories });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/public/listings", async (req, res) => {
    try {
      const options = {
        category: req.query.category as string | undefined,
        search: req.query.search as string | undefined,
        subInterest: req.query.subInterest as string | undefined,
        lat: req.query.lat ? parseFloat(req.query.lat as string) : undefined,
        lng: req.query.lng ? parseFloat(req.query.lng as string) : undefined,
        radius: req.query.radius ? parseFloat(req.query.radius as string) : undefined,
        sort: (req.query.sort as "name" | "reward_points" | "newest" | "distance") || undefined,
        page: req.query.page ? parseInt(req.query.page as string) : undefined,
        limit: req.query.limit ? Math.min(parseInt(req.query.limit as string), 100) : undefined,
      };

      if (options.lat != null && isNaN(options.lat)) {
        return res.status(400).json({ message: "Invalid latitude value" });
      }
      if (options.lng != null && isNaN(options.lng)) {
        return res.status(400).json({ message: "Invalid longitude value" });
      }

      const result = await storage.getPublicListings(options);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/public/listings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }
      const listing = await storage.getListing(id);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      res.json({ data: listing });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/public/search", async (req, res) => {
    try {
      const search = req.query.q as string;
      if (!search || search.trim().length < 2) {
        return res.status(400).json({ message: "Search query must be at least 2 characters" });
      }

      const result = await storage.getPublicListings({
        search: search.trim(),
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? Math.min(parseInt(req.query.limit as string), 100) : 20,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/public/nearby", async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ message: "lat and lng are required and must be valid numbers" });
      }

      const radius = req.query.radius ? parseFloat(req.query.radius as string) : 25;
      const category = req.query.category as string | undefined;

      const result = await storage.getPublicListings({
        lat,
        lng,
        radius,
        category,
        sort: "distance",
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? Math.min(parseInt(req.query.limit as string), 100) : 20,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

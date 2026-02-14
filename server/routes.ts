import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertListingSchema, CATEGORIES, CATEGORY_LABELS } from "@shared/schema";
import { z } from "zod";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";

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

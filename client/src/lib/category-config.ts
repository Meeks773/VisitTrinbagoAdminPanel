import type { Category } from "@shared/schema";
import {
  Wine,
  Waves,
  Heart,
  PartyPopper,
  Hotel,
  Car,
  Briefcase,
  Compass,
  UtensilsCrossed,
  Landmark,
  ShoppingBag,
} from "lucide-react";

export interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "checkbox" | "select" | "tags" | "datetime" | "time";
  placeholder?: string;
  options?: string[];
  isMetadata?: boolean;
}

export const categoryIcons: Record<Category, any> = {
  nightlife: Wine,
  beaches: Waves,
  wellness: Heart,
  festivals: PartyPopper,
  stay: Hotel,
  transport: Car,
  business: Briefcase,
  tours: Compass,
  eat_drink: UtensilsCrossed,
  attractions: Landmark,
  shopping: ShoppingBag,
};

const commonFields: FieldConfig[] = [
  { key: "name", label: "Name", type: "text", placeholder: "Enter name" },
  { key: "interest", label: "Interest", type: "text", placeholder: "e.g. Nature, Culture" },
  { key: "subInterest", label: "Sub Interest", type: "text", placeholder: "e.g. Beach, Festival" },
  { key: "description", label: "Description", type: "textarea", placeholder: "Enter a detailed description" },
  { key: "location", label: "Location", type: "text", placeholder: "Address or location name" },
  { key: "latitude", label: "Latitude", type: "number", placeholder: "e.g. 10.6605" },
  { key: "longitude", label: "Longitude", type: "number", placeholder: "e.g. -61.5080" },
  { key: "website", label: "Website", type: "text", placeholder: "https://example.com" },
  { key: "phone", label: "Phone Number", type: "text", placeholder: "+1 (868) 555-0123" },
  { key: "email", label: "Email", type: "text", placeholder: "info@example.tt" },
  { key: "rewardPoints", label: "Reward Points", type: "number", placeholder: "0" },
];

export const categoryFields: Record<Category, FieldConfig[]> = {
  nightlife: [
    ...commonFields,
    { key: "videoUrls", label: "Video URLs", type: "tags", placeholder: "Add video URL", isMetadata: true },
    { key: "openingHours", label: "Opening Hours", type: "text", placeholder: "e.g. Fri-Sat 6:00 PM - 2:00 AM", isMetadata: true },
    { key: "openingHoursNotes", label: "Opening Hours Notes", type: "textarea", placeholder: "Additional notes about hours", isMetadata: true },
    { key: "noCoverCharge", label: "No Cover Charge", type: "checkbox", isMetadata: true },
    { key: "currency", label: "Currency", type: "select", options: ["TTD", "USD", "EUR", "GBP"], isMetadata: true },
    { key: "coverChargeAmount", label: "Cover Charge Amount", type: "number", placeholder: "0", isMetadata: true },
    { key: "dressCode", label: "Dress Code", type: "text", placeholder: "e.g. Smart Casual", isMetadata: true },
    { key: "ageRestriction", label: "Age Restriction", type: "text", placeholder: "e.g. 18+", isMetadata: true },
    { key: "bookingUrl", label: "Booking URL", type: "text", placeholder: "https://example.tt/reservations", isMetadata: true },
    { key: "amenities", label: "Amenities", type: "tags", placeholder: "Add amenity", isMetadata: true },
    { key: "specialNights", label: "Special Nights/Offers", type: "tags", placeholder: "Add special night or offer", isMetadata: true },
  ],
  beaches: [
    ...commonFields,
    { key: "freeEntry", label: "Free Entry", type: "checkbox", isMetadata: true },
    { key: "currency", label: "Currency", type: "select", options: ["TTD", "USD", "EUR", "GBP"], isMetadata: true },
    { key: "entryFeeAmount", label: "Entry Fee Amount", type: "number", placeholder: "0", isMetadata: true },
    { key: "openingHours", label: "Opening Hours", type: "text", placeholder: "e.g. Daily 6:00 AM - 6:00 PM", isMetadata: true },
    { key: "openingHoursNotes", label: "Opening Hours Notes", type: "textarea", placeholder: "Additional notes", isMetadata: true },
    { key: "amenities", label: "Amenities", type: "tags", placeholder: "Add amenity", isMetadata: true },
  ],
  wellness: [
    ...commonFields,
    { key: "openingHours", label: "Opening Hours", type: "text", placeholder: "e.g. Mon-Sat 9:00 AM - 6:00 PM", isMetadata: true },
    { key: "openingHoursNotes", label: "Opening Hours Notes", type: "textarea", placeholder: "Additional notes", isMetadata: true },
    { key: "amenities", label: "Amenities", type: "tags", placeholder: "Add amenity", isMetadata: true },
  ],
  festivals: [
    ...commonFields,
    { key: "organizer", label: "Organizer", type: "text", placeholder: "Organization name", isMetadata: true },
    { key: "bookingUrl", label: "Booking URL", type: "text", placeholder: "https://tickets.example.tt", isMetadata: true },
    { key: "dateTime", label: "Date & Time", type: "datetime", isMetadata: true },
    { key: "dressCode", label: "Dress Code", type: "text", placeholder: "e.g. Casual", isMetadata: true },
  ],
  stay: [
    ...commonFields,
    { key: "typeOfAccommodation", label: "Type of Accommodation", type: "select", options: ["Hotel", "Resort", "Guest House", "Villa", "Airbnb", "Hostel", "Boutique Hotel"], isMetadata: true },
    { key: "currency", label: "Currency", type: "select", options: ["TTD", "USD", "EUR", "GBP"], isMetadata: true },
    { key: "minPrice", label: "Minimum Price", type: "number", placeholder: "0", isMetadata: true },
    { key: "maxPrice", label: "Maximum Price", type: "number", placeholder: "0", isMetadata: true },
    { key: "priceNotes", label: "Price Notes", type: "textarea", placeholder: "e.g. Rates vary by season", isMetadata: true },
    { key: "checkInTime", label: "Check-in Time", type: "time", isMetadata: true },
    { key: "checkOutTime", label: "Check-out Time", type: "time", isMetadata: true },
    { key: "amenities", label: "Amenities", type: "tags", placeholder: "Add amenity", isMetadata: true },
    { key: "bookingUrl", label: "Booking URL", type: "text", placeholder: "https://example.com/book", isMetadata: true },
  ],
  transport: [
    ...commonFields,
    { key: "bookingWebsite", label: "Booking Website", type: "text", placeholder: "https://example.tt/book", isMetadata: true },
  ],
  business: [
    ...commonFields,
    { key: "typeOfFacility", label: "Type of Facility", type: "select", options: ["Conference Centre", "Co-working Space", "Office", "Business Lounge", "Meeting Room"], isMetadata: true },
    { key: "guidesUrl", label: "Guides URL", type: "text", placeholder: "https://example.tt/guide", isMetadata: true },
    { key: "bookingUrl", label: "Booking URL", type: "text", placeholder: "https://example.tt/book", isMetadata: true },
    { key: "specialFeatures", label: "Special Features", type: "tags", placeholder: "Add feature", isMetadata: true },
  ],
  tours: [
    ...commonFields,
    { key: "tourStartEndTime", label: "Tour Start & End Time", type: "text", placeholder: "e.g. 8:00 AM - 1:00 PM", isMetadata: true },
    { key: "avgCostPerPerson", label: "Average Cost Per Person", type: "text", placeholder: "e.g. TTD 250", isMetadata: true },
    { key: "dressCode", label: "Dress Code", type: "text", placeholder: "e.g. Comfortable shoes", isMetadata: true },
    { key: "bookingWebsite", label: "Booking Website", type: "text", placeholder: "https://example.tt/book", isMetadata: true },
    { key: "contactName", label: "Contact Name", type: "text", placeholder: "Full name", isMetadata: true },
  ],
  eat_drink: [
    ...commonFields,
    { key: "typeOfCuisine", label: "Type of Cuisine", type: "text", placeholder: "e.g. Caribbean / Seafood", isMetadata: true },
    { key: "priceRange", label: "Price Range", type: "select", options: ["$ (budget)", "$$ (mid-range)", "$$$ (upscale)", "$$$$ (fine dining)"], isMetadata: true },
    { key: "openingHours", label: "Opening Hours", type: "text", placeholder: "e.g. Mon-Sun 11:00 AM - 10:00 PM", isMetadata: true },
    { key: "bookingUrl", label: "Booking URL", type: "text", placeholder: "https://example.tt/reserve", isMetadata: true },
    { key: "amenities", label: "Amenities", type: "tags", placeholder: "Add amenity", isMetadata: true },
  ],
  attractions: [
    ...commonFields,
    { key: "freeEntry", label: "Free Entry", type: "checkbox", isMetadata: true },
    { key: "currency", label: "Currency", type: "select", options: ["TTD", "USD", "EUR", "GBP"], isMetadata: true },
    { key: "entryFeeAmount", label: "Entry Fee Amount", type: "number", placeholder: "0", isMetadata: true },
    { key: "openingHours", label: "Opening Hours", type: "text", placeholder: "e.g. Tue-Sun 8:00 AM - 4:30 PM", isMetadata: true },
    { key: "openingHoursNotes", label: "Opening Hours Notes", type: "textarea", placeholder: "e.g. Last entry at 3:30 PM", isMetadata: true },
    { key: "bookingUrl", label: "Booking URL", type: "text", placeholder: "https://example.tt/book", isMetadata: true },
    { key: "amenities", label: "Amenities", type: "tags", placeholder: "Add amenity", isMetadata: true },
  ],
  shopping: [
    ...commonFields,
    { key: "typeOfFacility", label: "Type of Facility", type: "select", options: ["Market", "Craft", "Mall", "Boutique", "Souvenir Shop", "Duty-Free"], isMetadata: true },
    { key: "openingHours", label: "Opening Hours", type: "text", placeholder: "e.g. Mon-Sat 6:00 AM - 6:00 PM", isMetadata: true },
    { key: "bookingUrl", label: "Booking URL", type: "text", placeholder: "https://example.tt/tours", isMetadata: true },
    { key: "amenities", label: "Amenities", type: "tags", placeholder: "Add amenity", isMetadata: true },
  ],
};

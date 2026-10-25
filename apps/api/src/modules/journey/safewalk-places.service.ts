import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { safeWalkEnabled } from "./safewalk-consent";

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location";
const WINDOW_MS = 5 * 60_000;
export const SEARCHES_PER_WINDOW = 20;
const CACHE_MS = 60 * 60_000;
const CACHE_MAX = 500;

/**
 * Destination search for SafeWalk ("Berger Bus Stop", "Shoprite Lekki").
 * Runs on the server so the Google key stays restricted, results are cached
 * and each person's searches are limited. Coordinates come from Google; the
 * person only ever sees the place name.
 */
@Injectable()
export class SafeWalkPlacesService {
  private readonly cache = new Map<string, { at: number; results: PlaceResult[] }>();
  private readonly usage = new Map<string, number[]>();

  available(): boolean {
    return safeWalkEnabled() && !!process.env.GOOGLE_MAPS_API_KEY?.trim();
  }

  async search(userId: string, query: string, near?: { latitude: number; longitude: number }, now = Date.now()): Promise<PlaceResult[]> {
    const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!this.available() || !key) throw new ServiceUnavailableException("Place search isn't available. Choose a saved place or describe where you're going.");
    const text = query.trim().replace(/\s+/g, " ");
    if (text.length < 2 || text.length > 80) return [];
    const cacheKey = `${text.toLowerCase()}|${near ? `${near.latitude.toFixed(1)},${near.longitude.toFixed(1)}` : "-"}`;
    const hit = this.cache.get(cacheKey);
    if (hit && now - hit.at < CACHE_MS) return hit.results;

    const recent = (this.usage.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= SEARCHES_PER_WINDOW) throw new HttpException("Too many searches. Wait a few minutes and try again.", HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.usage.set(userId, recent);

    const body: Record<string, unknown> = { textQuery: text, regionCode: "NG", maxResultCount: 6, languageCode: "en" };
    if (near) body.locationBias = { circle: { center: near, radius: 50_000 } };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    let payload: { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }> };
    try {
      const response = await fetch(SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new ServiceUnavailableException("Place search isn't working right now. Choose a saved place or describe where you're going.");
    } finally {
      clearTimeout(timer);
    }
    const results = toResults(payload.places ?? []);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(cacheKey, { at: now, results });
    return results;
  }
}

export function toResults(places: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }>): PlaceResult[] {
  return places
    .filter((p) => p.id && p.displayName?.text && Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude))
    .map((p) => ({
      placeId: p.id!.slice(0, 256),
      name: p.displayName!.text!.slice(0, 120),
      address: (p.formattedAddress ?? "").slice(0, 200),
      latitude: Math.round(p.location!.latitude! * 1e6) / 1e6,
      longitude: Math.round(p.location!.longitude! * 1e6) / 1e6,
    }));
}

/**
 * Google Maps for an incident position. No API key: the public embed and
 * search URLs take plain coordinates. Nothing about the resident is sent,
 * only the position the operator is already authorised to see.
 */
function valid(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

export function googleMapsUrl(lat: unknown, lng: unknown): string | null {
  if (!valid(lat, lng)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${(lat as number).toFixed(6)},${(lng as number).toFixed(6)}`;
}

export function OpenInMapsLink({ latitude, longitude }: { latitude: unknown; longitude: unknown }) {
  const url = googleMapsUrl(latitude, longitude);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-medium text-ink hover:border-muted-2 hover:bg-panel-2"
    >
      Open in Google Maps
    </a>
  );
}

export function IncidentMap({ latitude, longitude }: { latitude: unknown; longitude: unknown }) {
  if (!valid(latitude, longitude)) return null;
  const q = `${(latitude as number).toFixed(6)},${(longitude as number).toFixed(6)}`;
  return (
    <div className="mt-3 grid gap-2">
      <iframe
        title="Incident location map"
        src={`https://maps.google.com/maps?q=${q}&z=17&output=embed`}
        className="h-72 w-full rounded-lg border border-line"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <div>
        <OpenInMapsLink latitude={latitude} longitude={longitude} />
      </div>
    </div>
  );
}

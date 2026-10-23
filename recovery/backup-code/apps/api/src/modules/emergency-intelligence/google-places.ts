export interface GooglePlaceLocation {
  latitude?: number;
  longitude?: number;
}

export interface GooglePlaceDisplayName {
  text?: string;
  languageCode?: string;
}

export interface GoogleNearbyPlace {
  id?: string;
  types?: string[];
  nationalPhoneNumber?: string;
  formattedAddress?: string;
  location?: GooglePlaceLocation;
  displayName?: GooglePlaceDisplayName;
  primaryType?: string;
}

export interface GoogleNearbySearchResponse {
  places?: GoogleNearbyPlace[];
}

export const GOOGLE_NEARBY_SEARCH_URL =
  'https://places.googleapis.com/v1/places:searchNearby';

export const GOOGLE_NEARBY_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.nationalPhoneNumber',
  'places.primaryType',
  'places.types',
].join(',');

export const GOOGLE_NEARBY_RADIUS_METERS = 5_000;
export const GOOGLE_NEARBY_MAX_RESULTS = 20;

export function buildNearbySearchBody(
  latitude: number,
  longitude: number,
  includedTypes: string[],
): object {
  return {
    includedTypes,
    maxResultCount: GOOGLE_NEARBY_MAX_RESULTS,
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: {
        center: {
          latitude,
          longitude,
        },
        radius: GOOGLE_NEARBY_RADIUS_METERS,
      },
    },
  };
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceMetersBetween(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const earthRadiusMeters = 6_371_000;

  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);

  const fromLatitudeRadians = toRadians(fromLatitude);
  const toLatitudeRadians = toRadians(toLatitude);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  const angularDistance =
    2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusMeters * angularDistance);
}

export function bearingDegreesBetween(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const fromLatitudeRadians = toRadians(fromLatitude);
  const toLatitudeRadians = toRadians(toLatitude);
  const longitudeDeltaRadians = toRadians(
    toLongitude - fromLongitude,
  );

  const y =
    Math.sin(longitudeDeltaRadians) *
    Math.cos(toLatitudeRadians);

  const x =
    Math.cos(fromLatitudeRadians) *
      Math.sin(toLatitudeRadians) -
    Math.sin(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.cos(longitudeDeltaRadians);

  return (
    (Math.atan2(y, x) * 180) / Math.PI +
    360
  ) % 360;
}

export function hasUsableGooglePlaceLocation(
  place: GoogleNearbyPlace,
): place is GoogleNearbyPlace & {
  id: string;
  displayName: { text: string };
  location: {
    latitude: number;
    longitude: number;
  };
} {
  return (
    typeof place.id === 'string' &&
    place.id.length > 0 &&
    typeof place.displayName?.text === 'string' &&
    place.displayName.text.trim().length > 0 &&
    Number.isFinite(place.location?.latitude) &&
    Number.isFinite(place.location?.longitude)
  );
}

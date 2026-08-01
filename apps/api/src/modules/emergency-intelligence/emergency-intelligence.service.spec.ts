import { EmergencyIntelligenceService } from './emergency-intelligence.service';
import type { DataConfidence } from './data-confidence';
import type { LocationRequestDto } from './dto/location-request.dto';
import type { GeocodingResult } from './providers/geocoding.provider';
import type { NearbyPlace, CardinalDirection } from './providers/places.provider';
import type { Hospital } from './providers/hospital.provider';
import type { PoliceStation } from './providers/police.provider';
import type { SafePlace } from './providers/safe-place.provider';
import type { RouteOption } from './providers/routing.provider';
import type { DeviceIntelligence } from './providers/device.provider';

/**
 * THE SUPPRESSION CONTRACT.
 *
 * ADR-012 permits production boot with mock providers registered, on the
 * condition that their outputs are suppressed. Before that ADR the only
 * protection was that a 160-line method stayed correctly maintained; the
 * service's own doc comment names this layer as the thing that must hold "if
 * the validator is ever relaxed for a legitimate reason". ADR-012 IS that
 * relaxation, so the layer now needs tests.
 *
 * What is proven, per provider:
 *   1. that provider's fields are nulled in the response
 *   2. its label appears in the omitted list, via the debug log
 *   3. raw device GPS survives - latitude, longitude, accuracy, movement
 *   4. the PRODUCTION device provider still ships
 *   5. every OTHER provider's section is unaffected
 *
 * Point 5 is the independence claim ADR-012 section 4 makes and nothing
 * previously tested.
 *
 * Trap #61: jest.config.ts has no setupFiles, so reflect-metadata is not
 * global and Test.createTestingModule cannot be used on a decorated class.
 * Direct construction works - provider-confidence.validator.spec.ts already
 * relies on it. Seven constructor arguments, so the CONSTRUCTOR is cast rather
 * than each argument.
 */
type Ctor = new (...args: unknown[]) => EmergencyIntelligenceService;
const CTOR = EmergencyIntelligenceService as unknown as Ctor;

const PRODUCTION: DataConfidence = 'PRODUCTION';
const MOCK: DataConfidence = 'MOCK';

const LAT = 6.524379;
const LNG = 3.379206;

/**
 * Fixtures satisfy the REAL provider interfaces. A partial object would be
 * rejected by mockResolvedValue against a typed method under strict mode.
 * Values are deliberately distinguishable from the providers' own fixtures so
 * a wrong source is visible in a failure diff.
 */
const GEO: GeocodingResult = {
  latitude: LAT,
  longitude: LNG,
  formattedAddress: '1 Spec Street, Testville, Lagos',
  street: 'Spec Street',
  crossStreet: 'Spec Street & Fixture Road',
  landmark: 'Spec Junction',
  community: 'Testville',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  postalCode: '999999',
  provider: 'spec-geocoding',
};

const PLACES: NearbyPlace[] = [
  {
    id: 'spec-place-001',
    name: 'Spec Landmark',
    category: 'LANDMARK',
    latitude: LAT + 0.001,
    longitude: LNG,
    distanceMeters: 120,
    direction: 'NORTH',
    address: 'Spec Street, Testville',
    isVerified: true,
    provider: 'spec-places',
  },
];

const EMPTY_BY_DIRECTION: Record<CardinalDirection, NearbyPlace[]> = {
  NORTH: PLACES,
  SOUTH: [],
  EAST: [],
  WEST: [],
  NORTH_EAST: [],
  NORTH_WEST: [],
  SOUTH_EAST: [],
  SOUTH_WEST: [],
};

const HOSPITALS: Hospital[] = [
  {
    id: 'spec-hospital-001',
    name: 'Spec General Hospital',
    address: 'Spec Street, Testville',
    phoneNumber: '+2349000000001',
    latitude: LAT + 0.004,
    longitude: LNG,
    distanceMeters: 450,
    emergencyAvailable: true,
    traumaCenter: true,
    twentyFourHours: true,
    provider: 'spec-hospital',
  },
  {
    id: 'spec-hospital-002',
    name: 'Spec Clinic',
    address: 'Fixture Road, Testville',
    latitude: LAT + 0.008,
    longitude: LNG + 0.001,
    distanceMeters: 910,
    emergencyAvailable: false,
    traumaCenter: false,
    twentyFourHours: false,
    provider: 'spec-hospital',
  },
];

const POLICE: PoliceStation[] = [
  {
    id: 'spec-police-001',
    name: 'Spec Police Command',
    address: 'Spec Street, Testville',
    phoneNumber: '+2349000000002',
    latitude: LAT,
    longitude: LNG - 0.005,
    distanceMeters: 600,
    twentyFourHours: true,
    emergencyResponse: true,
    provider: 'spec-police',
  },
  {
    id: 'spec-police-002',
    name: 'Spec Divisional Headquarters',
    address: 'Fixture Road, Testville',
    latitude: LAT + 0.002,
    longitude: LNG + 0.002,
    distanceMeters: 340,
    twentyFourHours: false,
    emergencyResponse: true,
    provider: 'spec-police',
  },
];

const SAFE_PLACES: SafePlace[] = [
  {
    id: 'spec-safe-001',
    name: 'Spec Safe Haven',
    type: 'COMMUNITY_CENTER',
    address: 'Spec Street, Testville',
    latitude: LAT - 0.001,
    longitude: LNG,
    distanceMeters: 200,
    isVerified: true,
    twentyFourHours: true,
    phoneNumber: '+2349000000003',
    provider: 'spec-safe-place',
  },
  {
    id: 'spec-safe-002',
    name: 'Spec Shopping Centre',
    type: 'SHOPPING_CENTER',
    address: 'Fixture Road, Testville',
    latitude: LAT - 0.003,
    longitude: LNG + 0.004,
    distanceMeters: 780,
    isVerified: false,
    twentyFourHours: false,
    provider: 'spec-safe-place',
  },
];

const ROUTES: RouteOption[] = [
  {
    id: 'spec-route-001',
    destinationName: 'Spec General Hospital',
    destinationType: 'HOSPITAL',
    distanceMeters: 450,
    estimatedDurationSeconds: 150,
    travelMode: 'DRIVING',
    summary: 'Spec route summary.',
    provider: 'spec-routing',
  },
];

const DTO: LocationRequestDto = {
  latitude: LAT,
  longitude: LNG,
  accuracy: 12.5,
  speed: 1.4,
  heading: 90,
  altitude: 31,
  // batteryLevel is @Min(0) @Max(100) on the DTO - a percentage, not a
  // fraction. Pinned here because the mobile app captures neither
  // batteryLevel nor isCharging yet, so this is the convention it will be
  // written against.
  batteryLevel: 62,
  isCharging: false,
  networkType: 'wifi',
  language: 'en',
  timestamp: '2026-07-31T12:00:00.000Z',
};

/**
 * What the real DeviceProvider returns for the DTO above. providerName matches
 * production ('DeviceTelemetryProvider') so that swapping in the real provider
 * later cannot fail this spec for an unrelated reason.
 */
const DEVICE: DeviceIntelligence = {
  batteryLevel: 62,
  isCharging: false,
  networkType: 'wifi',
  language: 'en',
  speed: 1.4,
  heading: 90,
  altitude: 31,
  accuracy: 12.5,
  timestamp: '2026-07-31T12:00:00.000Z',
  isOffline: false,
  provider: 'DeviceTelemetryProvider',
};

interface Confidences {
  geocoding?: DataConfidence;
  places?: DataConfidence;
  hospital?: DataConfidence;
  police?: DataConfidence;
  safePlace?: DataConfidence;
  device?: DataConfidence;
  routing?: DataConfidence;
}

function build(confidences: Confidences = {}) {
  const c = {
    geocoding: PRODUCTION,
    places: PRODUCTION,
    hospital: PRODUCTION,
    police: PRODUCTION,
    safePlace: PRODUCTION,
    device: PRODUCTION,
    routing: PRODUCTION,
    ...confidences,
  };

  const geocodingProvider = {
    providerName: 'spec-geocoding',
    dataConfidence: c.geocoding,
    reverseGeocode: jest.fn().mockResolvedValue(GEO),
  };
  const placesProvider = {
    providerName: 'spec-places',
    dataConfidence: c.places,
    findNearbyPlaces: jest.fn().mockResolvedValue(PLACES),
    groupByDirection: jest.fn().mockReturnValue(EMPTY_BY_DIRECTION),
  };
  const hospitalProvider = {
    providerName: 'spec-hospital',
    dataConfidence: c.hospital,
    findNearbyHospitals: jest.fn().mockResolvedValue(HOSPITALS),
  };
  const policeProvider = {
    providerName: 'spec-police',
    dataConfidence: c.police,
    findNearbyPoliceStations: jest.fn().mockResolvedValue(POLICE),
  };
  const safePlaceProvider = {
    providerName: 'spec-safe-place',
    dataConfidence: c.safePlace,
    findNearbySafePlaces: jest.fn().mockResolvedValue(SAFE_PLACES),
  };
  const deviceProvider = {
    providerName: 'DeviceTelemetryProvider',
    dataConfidence: c.device,
    buildDeviceIntelligence: jest.fn().mockReturnValue(DEVICE),
  };
  const routingProvider = {
    providerName: 'spec-routing',
    dataConfidence: c.routing,
    buildSafeRoutes: jest.fn().mockResolvedValue(ROUTES),
  };

  const service = new CTOR(
    geocodingProvider,
    placesProvider,
    hospitalProvider,
    policeProvider,
    safePlaceProvider,
    deviceProvider,
    routingProvider,
  );

  const debug = jest
    .spyOn(
      (service as unknown as { logger: { debug: (message: string) => void } })
        .logger,
      'debug',
    )
    .mockImplementation(() => undefined);

  return { service, debug, placesProvider, routingProvider };
}

/**
 * SECONDARY ASSERTIONS ONLY.
 *
 * the omitted list is a local const inside the service and is never returned, so the
 * debug log is the only externally observable form of it. That makes these
 * assertions coupled to log WORDING, which is a weaker contract than the
 * response shape.
 *
 * The coupling is concentrated here deliberately: if the service's wording
 * changes, this one pattern changes and the guard test below reports it as a
 * format change rather than as several mysterious label failures. The primary
 * contract - nulled fields, surviving fields, response shape - is asserted
 * independently of the log throughout.
 */
const OMITTED_LOG_PATTERN = /due to mock providers: ([^.]*)\./;

function omittedFrom(debug: jest.SpyInstance): string[] {
  if (debug.mock.calls.length === 0) return [];
  const call = debug.mock.calls[0];
  const message = String(call === undefined ? '' : call[0]);
  const matched = OMITTED_LOG_PATTERN.exec(message);
  if (matched === null) return [];
  const captured = matched[1];
  if (captured === undefined) return [];
  return captured.split(',').map((part) => part.trim());
}

type Result = Awaited<
  ReturnType<EmergencyIntelligenceService['buildLocationIntelligence']>
>;

/**
 * Raw device GPS must survive every suppression path. This is the guarantee
 * that makes ADR-012 defensible: mock enrichment is dropped, the position the
 * phone actually reported is not.
 */
function expectRawGpsIntact(result: Result): void {
  expect(result.location.latitude).toBe(DTO.latitude);
  expect(result.location.longitude).toBe(DTO.longitude);
  expect(result.location.accuracy).toBe(DTO.accuracy);
  expect(result.movement).toEqual({
    speed: DTO.speed,
    heading: DTO.heading,
    altitude: DTO.altitude,
  });
  // Identity, not deep equality: the guarantee is that the object the device
  // provider returned is the object that shipped, untouched.
  expect(result.device).toBe(DEVICE);
}

const GEOCODED_FIELDS = [
  'address',
  'street',
  'crossStreet',
  'landmark',
  'community',
  'city',
  'state',
  'country',
  'postalCode',
  'provider',
] as const;

function expectGeocodedFieldsNull(result: Result): void {
  for (const field of GEOCODED_FIELDS) {
    expect(result.location[field]).toBeNull();
  }
}

describe('EmergencyIntelligenceService - suppression contract (ADR-012)', () => {
  describe('baseline', () => {
    it('suppresses nothing when no provider is MOCK', async () => {
      const { service, debug } = build();
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.location.address).toBe(GEO.formattedAddress);
      expect(result.surroundings).toEqual({
        places: PLACES,
        byDirection: EMPTY_BY_DIRECTION,
      });
      expect(result.emergencyResources.hospitals).toEqual(HOSPITALS);
      expect(result.emergencyResources.policeStations).toEqual(POLICE);
      expect(result.emergencyResources.safePlaces).toEqual(SAFE_PLACES);
      expect(result.routes).toEqual(ROUTES);
      expectRawGpsIntact(result);

      expect(debug).not.toHaveBeenCalled();
      expect(omittedFrom(debug)).toEqual([]);
    });

    it('treats VERIFIED as displayable, exactly like PRODUCTION', async () => {
      // isDisplayableToUsers is !isMockConfidence, so VERIFIED displays today.
      // data-confidence.ts anticipates a fourth level splitting the deployment
      // question from the presentation question. Pinned so that change is
      // deliberate rather than silent.
      const { service, debug } = build({
        geocoding: 'VERIFIED',
        hospital: 'VERIFIED',
      });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.location.address).toBe(GEO.formattedAddress);
      expect(result.emergencyResources.hospitals).toEqual(HOSPITALS);
      expect(debug).not.toHaveBeenCalled();
    });
  });

  describe('1. geocoding MOCK', () => {
    it('nulls every geocoded field, keeps raw GPS, omits "address"', async () => {
      const { service, debug } = build({ geocoding: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expectGeocodedFieldsNull(result);
      expectRawGpsIntact(result);
      expect(omittedFrom(debug)).toEqual(['address']);
    });

    it('leaves every other section untouched', async () => {
      const { service } = build({ geocoding: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.surroundings).not.toBeNull();
      expect(result.emergencyResources.hospitals).toEqual(HOSPITALS);
      expect(result.emergencyResources.policeStations).toEqual(POLICE);
      expect(result.emergencyResources.safePlaces).toEqual(SAFE_PLACES);
      expect(result.routes).toEqual(ROUTES);
    });
  });

  describe('2. places MOCK', () => {
    it('nulls surroundings entirely and omits "surroundings"', async () => {
      const { service, debug } = build({ places: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.surroundings).toBeNull();
      expectRawGpsIntact(result);
      expect(omittedFrom(debug)).toEqual(['surroundings']);
    });

    it('leaves every other section untouched', async () => {
      const { service } = build({ places: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.location.address).toBe(GEO.formattedAddress);
      expect(result.emergencyResources.hospitals).toEqual(HOSPITALS);
      expect(result.emergencyResources.policeStations).toEqual(POLICE);
      expect(result.emergencyResources.safePlaces).toEqual(SAFE_PLACES);
      expect(result.routes).toEqual(ROUTES);
    });
  });

  describe('3. hospital MOCK', () => {
    it('nulls both hospital fields and omits "hospitals"', async () => {
      const { service, debug } = build({ hospital: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      // nearestHospital is computed as hospitals[0] ?? null BEFORE the mock
      // check short-circuits it. Pinned so a reorder cannot leak it.
      expect(result.emergencyResources.nearestHospital).toBeNull();
      expect(result.emergencyResources.hospitals).toBeNull();
      expectRawGpsIntact(result);
      expect(omittedFrom(debug)).toEqual(['hospitals']);
    });

    it('leaves police and safe places intact - resources gate independently', async () => {
      const { service } = build({ hospital: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.emergencyResources.nearestPoliceStation).toEqual(POLICE[0]);
      expect(result.emergencyResources.policeStations).toEqual(POLICE);
      expect(result.emergencyResources.nearestSafePlace).toEqual(SAFE_PLACES[0]);
      expect(result.emergencyResources.safePlaces).toEqual(SAFE_PLACES);
      expect(result.location.address).toBe(GEO.formattedAddress);
      expect(result.routes).toEqual(ROUTES);
    });
  });

  describe('4. police MOCK', () => {
    it('nulls both police fields and omits "policeStations"', async () => {
      const { service, debug } = build({ police: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.emergencyResources.nearestPoliceStation).toBeNull();
      expect(result.emergencyResources.policeStations).toBeNull();
      expectRawGpsIntact(result);
      expect(omittedFrom(debug)).toEqual(['policeStations']);
    });

    it('leaves hospitals and safe places intact', async () => {
      const { service } = build({ police: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.emergencyResources.nearestHospital).toEqual(HOSPITALS[0]);
      expect(result.emergencyResources.hospitals).toEqual(HOSPITALS);
      expect(result.emergencyResources.safePlaces).toEqual(SAFE_PLACES);
      expect(result.routes).toEqual(ROUTES);
    });
  });

  describe('5. safe place MOCK', () => {
    it('nulls both safe-place fields and omits "safePlaces"', async () => {
      const { service, debug } = build({ safePlace: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.emergencyResources.nearestSafePlace).toBeNull();
      expect(result.emergencyResources.safePlaces).toBeNull();
      expectRawGpsIntact(result);
      expect(omittedFrom(debug)).toEqual(['safePlaces']);
    });

    it('leaves hospitals and police intact', async () => {
      const { service } = build({ safePlace: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.emergencyResources.hospitals).toEqual(HOSPITALS);
      expect(result.emergencyResources.policeStations).toEqual(POLICE);
      expect(result.routes).toEqual(ROUTES);
    });
  });

  describe('6. routing MOCK', () => {
    it('nulls routes and omits "routes"', async () => {
      const { service, debug } = build({ routing: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      // routes is nulled in the RETURN statement, physically separated from
      // its check at the bottom of the method. The easiest of the six to
      // break in a refactor.
      expect(result.routes).toBeNull();
      expectRawGpsIntact(result);
      expect(omittedFrom(debug)).toEqual(['routes']);
    });

    it('leaves every other section untouched', async () => {
      const { service } = build({ routing: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.location.address).toBe(GEO.formattedAddress);
      expect(result.surroundings).not.toBeNull();
      expect(result.emergencyResources.hospitals).toEqual(HOSPITALS);
      expect(result.emergencyResources.policeStations).toEqual(POLICE);
      expect(result.emergencyResources.safePlaces).toEqual(SAFE_PLACES);
    });
  });

  describe('the production case: six MOCK, device PRODUCTION', () => {
    const PRODUCTION_BOOT_CONFIGURATION: Confidences = {
      geocoding: MOCK,
      places: MOCK,
      hospital: MOCK,
      police: MOCK,
      safePlace: MOCK,
      routing: MOCK,
    };

    it('suppresses every mock-backed section and still returns raw GPS', async () => {
      // This is exactly the state ADR-012 permits to boot: six of seven
      // providers mocked, outputs suppressed, position still reported.
      const { service } = build(PRODUCTION_BOOT_CONFIGURATION);
      const result = await service.buildLocationIntelligence(DTO);

      expectGeocodedFieldsNull(result);
      expect(result.surroundings).toBeNull();
      expect(result.emergencyResources).toEqual({
        nearestHospital: null,
        hospitals: null,
        nearestPoliceStation: null,
        policeStations: null,
        nearestSafePlace: null,
        safePlaces: null,
      });
      expect(result.routes).toBeNull();

      expectRawGpsIntact(result);
    });

    it('names all six omitted sections', async () => {
      const { service, debug } = build(PRODUCTION_BOOT_CONFIGURATION);
      await service.buildLocationIntelligence(DTO);

      const expected = [
        'address',
        'hospitals',
        'policeStations',
        'routes',
        'safePlaces',
        'surroundings',
      ];
      expect([...omittedFrom(debug)].sort()).toEqual([...expected].sort());
    });

    it('keeps emergencyResources an object rather than collapsing it to null', async () => {
      // Pinned deliberately: the container survives even when all three of its
      // providers are mocked. Nulling the container would be a contract change
      // for every consumer.
      const { service } = build({
        hospital: MOCK,
        police: MOCK,
        safePlace: MOCK,
      });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.emergencyResources).not.toBeNull();
      expect(typeof result.emergencyResources).toBe('object');
    });
  });

  describe('multi-provider independence', () => {
    it('geocoding + routing MOCK suppresses both and nothing else', async () => {
      // The two whose null-assignments are physically furthest apart in the
      // method: geocoding nulls ten fields inside the location object near the top,
      // routing is nulled in the return statement at the bottom. If suppression
      // ever became order-dependent, this pair is where it would show.
      const { service, debug } = build({ geocoding: MOCK, routing: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expectGeocodedFieldsNull(result);
      expect(result.routes).toBeNull();

      expect(result.surroundings).not.toBeNull();
      expect(result.emergencyResources.hospitals).toEqual(HOSPITALS);
      expect(result.emergencyResources.policeStations).toEqual(POLICE);
      expect(result.emergencyResources.safePlaces).toEqual(SAFE_PLACES);
      expectRawGpsIntact(result);

      expect([...omittedFrom(debug)].sort()).toEqual(['address', 'routes']);
    });

    it('two of three emergency resources MOCK leaves the third intact', async () => {
      // hospital, police and safePlace write into ONE shared object, so an
      // interaction bug is most plausible here. Police must survive untouched.
      const { service, debug } = build({ hospital: MOCK, safePlace: MOCK });
      const result = await service.buildLocationIntelligence(DTO);

      expect(result.emergencyResources.nearestHospital).toBeNull();
      expect(result.emergencyResources.hospitals).toBeNull();
      expect(result.emergencyResources.nearestSafePlace).toBeNull();
      expect(result.emergencyResources.safePlaces).toBeNull();

      expect(result.emergencyResources.nearestPoliceStation).toEqual(POLICE[0]);
      expect(result.emergencyResources.policeStations).toEqual(POLICE);

      expect(result.location.address).toBe(GEO.formattedAddress);
      expect(result.surroundings).not.toBeNull();
      expect(result.routes).toEqual(ROUTES);
      expectRawGpsIntact(result);

      expect([...omittedFrom(debug)].sort()).toEqual(['hospitals', 'safePlaces']);
    });
  });

  describe('the log-format coupling itself', () => {
    it('the omitted-label pattern still matches the service log', async () => {
      // A guard on the SECONDARY assertions. If the service's wording changes,
      // this fails as an explicit format change rather than surfacing as
      // several unexplained empty label lists elsewhere in this file.
      const { service, debug } = build({ routing: MOCK });
      await service.buildLocationIntelligence(DTO);

      expect(debug).toHaveBeenCalledTimes(1);
      const call = debug.mock.calls[0];
      const message = String(call === undefined ? '' : call[0]);
      expect(OMITTED_LOG_PATTERN.test(message)).toBe(true);
    });
  });

  describe('suppression happens at assembly, not by skipping the call', () => {
    it('still calls a mocked provider before discarding its result', async () => {
      // The service awaits all six in Promise.all before any mock check. If a
      // future change skips the call instead, timing and error surface both
      // change - worth failing deliberately rather than drifting.
      const { service, placesProvider, routingProvider } = build({
        places: MOCK,
        routing: MOCK,
      });
      const result = await service.buildLocationIntelligence(DTO);

      expect(placesProvider.findNearbyPlaces).toHaveBeenCalledWith(LAT, LNG);
      expect(routingProvider.buildSafeRoutes).toHaveBeenCalled();
      expect(result.surroundings).toBeNull();
      expect(result.routes).toBeNull();
    });

    it('does not call groupByDirection when places is MOCK', async () => {
      // groupByDirection sits inside the non-mock branch, so it should not run.
      const { service, placesProvider } = build({ places: MOCK });
      await service.buildLocationIntelligence(DTO);

      expect(placesProvider.groupByDirection).not.toHaveBeenCalled();
    });
  });
});

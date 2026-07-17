\# Emergency Intelligence Engine — As Built



\*\*Status: real orchestration structure, entirely mocked location

providers underneath. Verified by reading all four provider files

directly, not assumed from the service layer.\*\*



\## Why this document exists



`EmergencyIntelligenceService.buildLocationIntelligence()` looks

complete from the outside — it composes seven providers in parallel and

returns a rich, well-structured response. That structure is real.

Almost none of the actual content is. This document exists so that

distinction never gets lost or assumed away.



\## Confirmed real



\- \*\*`DeviceProvider`\*\* — genuinely passes through `speed`, `heading`,

&#x20; `altitude`, `accuracy`, `batteryLevel`, `networkType` exactly as

&#x20; received from the device, with sensible defaults. No fabrication —

&#x20; but also no interpretation: a raw heading of `45` is returned as

&#x20; `45`, not converted to a compass direction.



\## Confirmed mock — all three, same pattern, do not treat as real



\- \*\*`PlacesProvider`\*\* — `providerName: 'MockPlacesProvider'`. Returns

&#x20; four hardcoded fake locations regardless of input coordinates.

\- \*\*`GeocodingProvider`\*\* — `providerName: 'MockGeocodingProvider'`.

&#x20; `reverseGeocode()` returns the identical hardcoded address

&#x20; ("12 Allen Avenue, Ikeja, Lagos") for every coordinate, anywhere on

&#x20; Earth.

\- \*\*`RoutingProvider`\*\* — `providerName: 'MockRoutingProvider'`.

&#x20; `buildSafeRoutes()` takes zero arguments and returns the same three

&#x20; hardcoded destinations (a named hospital, a named police

&#x20; headquarters, a named "safe place") every single time, regardless of

&#x20; where the incident actually is.



\*\*Net effect:\*\* the `surroundings`, `emergencyResources`, and `routes`

sections of every `buildLocationIntelligence()` response are entirely

fabricated. This is more dangerous than an absent feature — a

plausible-looking but wrong hospital name or street could be trusted

by a family member or hospital during a real emergency.



\## Not yet verified — do not assume either way



\- `HospitalProvider`

\- `PoliceProvider`

\- `SafePlaceProvider`



Given three of the seven providers checked so far are confirmed mocks

with an identical self-labeling pattern, treat these three as likely

mocks too until individually confirmed otherwise — but don't assert

that without checking.



\## How the response should represent missing data



When a downstream provider is not real, the response field should be

`null` or an explicit `{ status: 'pending\_integration' }` marker, never

a plausible-looking fabricated value. Do not rename a mock provider to

sound like a resilience fallback and have it activate silently — that

relabels the same problem rather than fixing it. A missing address

should look missing, not confidently wrong.



\## What would need to be built for this to become real



1\. A real geocoding integration (Google Geocoding API — paid beyond a

&#x20;  small free tier — or OpenStreetMap/Nominatim, or a licensed

&#x20;  Nigerian dataset). Provider choice is a deliberate decision to make

&#x20;  when this is actually built, not assumed.

2\. A real places/nearby-facility integration, likely the same provider

&#x20;  as geocoding.

3\. A real routing integration that actually takes the incident's

&#x20;  coordinates as input, unlike the current stub.

4\. Bearing-to-compass conversion for direction-of-travel — does not

&#x20;  exist anywhere yet, cheap to build correctly once needed.

5\. Continuous location history, not a single snapshot, for genuine

&#x20;  direction-of-travel (see Sprint 10 in the roadmap).



\## Direct implication for the mobile SOS screen (Sprint 9)



The mobile SOS activation screen sends only raw, device-sourced

`latitude`, `longitude`, and `accuracy` to the backend. It does not

call, display, or rely on `address`, `crossStreet`, `emergencyResources`,

or `routes` from `buildLocationIntelligence()` in any form until the

corresponding provider is replaced with a real integration.



\## Explicit rule



\*\*None of the fabricated fields (address, cross-street, nearby

hospitals/police, suggested routes) appear on the website, in the

mobile app, or in any external communication, in any form including a

"Planned" tag, until genuinely built and verified.\*\*


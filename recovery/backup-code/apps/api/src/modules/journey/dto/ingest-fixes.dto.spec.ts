// class-validator and class-transformer decorators call Reflect.getMetadata.
// Nest loads this polyfill for us at runtime and @nestjs/testing pulls it
// into specs that use a testing module - this spec uses neither, so it must
// import it itself or the whole suite dies at LOAD with
// "Reflect.getMetadata is not a function".
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IngestFixesDto } from './ingest-fixes.dto';

// A REAL v4 UUID. The version nibble must be 4 and the variant nibble
// must be 8, 9, a or b - a plausible looking 8-4-4-4-12 hex string is not
// enough, and IsUUID rejected exactly that on the first run.
const SESSION = '3f1c2b4a-5d6e-4f7a-8b9c-0d1e2f3a4b5c';

function build(overrides: Record<string, unknown>) {
  return {
    sessionId: SESSION,
    fixes: [
      {
        idempotencyKey: 'key-1',
        source: 'foreground',
        latitude: 6.5244,
        longitude: 3.3792,
        recordedAt: '2026-07-27T10:00:00.000Z',
        ...overrides,
      },
    ],
  };
}

async function check(raw: Record<string, unknown>) {
  const dto = plainToInstance(IngestFixesDto, raw);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

describe('IngestFixesDto', () => {
  it('accepts a well formed fix', async () => {
    const { errors } = await check(build({}));
    expect(errors).toHaveLength(0);
  });

  // The point of this milestone for issue 17.6.
  it('turns the -1 GPS heading sentinel into null instead of rejecting it', async () => {
    const { dto, errors } = await check(build({ heading: -1 }));
    expect(errors).toHaveLength(0);
    expect(dto.fixes[0]?.heading).toBeNull();
  });

  it('accepts a real heading', async () => {
    const { dto, errors } = await check(build({ heading: 87.5 }));
    expect(errors).toHaveLength(0);
    expect(dto.fixes[0]?.heading).toBe(87.5);
  });

  // Control: the transform must not swallow every out of range value.
  it('still rejects a negative heading that is not the sentinel', async () => {
    const { errors } = await check(build({ heading: -20 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a heading above 360', async () => {
    const { errors } = await check(build({ heading: 400 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an out of range latitude', async () => {
    const { errors } = await check(build({ latitude: 91 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a source the SOS path reserves', async () => {
    const { errors } = await check(build({ source: 'activation' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an unparseable recordedAt', async () => {
    const { errors } = await check(build({ recordedAt: 'not-a-date' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an undeclared field, because forbidNonWhitelisted is live', async () => {
    const { errors } = await check(build({ altitude: 12 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a sessionId that is not a UUID', async () => {
    const raw = build({});
    raw.sessionId = 'session-1';
    const { errors } = await check(raw);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an empty batch', async () => {
    const raw = build({});
    raw.fixes = [];
    const { errors } = await check(raw);
    expect(errors.length).toBeGreaterThan(0);
  });
});

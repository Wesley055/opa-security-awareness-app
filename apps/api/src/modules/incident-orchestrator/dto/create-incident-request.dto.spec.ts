import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateIncidentRequestDto } from './create-incident-request.dto';
import { CreateIncidentDto } from '../../incidents/dto/create-incident.dto';

describe.each([CreateIncidentRequestDto, CreateIncidentDto])('paired location %p', (Dto) => {
  const base = Dto === CreateIncidentDto ? { trigger: 'VOICE_HELP_HELP' } : { triggerType: 'VOICE', mode: 'SILENT' };
  it.each([{}, { latitude: 6.5, longitude: 3.3 }, { latitude: 0, longitude: 0 }])('accepts valid pair or omitted pair %p', async (coords) => {
    expect(await validate(Object.assign(new Dto(), base, coords))).toHaveLength(0);
  });
  it.each([
    { latitude: 6.5 }, { longitude: 3.3 }, { latitude: 91, longitude: 3.3 },
    { latitude: 6.5, longitude: 181 }, { latitude: null, longitude: null },
    { latitude: 'invalid', longitude: 3.3 }, { latitude: NaN, longitude: 3.3 },
  ])('rejects partial or invalid pair %p', async (coords) => {
    expect((await validate(Object.assign(new Dto(), base, coords))).length).toBeGreaterThan(0);
  });
});

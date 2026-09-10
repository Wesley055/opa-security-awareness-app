import { incidentScope } from './incident-scope';
const active = {
  role: 'FACILITY_OPERATOR',
  facilityId: 'a',
  isActive: true,
  accountStatus: 'ACTIVE',
};
describe('incident scope', () => {
  it.each(['a', 'b'])(
    'binds operator to facility %s plus owned incidents',
    (facilityId) => {
      expect(incidentScope('operator', { ...active, facilityId })).toEqual({
        OR: [{ userId: 'operator' }, { facilityId }],
      });
    },
  );
  it.each(['USER', 'RESPONDER', 'FACILITY_ADMIN'])(
    'does not grant operator access to %s',
    (role) => {
      expect(incidentScope('owner', { ...active, role })).toEqual({
        userId: 'owner',
      });
    },
  );
  it('retains the explicit platform ADMIN incident override', () =>
    expect(incidentScope('admin', { ...active, role: 'ADMIN' })).toEqual({}));
  it('removed membership grants ownership only', () =>
    expect(incidentScope('operator', { ...active, facilityId: null })).toEqual({
      userId: 'operator',
    }));
  it.each([
    null,
    { ...active, isActive: false },
    { ...active, accountStatus: 'PENDING_ACTIVATION' },
    { ...active, role: 'ADMIN', isActive: false },
  ])('fails closed for unavailable account state %#', (actor) => {
    expect(incidentScope('operator', actor)).toEqual({ id: { in: [] } });
  });
});

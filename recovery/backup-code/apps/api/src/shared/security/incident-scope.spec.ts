import { incidentScope } from './incident-scope';
const active = {
  membershipState: 'ACTIVE',
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
  it.each(['USER', 'RESPONDER', 'TECHNICAL_SUPPORT'])(
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
  it('grants Facility Admin own-facility oversight only',()=>expect(incidentScope('admin',{...active,role:'FACILITY_ADMIN'})).toEqual({OR:[{userId:'admin'},{facilityId:'a'}]}));
  it.each(['SUSPENDED','REVOKED',undefined])('never derives tenant authority from unavailable membership %s',membershipState=>expect(incidentScope('owner',{...active,membershipState})).toEqual({userId:'owner'}));
});

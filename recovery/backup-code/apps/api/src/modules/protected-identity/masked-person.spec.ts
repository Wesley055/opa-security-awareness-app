import { maskedPerson } from './masked-person';
describe('institutional identity defaults', () => {
  it('masks administrator projections and retains opaque identity and lifecycle', () => {
    const input = { id: 'opaque-id', role: 'ADMIN', email: 'private@example.test', phoneNumber: '+14155552671', firstName: 'Private', lastName: 'Person', accountStatus: 'ACTIVE' };
    expect(maskedPerson(input)).toEqual({ id: 'opaque-id', role: 'ADMIN', email: '[protected]', phoneNumber: '[protected]', firstName: '[protected]', lastName: '[protected]', accountStatus: 'ACTIVE' });
    expect(input.email).toBe('private@example.test');
  });
});

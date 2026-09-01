import { FacilityAdminResidentProvisioningController } from './facility-admin-resident-provisioning.controller';

describe('FacilityAdminResidentProvisioningController', () => {
  it('lists residents using the facility id established by FacilityAdminGuard', async () => {
    const provisioning = {
      listFacilityMembers: jest.fn().mockResolvedValue({
        facility: {
          id: 'facility-1',
          name: 'OPA Demo Estate',
          isActive: true,
        },
        operators: [
          {
            id: 'operator-1',
            firstName: 'Ada',
            lastName: 'Operator',
          },
        ],
        residents: [
          {
            id: 'resident-1',
            firstName: 'Sam',
            lastName: 'Resident',
          },
        ],
      }),
    };

    const controller = new FacilityAdminResidentProvisioningController(
      provisioning as never,
    );

    const result = await controller.listResidents({
      facilityAdminFacilityId: 'facility-1',
    } as never);

    expect(provisioning.listFacilityMembers).toHaveBeenCalledWith(
      'facility-1',
    );

    expect(result).toEqual({
      facility: {
        id: 'facility-1',
        name: 'OPA Demo Estate',
        isActive: true,
      },
      residents: [
        {
          id: 'resident-1',
          firstName: 'Sam',
          lastName: 'Resident',
        },
      ],
    });

    expect(result).not.toHaveProperty('operators');
  });
});

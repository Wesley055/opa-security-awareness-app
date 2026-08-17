import { OperatorMembersController } from './operator-members.controller';

describe('OperatorMembersController', () => {
  it('uses the facility id established by OperatorFacilityGuard', async () => {
    const facilitiesService = {
      listMembersForOperator: jest.fn().mockResolvedValue({
        facility: { id: 'facility-1', name: 'OPA Demo Estate' },
        operators: [],
        residents: [],
      }),
    };

    const controller = new OperatorMembersController(facilitiesService as never);

    // The request carries operatorFacilityId and nothing else the handler
    // reads. A facility id arriving any other way would be browser-supplied.
    await controller.listMyFacilityMembers({
      operatorFacilityId: 'facility-1',
    } as never);

    expect(facilitiesService.listMembersForOperator).toHaveBeenCalledWith(
      'facility-1',
    );
  });
});

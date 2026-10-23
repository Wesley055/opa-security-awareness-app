import { ForbiddenException } from "@nestjs/common";
import { OperatorMembersController } from "./operator-members.controller";
describe("Operator directory boundary", () => {
  it("denies enumeration before reading members", () => {
    const service = { listMembersForOperator: jest.fn() };
    const controller = new OperatorMembersController(service as never);
    expect(() => controller.listMyFacilityMembers({ operatorFacilityId: "facility" } as never, { page: 0 })).toThrow(ForbiddenException);
    expect(service.listMembersForOperator).not.toHaveBeenCalled();
  });
});

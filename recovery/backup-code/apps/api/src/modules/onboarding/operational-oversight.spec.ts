import {
  operationalExceptions,
  type ResponsePolicy,
} from "./operational-oversight.service";
const policy: ResponsePolicy = {
  acknowledgementSeconds: 60,
  dispatchSeconds: 120,
  progressSeconds: 180,
  unattendedSeconds: 300,
  closureSeconds: 3600,
  version: 1,
};
const start = new Date("2026-01-01T00:00:00Z");
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
const event = (type: string, seconds: number) => ({
  type,
  occurredAt: at(seconds),
});
describe("objective operational exceptions", () => {
  it("does not report a milestone before its threshold", () =>
    expect(operationalExceptions(start, [], policy, at(59))).toEqual([]));
  it("records acknowledgement overdue at the exact threshold", () =>
    expect(operationalExceptions(start, [], policy, at(60))).toEqual([
      "ACKNOWLEDGEMENT_OVERDUE",
    ]));
  it("SEEN is not acknowledgement", () =>
    expect(
      operationalExceptions(
        start,
        [event("OPERATOR_SEEN", 20)],
        policy,
        at(60),
      ),
    ).toEqual(["ACKNOWLEDGEMENT_OVERDUE"]));
  it("acknowledgement starts the dispatch deadline", () =>
    expect(
      operationalExceptions(
        start,
        [event("OPERATOR_ACKNOWLEDGED", 30)],
        policy,
        at(150),
      ),
    ).toEqual(["DISPATCH_OVERDUE"]));
  it("dispatch starts the progress deadline", () =>
    expect(
      operationalExceptions(
        start,
        [event("OPERATOR_ACKNOWLEDGED", 30), event("OPERATOR_DISPATCHED", 40)],
        policy,
        at(220),
      ),
    ).toEqual(["RESPONSE_PROGRESS_OVERDUE"]));
  it("latest progress advances its deadline even with unordered input", () =>
    expect(
      operationalExceptions(
        start,
        [
          event("OPERATOR_ACKNOWLEDGED", 30),
          event("OPERATOR_DISPATCHED", 40),
          event("OPERATOR_RESPONSE_PROGRESS", 210),
          event("OPERATOR_RESPONSE_PROGRESS", 100),
        ],
        policy,
        at(300),
      ),
    ).toEqual([]));
  it("records unattended as an objective distinct milestone", () =>
    expect(operationalExceptions(start, [], policy, at(300))).toEqual([
      "ACKNOWLEDGEMENT_OVERDUE",
      "UNATTENDED_INCIDENT",
    ]));
  it("closure deadline applies even with recorded acknowledgement", () =>
    expect(
      operationalExceptions(
        start,
        [
          event("OPERATOR_ACKNOWLEDGED", 30),
          event("OPERATOR_DISPATCHED", 40),
          event("OPERATOR_RESPONSE_PROGRESS", 3590),
        ],
        policy,
        at(3600),
      ),
    ).toEqual(["CLOSURE_OVERDUE"]));
  it("manual escalation does not pretend acknowledgement or dispatch happened", () =>
    expect(
      operationalExceptions(
        start,
        [event("OPERATOR_ESCALATION", 30)],
        policy,
        at(300),
      ),
    ).toEqual(["ACKNOWLEDGEMENT_OVERDUE", "UNATTENDED_INCIDENT"]));
});

export const facility = "11111111-1111-4111-8111-111111111111";
export const incident = "22222222-2222-4222-8222-222222222222";
export const supportCase = "33333333-3333-4333-8333-333333333333";
export const emergencyFixture = () => ({
  facilityId: facility,
  serverTime: "2026-10-04T00:00:05.000Z",
  hasMore: false,
  incidents: [
    {
      id: incident,
      status: "OPEN",
      emergencyStartedAt: "2026-10-04T00:00:00.000Z",
      acknowledged: true,
      lastOperationalEvent: "OPERATOR_ACKNOWLEDGED",
      lastFixReceivedAt: null,
      trackingState: "AWAITING_FIRST_FIX",
    },
  ],
});

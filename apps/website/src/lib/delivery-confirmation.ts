/** Proposed bounded reader contract. No send-provider response is a delivery receipt. */
export type DeliveryAttempt = {
 id:string; channel:'SMS'|'EMAIL'|'PUSH'|'WHATSAPP'|'VOICE'; recipientMasked:string;
 state:'QUEUED'|'PROVIDER_ACCEPTED'|'DELIVERED'|'FAILED'; providerReference:string|null;
 failureClass:'TRANSIENT'|'PERMANENT'|'EXPIRED'|'REJECTED'|'UNKNOWN'|null; attemptCount:number;
 queuedAt:string; acceptedAt:string|null; deliveredAt:string|null; failedAt:string|null; updatedAt:string;
 deliveryProof:{source:string;receivedAt:string}|null;
};
export type DeliverySnapshot={state:'READY';incidentId:string;asOf:string;attempts:DeliveryAttempt[];nextCursor:string|null}|{state:'BACKEND_BLOCKED'};

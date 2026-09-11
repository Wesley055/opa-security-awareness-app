/** Invalidates in-flight background work when the signed-in account changes. */
let epoch = 0;
export function authSessionEpoch(): number { return epoch; }
export function advanceAuthSessionEpoch(): void { epoch += 1; }

package com.opasafety.protection

internal object ProtectionTriggerClaimBridgePayload {

    fun from(
        claim: ProtectionTriggerClaim,
    ): Map<String, Any> {
        val payload =
            ProtectionTriggerBridgePayload
                .from(claim.trigger)
                .toMutableMap()

        /*
         * claimToken is opaque capability metadata used only to prove
         * ownership when releasing or acknowledging this FIFO head.
         *
         * ownerId remains native-only and must not cross the JS bridge.
         */
        payload["claimToken"] =
            claim.claimToken

        return payload
    }
}
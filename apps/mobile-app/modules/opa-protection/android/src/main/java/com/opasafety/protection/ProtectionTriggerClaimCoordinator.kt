package com.opasafety.protection

import java.util.UUID

internal data class ProtectionTriggerClaim(
    val trigger: ProtectionEmergencyTrigger,
    val ownerId: String,
    val claimToken: String,
)

internal class ProtectionTriggerClaimCoordinator {

    private var activeClaim: ProtectionTriggerClaim? = null

    @Synchronized
    fun claim(
        trigger: ProtectionEmergencyTrigger,
        ownerId: String,
    ): ProtectionTriggerClaim? {
        if (ownerId.isBlank()) {
            return null
        }

        if (activeClaim != null) {
            return null
        }

        val claim =
            ProtectionTriggerClaim(
                trigger = trigger,
                ownerId = ownerId,
                claimToken = UUID.randomUUID().toString(),
            )

        activeClaim = claim

        return claim
    }

    @Synchronized
    fun release(
        triggerId: String,
        claimToken: String,
    ): Boolean {
        val current = activeClaim ?: return false

        if (
            triggerId.isBlank() ||
            claimToken.isBlank() ||
            current.trigger.id != triggerId ||
            current.claimToken != claimToken
        ) {
            return false
        }

        activeClaim = null

        return true
    }
}
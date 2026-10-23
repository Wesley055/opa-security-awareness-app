package com.opasafety.protection

internal object ProtectionPendingTriggerClaimPolicy {

    internal data class AcknowledgeResult(
        val queue: List<ProtectionEmergencyTrigger>,
        val removed: Boolean,
    )

    fun claimHead(
        queue: List<ProtectionEmergencyTrigger>,
        ownerId: String,
        coordinator: ProtectionTriggerClaimCoordinator,
    ): ProtectionTriggerClaim? {
        val head = queue.firstOrNull() ?: return null

        return coordinator.claim(
            trigger = head,
            ownerId = ownerId,
        )
    }

    fun acknowledgeClaimedHead(
        queue: List<ProtectionEmergencyTrigger>,
        triggerId: String,
        claimToken: String,
        coordinator: ProtectionTriggerClaimCoordinator,
    ): AcknowledgeResult {
        val head = queue.firstOrNull()
            ?: return AcknowledgeResult(
                queue = queue,
                removed = false,
            )

        if (
            triggerId.isBlank() ||
            claimToken.isBlank() ||
            head.id != triggerId
        ) {
            return AcknowledgeResult(
                queue = queue,
                removed = false,
            )
        }

        val released =
            coordinator.release(
                triggerId = triggerId,
                claimToken = claimToken,
            )

        if (!released) {
            return AcknowledgeResult(
                queue = queue,
                removed = false,
            )
        }

        return AcknowledgeResult(
            queue = queue.drop(1),
            removed = true,
        )
    }
}
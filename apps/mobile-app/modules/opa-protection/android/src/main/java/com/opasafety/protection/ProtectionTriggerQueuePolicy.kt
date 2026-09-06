package com.opasafety.protection

internal object ProtectionTriggerQueuePolicy {

    const val MAX_PENDING_TRIGGERS = 8

    enum class EnqueueStatus {
        APPENDED,
        ALREADY_PRESENT,
        SATURATED,
        INVALID,
    }

    data class EnqueueResult(
        val status: EnqueueStatus,
        val queue: List<ProtectionEmergencyTrigger>,
    )

    data class AcknowledgeResult(
        val removed: Boolean,
        val queue: List<ProtectionEmergencyTrigger>,
    )

    fun isValid(
        trigger: ProtectionEmergencyTrigger,
    ): Boolean {
        if (
            trigger.id.isBlank() ||
            trigger.timestamp <= 0L
        ) {
            return false
        }

        return when (trigger.type) {
            ProtectionTriggerType.VOICE ->
                !trigger.phrase.isNullOrBlank() &&
                    !trigger.provider.isNullOrBlank()

            ProtectionTriggerType.SOS_BUTTON ->
                true
        }
    }

    fun enqueue(
        queue: List<ProtectionEmergencyTrigger>,
        trigger: ProtectionEmergencyTrigger,
    ): EnqueueResult {
        if (!isValid(trigger)) {
            return EnqueueResult(
                status = EnqueueStatus.INVALID,
                queue = queue,
            )
        }

        if (queue.any { it.id == trigger.id }) {
            return EnqueueResult(
                status = EnqueueStatus.ALREADY_PRESENT,
                queue = queue,
            )
        }

        if (queue.size >= MAX_PENDING_TRIGGERS) {
            return EnqueueResult(
                status = EnqueueStatus.SATURATED,
                queue = queue,
            )
        }

        return EnqueueResult(
            status = EnqueueStatus.APPENDED,
            queue = queue + trigger,
        )
    }

    fun acknowledge(
        queue: List<ProtectionEmergencyTrigger>,
        triggerId: String,
    ): AcknowledgeResult {
        if (triggerId.isBlank()) {
            return AcknowledgeResult(
                removed = false,
                queue = queue,
            )
        }

        val index =
            queue.indexOfFirst {
                it.id == triggerId
            }

        if (index < 0) {
            return AcknowledgeResult(
                removed = false,
                queue = queue,
            )
        }

        return AcknowledgeResult(
            removed = true,
            queue =
                queue.filterIndexed { currentIndex, _ ->
                    currentIndex != index
                },
        )
    }

    fun sanitize(
        queue: List<ProtectionEmergencyTrigger>,
    ): List<ProtectionEmergencyTrigger> {
        val seenIds =
            mutableSetOf<String>()

        val sanitized =
            mutableListOf<ProtectionEmergencyTrigger>()

        for (trigger in queue) {
            if (!isValid(trigger)) {
                continue
            }

            if (!seenIds.add(trigger.id)) {
                continue
            }

            sanitized.add(trigger)

            if (
                sanitized.size >=
                MAX_PENDING_TRIGGERS
            ) {
                break
            }
        }

        return sanitized
    }
}

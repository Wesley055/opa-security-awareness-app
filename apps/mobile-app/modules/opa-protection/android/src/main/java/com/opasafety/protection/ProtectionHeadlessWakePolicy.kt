package com.opasafety.protection

/**
 * Determines whether a durable native emergency trigger should request a
 * Headless JS wake.
 *
 * Both VOICE and notification SOS need execution when React is backgrounded
 * or locked. Wakes carry no ownership: consumers must atomically claim the
 * same durable FIFO head before processing.
 */
internal object ProtectionHeadlessWakePolicy {

    fun shouldWake(
        triggerType: ProtectionTriggerType,
        publishStatus: ProtectionTriggerQueuePolicy.EnqueueStatus,
    ): Boolean {
        return when (triggerType) {
            ProtectionTriggerType.VOICE,
            ProtectionTriggerType.SOS_BUTTON -> when (publishStatus) {
                ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED,
                ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT,
                -> true

                ProtectionTriggerQueuePolicy.EnqueueStatus.SATURATED,
                ProtectionTriggerQueuePolicy.EnqueueStatus.INVALID,
                -> false
            }
        }
    }
}
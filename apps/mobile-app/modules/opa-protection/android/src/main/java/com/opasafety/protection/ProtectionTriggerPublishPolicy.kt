package com.opasafety.protection

/**
 * Defines whether a durable-queue enqueue outcome should wake the
 * process-local React trigger listener.
 *
 * VOICE retains the existing proven native/event lifecycle.
 *
 * SOS_BUTTON is deliberately excluded from the process-local listener path.
 * Notification SOS has a dedicated Headless JS wake after durable persistence;
 * allowing both consumers to wake for the same SOS creates an ownership race
 * for the single atomic FIFO claim.
 *
 * APPENDED / ALREADY_PRESENT:
 *   Wake only when the durable trigger belongs to the VOICE lifecycle.
 *
 * SATURATED / INVALID:
 *   The submitted trigger is not represented by the durable queue and must
 *   never generate a process-local wake.
 */
internal object ProtectionTriggerPublishPolicy {

    fun shouldWakeListener(
        triggerType: ProtectionTriggerType,
        status: ProtectionTriggerQueuePolicy.EnqueueStatus,
    ): Boolean {
        if (triggerType != ProtectionTriggerType.VOICE) {
            return false
        }

        return when (status) {
            ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED,
            ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT,
            -> true

            ProtectionTriggerQueuePolicy.EnqueueStatus.SATURATED,
            ProtectionTriggerQueuePolicy.EnqueueStatus.INVALID,
            -> false
        }
    }
}
package com.opasafety.protection

/**
 * Defines whether a durable-queue enqueue outcome should wake the
 * process-local trigger listener.
 *
 * APPENDED:
 *   The trigger was newly accepted into the durable queue.
 *
 * ALREADY_PRESENT:
 *   The stable trigger ID is already represented durably. Re-waking the
 *   listener is intentional because an earlier process-local wake may have
 *   been missed while the durable record remains pending.
 *
 * SATURATED / INVALID:
 *   The submitted trigger is not represented by the durable queue, so it
 *   must not generate a process-local wake.
 */
internal object ProtectionTriggerPublishPolicy {

    fun shouldWakeListener(
        status: ProtectionTriggerQueuePolicy.EnqueueStatus,
    ): Boolean {
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
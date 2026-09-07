package com.opasafety.protection

/**
 * Determines whether a durable native emergency trigger should request a
 * Headless JS wake.
 *
 * Lock-screen notification SOS requires this wake because persisting the
 * record alone does not guarantee that JavaScript is running.
 *
 * VOICE deliberately remains on its existing proven native/event lifecycle.
 * This policy must not create a second execution path for voice detections.
 */
internal object ProtectionHeadlessWakePolicy {

    fun shouldWake(
        triggerType: ProtectionTriggerType,
        publishStatus: ProtectionTriggerQueuePolicy.EnqueueStatus,
    ): Boolean {
        if (triggerType != ProtectionTriggerType.SOS_BUTTON) {
            return false
        }

        return when (publishStatus) {
            ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED,
            ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT,
            -> true

            ProtectionTriggerQueuePolicy.EnqueueStatus.SATURATED,
            ProtectionTriggerQueuePolicy.EnqueueStatus.INVALID,
            -> false
        }
    }
}
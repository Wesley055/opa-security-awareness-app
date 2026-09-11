package com.opasafety.protection

import android.content.Context

/**
 * Provider-neutral emergency trigger types owned by OPA Protection.
 *
 * Missing persisted type values from vc13 and earlier are interpreted as
 * VOICE by the persistence boundary for backward compatibility.
 */
internal enum class ProtectionTriggerType {
    VOICE,
    SOS_BUTTON;

    companion object {
        fun fromPersistedValue(
            value: String?,
        ): ProtectionTriggerType? {
            if (value.isNullOrBlank()) {
                return VOICE
            }

            return entries.firstOrNull {
                it.name == value
            }
        }
    }
}

/**
 * Provider-neutral native emergency trigger emitted by OPA Protection.
 *
 * VOICE requires phrase/provider metadata.
 * SOS_BUTTON intentionally carries neither.
 *
 * Provider-specific audio/index objects must never cross this boundary.
 */
internal data class ProtectionEmergencyTrigger(
    val id: String,
    val type: ProtectionTriggerType = ProtectionTriggerType.VOICE,
    val timestamp: Long,
    val phrase: String? = null,
    val provider: String? = null,
    val activationMode: String? = null,
)

/**
 * Temporary source-compatibility alias while the vc13 voice-specific
 * call sites migrate to the generic emergency-trigger contract.
 *
 * Existing voice producers default to type=VOICE.
 */
internal typealias ProtectionVoiceTrigger =
    ProtectionEmergencyTrigger

/**
 * Native protection trigger handoff.
 *
 * Every trigger is persisted before process-local delivery. Persistence is
 * cleared only by an explicit acknowledgement for the exact trigger ID.
 *
 * This object requests execution after persistence, but never owns incident
 * activation or claim ownership. Both execution signals consume the same FIFO.
 */
internal object ProtectionTriggerBus {

    private var listener:
        ((ProtectionEmergencyTrigger) -> Unit)? = null

    @Synchronized
    fun attach(
        listener: (ProtectionEmergencyTrigger) -> Unit,
    ) {
        this.listener = listener
    }

    @Synchronized
    fun detach() {
        listener = null
    }

    fun publish(
        context: Context,
        trigger: ProtectionEmergencyTrigger,
    ): ProtectionTriggerQueuePolicy.EnqueueStatus {
        // Freeze the local choice before durable enqueue; retries never re-read consent.
        val captured = trigger.copy(activationMode = ProtectionActivationModeStore.read(context))
        return publishDurably(
            captured,
            persist = { ProtectionPendingTriggerStore.save(context, captured) },
            wake = { status -> OpaProtectionHeadlessService.requestWake(context, captured.type, status) },
            deliver = { synchronized(this) { listener }?.invoke(captured) },
        )
    }

    // Keep ordering in one production boundary that can be tested without Android services.
    internal fun publishDurably(
        trigger: ProtectionEmergencyTrigger,
        persist: () -> ProtectionTriggerQueuePolicy.EnqueueStatus,
        wake: (ProtectionTriggerQueuePolicy.EnqueueStatus) -> Unit,
        deliver: () -> Unit,
    ): ProtectionTriggerQueuePolicy.EnqueueStatus {
        val status = persist()
        if (ProtectionHeadlessWakePolicy.shouldWake(trigger.type, status)) wake(status)
        if (ProtectionTriggerPublishPolicy.shouldWakeListener(trigger.type, status)) deliver()
        return status
    }
}

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
 * This object does not wake JavaScript and does not own incident activation.
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
    ) {
        val enqueueStatus =
            ProtectionPendingTriggerStore.save(
                context,
                trigger,
            )

        if (
            !ProtectionTriggerPublishPolicy.shouldWakeListener(
                enqueueStatus,
            )
        ) {
            return
        }

        val currentListener =
            synchronized(this) {
                listener
            }

        currentListener?.invoke(trigger)
    }
}

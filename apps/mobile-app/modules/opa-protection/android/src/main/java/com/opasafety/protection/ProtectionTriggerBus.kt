package com.opasafety.protection

import android.content.Context

/**
 * Provider-neutral native trigger emitted by OPA Protection Runtime.
 *
 * Provider-specific audio/index objects must never cross this boundary.
 */
internal data class ProtectionVoiceTrigger(
    val id: String,
    val phrase: String,
    val provider: String,
    val timestamp: Long,
)

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
        ((ProtectionVoiceTrigger) -> Unit)? = null

    @Synchronized
    fun attach(
        listener: (ProtectionVoiceTrigger) -> Unit,
    ) {
        this.listener = listener
    }

    @Synchronized
    fun detach() {
        listener = null
    }

    fun publish(
        context: Context,
        trigger: ProtectionVoiceTrigger,
    ) {
        ProtectionPendingTriggerStore.save(
            context,
            trigger,
        )

        val currentListener =
            synchronized(this) {
                listener
            }

        currentListener?.invoke(trigger)
    }
}
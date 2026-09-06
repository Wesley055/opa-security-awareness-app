package com.opasafety.protection

/**
 * Converts a durable protection trigger into the payload exposed across
 * the native-to-JavaScript bridge.
 *
 * Voice metadata remains present for VOICE triggers. SOS_BUTTON records
 * intentionally contain no synthetic phrase or provider fields.
 */
internal object ProtectionTriggerBridgePayload {

    fun from(
        trigger: ProtectionEmergencyTrigger,
    ): Map<String, Any> {
        val payload =
            mutableMapOf<String, Any>(
                "id" to trigger.id,
                "type" to trigger.type.name,
                "timestamp" to trigger.timestamp.toDouble(),
            )

        if (trigger.type == ProtectionTriggerType.VOICE) {
            trigger.phrase?.let {
                payload["phrase"] = it
            }

            trigger.provider?.let {
                payload["provider"] = it
            }
        }

        return payload
    }
}
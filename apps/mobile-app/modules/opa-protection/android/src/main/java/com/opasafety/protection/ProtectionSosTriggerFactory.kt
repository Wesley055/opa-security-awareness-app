package com.opasafety.protection

/**
 * Creates the durable emergency record produced by an explicit SOS action.
 *
 * The caller owns ID generation so tests can prove stable identity behavior.
 * SOS_BUTTON records intentionally carry no voice phrase/provider metadata.
 */
internal object ProtectionSosTriggerFactory {

    fun create(
        timestamp: Long,
        id: String,
    ): ProtectionEmergencyTrigger {
        return ProtectionEmergencyTrigger(
            id = id,
            type = ProtectionTriggerType.SOS_BUTTON,
            timestamp = timestamp,
        )
    }
}
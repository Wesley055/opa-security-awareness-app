package com.opasafety.protection
import org.junit.Assert.*
import org.junit.Test

class ProtectionSilentSosTest {
    @Test fun queuedModeSurvivesRestartAndBridge() {
        for (mode in listOf("SILENT", "STANDARD")) {
            val input = ProtectionEmergencyTrigger(id = "one", type = ProtectionTriggerType.SOS_BUTTON, timestamp = 1L, activationMode = mode)
            val restored = ProtectionTriggerPersistenceCodec.decode(ProtectionTriggerPersistenceCodec.encode(listOf(input))).single()
            assertEquals(mode, restored.activationMode)
            assertEquals(mode, ProtectionTriggerBridgePayload.from(restored)["activationMode"])
            assertEquals(ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT, ProtectionTriggerQueuePolicy.enqueue(listOf(restored), input.copy(activationMode = "STANDARD")).status)
        }
    }
    @Test fun legacyQueueRemainsReadable() {
        val restored = ProtectionTriggerPersistenceCodec.decode("""[{"id":"legacy","type":"SOS_BUTTON","timestamp":1}]""").single()
        assertNull(restored.activationMode)
    }
}

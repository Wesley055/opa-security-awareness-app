package com.opasafety.protection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionTriggerBridgePayloadTest {

    @Test
    fun `voice payload preserves type and voice metadata`() {
        val payload =
            ProtectionTriggerBridgePayload.from(
                ProtectionEmergencyTrigger(
                    id = "voice-1",
                    type = ProtectionTriggerType.VOICE,
                    timestamp = 1787682338000L,
                    phrase = "HELP HELP",
                    provider = "picovoice_porcupine",
                ),
            )

        assertEquals("voice-1", payload["id"])
        assertEquals("VOICE", payload["type"])
        assertEquals(
            1787682338000.0,
            payload["timestamp"],
        )
        assertEquals("HELP HELP", payload["phrase"])
        assertEquals(
            "picovoice_porcupine",
            payload["provider"],
        )
    }

    @Test
    fun `sos payload does not invent voice metadata`() {
        val payload =
            ProtectionTriggerBridgePayload.from(
                ProtectionEmergencyTrigger(
                    id = "sos-1",
                    type = ProtectionTriggerType.SOS_BUTTON,
                    timestamp = 1787682338001L,
                ),
            )

        assertEquals("sos-1", payload["id"])
        assertEquals("SOS_BUTTON", payload["type"])
        assertEquals(
            1787682338001.0,
            payload["timestamp"],
        )

        assertFalse(payload.containsKey("phrase"))
        assertFalse(payload.containsKey("provider"))
    }

    @Test
    fun `every bridge payload exposes durable trigger identity`() {
        val payload =
            ProtectionTriggerBridgePayload.from(
                ProtectionEmergencyTrigger(
                    id = "sos-2",
                    type = ProtectionTriggerType.SOS_BUTTON,
                    timestamp = 1787682338002L,
                ),
            )

        assertTrue(payload.containsKey("id"))
        assertTrue(payload.containsKey("type"))
        assertTrue(payload.containsKey("timestamp"))
    }
}
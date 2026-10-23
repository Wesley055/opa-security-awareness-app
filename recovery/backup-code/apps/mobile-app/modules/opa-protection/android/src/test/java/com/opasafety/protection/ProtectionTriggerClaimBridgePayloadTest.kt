package com.opasafety.protection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionTriggerClaimBridgePayloadTest {

    @Test
    fun `claim payload preserves trigger envelope and exposes opaque ownership token`() {
        val trigger =
            ProtectionEmergencyTrigger(
                id = "sos-1",
                type = ProtectionTriggerType.SOS_BUTTON,
                timestamp = 1_787_682_337_000L,
            )

        val claim =
            ProtectionTriggerClaim(
                trigger = trigger,
                ownerId = "foreground",
                claimToken = "claim-token-1",
            )

        val payload =
            ProtectionTriggerClaimBridgePayload.from(claim)

        assertEquals("sos-1", payload["id"])
        assertEquals("SOS_BUTTON", payload["type"])
        assertEquals(
            1_787_682_337_000L.toDouble(),
            payload["timestamp"],
        )
        assertEquals(
            "claim-token-1",
            payload["claimToken"],
        )
    }

    @Test
    fun `claim payload does not expose native owner identity`() {
        val trigger =
            ProtectionEmergencyTrigger(
                id = "sos-1",
                type = ProtectionTriggerType.SOS_BUTTON,
                timestamp = 1_787_682_337_000L,
            )

        val claim =
            ProtectionTriggerClaim(
                trigger = trigger,
                ownerId = "headless",
                claimToken = "claim-token-1",
            )

        val payload =
            ProtectionTriggerClaimBridgePayload.from(claim)

        assertFalse(payload.containsKey("ownerId"))
        assertTrue(payload.containsKey("claimToken"))
    }

    @Test
    fun `voice claim preserves existing voice metadata`() {
        val trigger =
            ProtectionEmergencyTrigger(
                id = "voice-1",
                type = ProtectionTriggerType.VOICE,
                timestamp = 1_787_682_337_000L,
                phrase = "HELP HELP",
                provider = "picovoice_porcupine",
            )

        val claim =
            ProtectionTriggerClaim(
                trigger = trigger,
                ownerId = "foreground",
                claimToken = "claim-token-2",
            )

        val payload =
            ProtectionTriggerClaimBridgePayload.from(claim)

        assertEquals("voice-1", payload["id"])
        assertEquals("VOICE", payload["type"])
        assertEquals("HELP HELP", payload["phrase"])
        assertEquals(
            "picovoice_porcupine",
            payload["provider"],
        )
        assertEquals(
            "claim-token-2",
            payload["claimToken"],
        )
    }
}
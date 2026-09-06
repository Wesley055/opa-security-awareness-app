package com.opasafety.protection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionTriggerPersistenceCodecTest {

    @Test
    fun `vc13 record without type decodes as voice`() {
        val encoded =
            """
            [
              {
                "id":"voice-vc13-1",
                "phrase":"HELP HELP",
                "provider":"picovoice_porcupine",
                "timestamp":1787682337000
              }
            ]
            """.trimIndent()

        val decoded =
            ProtectionTriggerPersistenceCodec.decode(encoded)

        assertEquals(1, decoded.size)

        val trigger = decoded.single()

        assertEquals("voice-vc13-1", trigger.id)
        assertEquals(ProtectionTriggerType.VOICE, trigger.type)
        assertEquals(1787682337000L, trigger.timestamp)
        assertEquals("HELP HELP", trigger.phrase)
        assertEquals("picovoice_porcupine", trigger.provider)
    }

    @Test
    fun `explicit vc14 voice record decodes as voice`() {
        val encoded =
            """
            [
              {
                "id":"voice-vc14-1",
                "type":"VOICE",
                "phrase":"HELP HELP",
                "provider":"picovoice_porcupine",
                "timestamp":1787682337001
              }
            ]
            """.trimIndent()

        val decoded =
            ProtectionTriggerPersistenceCodec.decode(encoded)

        assertEquals(
            ProtectionTriggerType.VOICE,
            decoded.single().type,
        )
    }

    @Test
    fun `sos button decodes without voice metadata`() {
        val encoded =
            """
            [
              {
                "id":"sos-1",
                "type":"SOS_BUTTON",
                "timestamp":1787682337002
              }
            ]
            """.trimIndent()

        val decoded =
            ProtectionTriggerPersistenceCodec.decode(encoded)

        assertEquals(1, decoded.size)

        val trigger = decoded.single()

        assertEquals("sos-1", trigger.id)
        assertEquals(
            ProtectionTriggerType.SOS_BUTTON,
            trigger.type,
        )
        assertEquals(1787682337002L, trigger.timestamp)
        assertNull(trigger.phrase)
        assertNull(trigger.provider)
    }

    @Test
    fun `unknown type is skipped without dropping valid neighbors`() {
        val encoded =
            """
            [
              {
                "id":"voice-1",
                "type":"VOICE",
                "phrase":"HELP HELP",
                "provider":"picovoice_porcupine",
                "timestamp":1787682337003
              },
              {
                "id":"future-1",
                "type":"FUTURE_TRIGGER",
                "timestamp":1787682337004
              },
              {
                "id":"sos-1",
                "type":"SOS_BUTTON",
                "timestamp":1787682337005
              }
            ]
            """.trimIndent()

        val decoded =
            ProtectionTriggerPersistenceCodec.decode(encoded)

        assertEquals(
            listOf("voice-1", "sos-1"),
            decoded.map { it.id },
        )
    }

    @Test
    fun `encoder writes explicit type for voice`() {
        val encoded =
            ProtectionTriggerPersistenceCodec.encode(
                listOf(
                    ProtectionEmergencyTrigger(
                        id = "voice-1",
                        type = ProtectionTriggerType.VOICE,
                        timestamp = 1787682337006L,
                        phrase = "HELP HELP",
                        provider = "picovoice_porcupine",
                    ),
                ),
            )

        assertTrue(encoded.contains("\"type\":\"VOICE\""))
        assertTrue(encoded.contains("\"phrase\":\"HELP HELP\""))
        assertTrue(
            encoded.contains(
                "\"provider\":\"picovoice_porcupine\"",
            ),
        )
    }

    @Test
    fun `encoder writes sos type without inventing voice metadata`() {
        val encoded =
            ProtectionTriggerPersistenceCodec.encode(
                listOf(
                    ProtectionEmergencyTrigger(
                        id = "sos-1",
                        type = ProtectionTriggerType.SOS_BUTTON,
                        timestamp = 1787682337007L,
                    ),
                ),
            )

        assertTrue(
            encoded.contains("\"type\":\"SOS_BUTTON\""),
        )
        assertFalse(encoded.contains("\"phrase\""))
        assertFalse(encoded.contains("\"provider\""))
    }

    @Test
    fun `malformed top level payload decodes as empty queue`() {
        assertTrue(
            ProtectionTriggerPersistenceCodec
                .decode("not-json")
                .isEmpty(),
        )
    }
}
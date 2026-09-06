package com.opasafety.protection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionTriggerQueuePolicyTest {

    private fun voiceTrigger(
        id: String,
        phrase: String? = "HELP HELP",
        provider: String? = "picovoice_porcupine",
        timestamp: Long = 1_000L,
    ) = ProtectionEmergencyTrigger(
        id = id,
        type = ProtectionTriggerType.VOICE,
        timestamp = timestamp,
        phrase = phrase,
        provider = provider,
    )

    private fun sosTrigger(
        id: String,
        timestamp: Long = 1_000L,
    ) = ProtectionEmergencyTrigger(
        id = id,
        type = ProtectionTriggerType.SOS_BUTTON,
        timestamp = timestamp,
        phrase = null,
        provider = null,
    )

    @Test
    fun `valid voice trigger is valid`() {
        assertTrue(
            ProtectionTriggerQueuePolicy.isValid(
                voiceTrigger("voice-1"),
            ),
        )
    }

    @Test
    fun `voice requires stable id phrase provider and positive timestamp`() {
        assertFalse(
            ProtectionTriggerQueuePolicy.isValid(
                voiceTrigger(id = ""),
            ),
        )
        assertFalse(
            ProtectionTriggerQueuePolicy.isValid(
                voiceTrigger(
                    id = "voice-1",
                    phrase = null,
                ),
            ),
        )
        assertFalse(
            ProtectionTriggerQueuePolicy.isValid(
                voiceTrigger(
                    id = "voice-1",
                    phrase = "",
                ),
            ),
        )
        assertFalse(
            ProtectionTriggerQueuePolicy.isValid(
                voiceTrigger(
                    id = "voice-1",
                    provider = null,
                ),
            ),
        )
        assertFalse(
            ProtectionTriggerQueuePolicy.isValid(
                voiceTrigger(
                    id = "voice-1",
                    provider = "",
                ),
            ),
        )
        assertFalse(
            ProtectionTriggerQueuePolicy.isValid(
                voiceTrigger(
                    id = "voice-1",
                    timestamp = 0L,
                ),
            ),
        )
    }

    @Test
    fun `sos button requires only stable id type and positive timestamp`() {
        assertTrue(
            ProtectionTriggerQueuePolicy.isValid(
                sosTrigger("sos-1"),
            ),
        )

        assertFalse(
            ProtectionTriggerQueuePolicy.isValid(
                sosTrigger(id = ""),
            ),
        )

        assertFalse(
            ProtectionTriggerQueuePolicy.isValid(
                sosTrigger(
                    id = "sos-1",
                    timestamp = 0L,
                ),
            ),
        )
    }

    @Test
    fun `invalid enqueue preserves queue`() {
        val existing =
            listOf(
                voiceTrigger("voice-1"),
            )

        val result =
            ProtectionTriggerQueuePolicy.enqueue(
                existing,
                voiceTrigger(id = ""),
            )

        assertEquals(
            ProtectionTriggerQueuePolicy.EnqueueStatus.INVALID,
            result.status,
        )
        assertEquals(existing, result.queue)
    }

    @Test
    fun `stable duplicate id preserves queue regardless of trigger type`() {
        val existing =
            listOf(
                voiceTrigger("stable-1"),
            )

        val result =
            ProtectionTriggerQueuePolicy.enqueue(
                existing,
                sosTrigger(
                    id = "stable-1",
                    timestamp = 2_000L,
                ),
            )

        assertEquals(
            ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT,
            result.status,
        )
        assertEquals(existing, result.queue)
    }

    @Test
    fun `mixed trigger types append preserving fifo order`() {
        val voice = voiceTrigger("voice-1")
        val sos =
            sosTrigger(
                id = "sos-1",
                timestamp = 2_000L,
            )

        val result =
            ProtectionTriggerQueuePolicy.enqueue(
                listOf(voice),
                sos,
            )

        assertEquals(
            ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED,
            result.status,
        )
        assertEquals(
            listOf(voice, sos),
            result.queue,
        )
    }

    @Test
    fun `saturated queue rejects newest and preserves oldest eight`() {
        val existing =
            (1..8).map { index ->
                if (index % 2 == 0) {
                    sosTrigger(
                        id = "sos-$index",
                        timestamp = index.toLong(),
                    )
                } else {
                    voiceTrigger(
                        id = "voice-$index",
                        timestamp = index.toLong(),
                    )
                }
            }

        val result =
            ProtectionTriggerQueuePolicy.enqueue(
                existing,
                sosTrigger(
                    id = "sos-9",
                    timestamp = 9L,
                ),
            )

        assertEquals(
            ProtectionTriggerQueuePolicy.EnqueueStatus.SATURATED,
            result.status,
        )
        assertEquals(existing, result.queue)
    }

    @Test
    fun `acknowledge removes exact id only from mixed queue`() {
        val first = voiceTrigger("voice-1")
        val second =
            sosTrigger(
                id = "sos-1",
                timestamp = 2_000L,
            )
        val third =
            voiceTrigger(
                id = "voice-2",
                timestamp = 3_000L,
            )

        val result =
            ProtectionTriggerQueuePolicy.acknowledge(
                listOf(first, second, third),
                "sos-1",
            )

        assertTrue(result.removed)
        assertEquals(
            listOf(first, third),
            result.queue,
        )
    }

    @Test
    fun `acknowledge unknown id preserves queue`() {
        val existing =
            listOf(
                voiceTrigger("voice-1"),
                sosTrigger(
                    id = "sos-1",
                    timestamp = 2_000L,
                ),
            )

        val result =
            ProtectionTriggerQueuePolicy.acknowledge(
                existing,
                "missing",
            )

        assertFalse(result.removed)
        assertEquals(existing, result.queue)
    }

    @Test
    fun `acknowledge blank id preserves queue`() {
        val existing =
            listOf(
                voiceTrigger("voice-1"),
            )

        val result =
            ProtectionTriggerQueuePolicy.acknowledge(
                existing,
                "",
            )

        assertFalse(result.removed)
        assertEquals(existing, result.queue)
    }

    @Test
    fun `sanitize removes invalid records deduplicates and bounds fifo`() {
        val first = voiceTrigger("stable-1")
        val duplicate =
            sosTrigger(
                id = "stable-1",
                timestamp = 2_000L,
            )

        val additional =
            (2..10).map { index ->
                sosTrigger(
                    id = "sos-$index",
                    timestamp = index.toLong() + 2_000L,
                )
            }

        val result =
            ProtectionTriggerQueuePolicy.sanitize(
                listOf(
                    voiceTrigger(
                        id = "",
                        timestamp = 3_000L,
                    ),
                    first,
                    duplicate,
                ) + additional,
            )

        assertEquals(8, result.size)
        assertEquals(first, result.first())
        assertEquals(
            listOf(
                "stable-1",
                "sos-2",
                "sos-3",
                "sos-4",
                "sos-5",
                "sos-6",
                "sos-7",
                "sos-8",
            ),
            result.map { it.id },
        )
    }

    @Test
    fun `missing persisted type defaults to voice for vc13 compatibility`() {
        assertEquals(
            ProtectionTriggerType.VOICE,
            ProtectionTriggerType.fromPersistedValue(null),
        )
        assertEquals(
            ProtectionTriggerType.VOICE,
            ProtectionTriggerType.fromPersistedValue(""),
        )
    }

    @Test
    fun `known persisted trigger types decode`() {
        assertEquals(
            ProtectionTriggerType.VOICE,
            ProtectionTriggerType.fromPersistedValue("VOICE"),
        )
        assertEquals(
            ProtectionTriggerType.SOS_BUTTON,
            ProtectionTriggerType.fromPersistedValue("SOS_BUTTON"),
        )
    }

    @Test
    fun `unknown persisted trigger type is rejected`() {
        assertNull(
            ProtectionTriggerType.fromPersistedValue(
                "NOT_A_REAL_TRIGGER",
            ),
        )
    }
}

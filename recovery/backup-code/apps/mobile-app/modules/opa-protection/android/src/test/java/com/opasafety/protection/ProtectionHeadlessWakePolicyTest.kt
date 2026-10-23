package com.opasafety.protection

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionHeadlessWakePolicyTest {

    @Test
    fun `new durable SOS requests headless JavaScript wake`() {
        assertTrue(
            ProtectionHeadlessWakePolicy.shouldWake(
                triggerType = ProtectionTriggerType.SOS_BUTTON,
                publishStatus =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED,
            ),
        )
    }

    @Test
    fun `already durable SOS requests headless JavaScript wake again`() {
        assertTrue(
            ProtectionHeadlessWakePolicy.shouldWake(
                triggerType = ProtectionTriggerType.SOS_BUTTON,
                publishStatus =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT,
            ),
        )
    }

    @Test
    fun `new durable VOICE requests headless JavaScript wake`() {
        assertTrue(
            ProtectionHeadlessWakePolicy.shouldWake(
                triggerType = ProtectionTriggerType.VOICE,
                publishStatus =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED,
            ),
        )
    }

    @Test
    fun `saturated SOS queue does not request headless wake`() {
        assertFalse(
            ProtectionHeadlessWakePolicy.shouldWake(
                triggerType = ProtectionTriggerType.SOS_BUTTON,
                publishStatus =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.SATURATED,
            ),
        )
    }

    @Test
    fun `invalid SOS does not request headless wake`() {
        assertFalse(
            ProtectionHeadlessWakePolicy.shouldWake(
                triggerType = ProtectionTriggerType.SOS_BUTTON,
                publishStatus =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.INVALID,
            ),
        )
    }

    @Test
    fun `already durable VOICE requests recovery wake`() {
        assertTrue(ProtectionHeadlessWakePolicy.shouldWake(
            ProtectionTriggerType.VOICE,
            ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT,
        ))
    }

    @Test
    fun `invalid and saturated VOICE do not wake`() {
        for (status in listOf(
            ProtectionTriggerQueuePolicy.EnqueueStatus.INVALID,
            ProtectionTriggerQueuePolicy.EnqueueStatus.SATURATED,
        )) {
            assertFalse(ProtectionHeadlessWakePolicy.shouldWake(ProtectionTriggerType.VOICE, status))
        }
    }

    @Test
    fun `VOICE enqueue outcomes wake only when the record is durable`() {
        val voice = ProtectionEmergencyTrigger("voice-1", ProtectionTriggerType.VOICE, 1000L, "HELP HELP", "picovoice_porcupine")
        val appended = ProtectionTriggerQueuePolicy.enqueue(emptyList(), voice)
        assertTrue(ProtectionHeadlessWakePolicy.shouldWake(voice.type, appended.status))
        val duplicate = ProtectionTriggerQueuePolicy.enqueue(appended.queue, voice)
        assertTrue(ProtectionHeadlessWakePolicy.shouldWake(voice.type, duplicate.status))
        org.junit.Assert.assertEquals(appended.queue, duplicate.queue)
        val invalid = ProtectionTriggerQueuePolicy.enqueue(appended.queue, voice.copy(id = "", timestamp = 0L))
        assertFalse(ProtectionHeadlessWakePolicy.shouldWake(voice.type, invalid.status))
        val full = (1..ProtectionTriggerQueuePolicy.MAX_PENDING_TRIGGERS).map { voice.copy(id = "pending-$it") }
        val saturated = ProtectionTriggerQueuePolicy.enqueue(full, voice)
        assertFalse(ProtectionHeadlessWakePolicy.shouldWake(voice.type, saturated.status))
        org.junit.Assert.assertEquals(full, saturated.queue)
    }
}

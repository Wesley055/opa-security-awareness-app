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
    fun `voice does not acquire a second headless wake path`() {
        assertFalse(
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
}
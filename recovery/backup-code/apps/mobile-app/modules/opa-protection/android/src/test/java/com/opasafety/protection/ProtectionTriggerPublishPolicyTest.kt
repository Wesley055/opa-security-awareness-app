package com.opasafety.protection

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionTriggerPublishPolicyTest {

    @Test
    fun `appended durable voice trigger wakes listener`() {
        assertTrue(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                triggerType = ProtectionTriggerType.VOICE,
                status =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED,
            ),
        )
    }

    @Test
    fun `already present durable voice trigger wakes listener again`() {
        assertTrue(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                triggerType = ProtectionTriggerType.VOICE,
                status =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT,
            ),
        )
    }

    @Test
    fun `appended durable SOS does not wake process local listener`() {
        assertFalse(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                triggerType = ProtectionTriggerType.SOS_BUTTON,
                status =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED,
            ),
        )
    }

    @Test
    fun `already present durable SOS does not wake process local listener`() {
        assertFalse(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                triggerType = ProtectionTriggerType.SOS_BUTTON,
                status =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT,
            ),
        )
    }

    @Test
    fun `saturated voice trigger does not wake listener`() {
        assertFalse(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                triggerType = ProtectionTriggerType.VOICE,
                status =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.SATURATED,
            ),
        )
    }

    @Test
    fun `invalid voice trigger does not wake listener`() {
        assertFalse(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                triggerType = ProtectionTriggerType.VOICE,
                status =
                    ProtectionTriggerQueuePolicy.EnqueueStatus.INVALID,
            ),
        )
    }
}
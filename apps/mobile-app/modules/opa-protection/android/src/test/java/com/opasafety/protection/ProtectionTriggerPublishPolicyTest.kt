package com.opasafety.protection

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionTriggerPublishPolicyTest {

    @Test
    fun `appended durable trigger wakes listener`() {
        assertTrue(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED,
            ),
        )
    }

    @Test
    fun `already present durable trigger wakes listener again`() {
        assertTrue(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT,
            ),
        )
    }

    @Test
    fun `saturated rejected trigger does not wake listener`() {
        assertFalse(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                ProtectionTriggerQueuePolicy.EnqueueStatus.SATURATED,
            ),
        )
    }

    @Test
    fun `invalid rejected trigger does not wake listener`() {
        assertFalse(
            ProtectionTriggerPublishPolicy.shouldWakeListener(
                ProtectionTriggerQueuePolicy.EnqueueStatus.INVALID,
            ),
        )
    }
}
package com.opasafety.protection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionPendingTriggerClaimPolicyTest {

    private fun sosTrigger(
        id: String,
        timestamp: Long,
    ) = ProtectionEmergencyTrigger(
        id = id,
        type = ProtectionTriggerType.SOS_BUTTON,
        timestamp = timestamp,
    )

    @Test
    fun `claim always owns current fifo head rather than caller-selected trigger`() {
        val coordinator = ProtectionTriggerClaimCoordinator()
        val queue = listOf(
            sosTrigger("sos-1", 1_000L),
            sosTrigger("sos-2", 2_000L),
        )

        val claim =
            ProtectionPendingTriggerClaimPolicy.claimHead(
                queue = queue,
                ownerId = "foreground",
                coordinator = coordinator,
            )

        assertEquals("sos-1", claim?.trigger?.id)
        assertEquals("foreground", claim?.ownerId)
        assertTrue(claim?.claimToken?.isNotBlank() == true)
    }

    @Test
    fun `second consumer cannot claim fifo head while first owns it`() {
        val coordinator = ProtectionTriggerClaimCoordinator()
        val queue = listOf(
            sosTrigger("sos-1", 1_000L),
            sosTrigger("sos-2", 2_000L),
        )

        val first =
            ProtectionPendingTriggerClaimPolicy.claimHead(
                queue = queue,
                ownerId = "foreground",
                coordinator = coordinator,
            )

        val second =
            ProtectionPendingTriggerClaimPolicy.claimHead(
                queue = queue,
                ownerId = "headless",
                coordinator = coordinator,
            )

        assertEquals("sos-1", first?.trigger?.id)
        assertNull(second)
    }

    @Test
    fun `empty queue cannot be claimed`() {
        val coordinator = ProtectionTriggerClaimCoordinator()

        val claim =
            ProtectionPendingTriggerClaimPolicy.claimHead(
                queue = emptyList(),
                ownerId = "foreground",
                coordinator = coordinator,
            )

        assertNull(claim)
    }

    @Test
    fun `ack requires ownership of exact durable fifo head`() {
        val coordinator = ProtectionTriggerClaimCoordinator()
        val queue = listOf(
            sosTrigger("sos-1", 1_000L),
            sosTrigger("sos-2", 2_000L),
        )

        val claim =
            ProtectionPendingTriggerClaimPolicy.claimHead(
                queue = queue,
                ownerId = "foreground",
                coordinator = coordinator,
            )!!

        val result =
            ProtectionPendingTriggerClaimPolicy.acknowledgeClaimedHead(
                queue = queue,
                triggerId = claim.trigger.id,
                claimToken = claim.claimToken,
                coordinator = coordinator,
            )

        assertTrue(result.removed)
        assertEquals(listOf("sos-2"), result.queue.map { it.id })
    }

    @Test
    fun `wrong claim token cannot remove durable head`() {
        val coordinator = ProtectionTriggerClaimCoordinator()
        val queue = listOf(
            sosTrigger("sos-1", 1_000L),
            sosTrigger("sos-2", 2_000L),
        )

        ProtectionPendingTriggerClaimPolicy.claimHead(
            queue = queue,
            ownerId = "foreground",
            coordinator = coordinator,
        )!!

        val result =
            ProtectionPendingTriggerClaimPolicy.acknowledgeClaimedHead(
                queue = queue,
                triggerId = "sos-1",
                claimToken = "wrong-token",
                coordinator = coordinator,
            )

        assertFalse(result.removed)
        assertEquals(queue, result.queue)
    }

    @Test
    fun `claim cannot remove a non-head record`() {
        val coordinator = ProtectionTriggerClaimCoordinator()
        val queue = listOf(
            sosTrigger("sos-1", 1_000L),
            sosTrigger("sos-2", 2_000L),
        )

        val claim =
            ProtectionPendingTriggerClaimPolicy.claimHead(
                queue = queue,
                ownerId = "foreground",
                coordinator = coordinator,
            )!!

        val result =
            ProtectionPendingTriggerClaimPolicy.acknowledgeClaimedHead(
                queue = queue,
                triggerId = "sos-2",
                claimToken = claim.claimToken,
                coordinator = coordinator,
            )

        assertFalse(result.removed)
        assertEquals(queue, result.queue)
    }
}
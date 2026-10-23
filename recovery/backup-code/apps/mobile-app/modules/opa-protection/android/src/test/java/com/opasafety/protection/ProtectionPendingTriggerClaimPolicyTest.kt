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

    @Test
    fun `mixed FIFO retains voice on retry and rejects stale ACK after reclaim`() {
        val coordinator = ProtectionTriggerClaimCoordinator()
        val voice = ProtectionEmergencyTrigger("voice-1", ProtectionTriggerType.VOICE, 1000L, "HELP HELP", "picovoice_porcupine")
        val queue = listOf(voice, sosTrigger("sos-2", 2000L))
        val first = ProtectionPendingTriggerClaimPolicy.claimHead(queue, "headless-protection", coordinator)!!
        assertEquals(voice, first.trigger)
        assertTrue(coordinator.release(first.trigger.id, first.claimToken))
        val retry = ProtectionPendingTriggerClaimPolicy.claimHead(queue, "foreground-react", coordinator)!!
        assertEquals(voice, retry.trigger)
        val stale = ProtectionPendingTriggerClaimPolicy.acknowledgeClaimedHead(queue, voice.id, first.claimToken, coordinator)
        assertFalse(stale.removed)
        assertEquals(queue, stale.queue)
        val ack = ProtectionPendingTriggerClaimPolicy.acknowledgeClaimedHead(queue, voice.id, retry.claimToken, coordinator)
        assertTrue(ack.removed)
        assertEquals("sos-2", ProtectionPendingTriggerClaimPolicy.claimHead(ack.queue, "headless-protection", coordinator)?.trigger?.id)
    }

    @Test
    fun `simultaneous foreground and native wakes grant exactly one VOICE owner`() {
        val coordinator = ProtectionTriggerClaimCoordinator()
        val queue = listOf(ProtectionEmergencyTrigger("voice-1", ProtectionTriggerType.VOICE, 1000L, "HELP HELP", "picovoice_porcupine"))
        val ready = java.util.concurrent.CountDownLatch(3)
        val go = java.util.concurrent.CountDownLatch(1)
        val claims = java.util.Collections.synchronizedList(mutableListOf<ProtectionTriggerClaim>())
        val threads = listOf("foreground-react", "headless-protection", "headless-protection").map { owner ->
            Thread {
                ready.countDown()
                go.await()
                ProtectionPendingTriggerClaimPolicy.claimHead(queue, owner, coordinator)?.let { claims.add(it) }
            }.apply { start() }
        }
        assertTrue(ready.await(5, java.util.concurrent.TimeUnit.SECONDS))
        go.countDown()
        threads.forEach { it.join(5000) }
        assertTrue(threads.none { it.isAlive })
        assertEquals(1, claims.size)
        assertEquals("voice-1", claims.single().trigger.id)
    }
}

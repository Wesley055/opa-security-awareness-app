package com.opasafety.protection

import org.junit.Assert.*
import org.junit.Test

class ProtectionExecutionBoundaryTest {
    private fun trigger(type: ProtectionTriggerType) = ProtectionEmergencyTrigger(
        "first", type, 1000L,
        if (type == ProtectionTriggerType.VOICE) "HELP HELP" else null,
        if (type == ProtectionTriggerType.VOICE) "picovoice_porcupine" else null,
    )

    @Test fun `both trigger types are claimable at wake and React cannot steal them`() {
        for (type in ProtectionTriggerType.entries) {
            val coordinator = ProtectionTriggerClaimCoordinator()
            var queue = emptyList<ProtectionEmergencyTrigger>()
            val event = trigger(type)
            var headless: ProtectionTriggerClaim? = null
            ProtectionTriggerBus.publishDurably(event, persist = {
                val result = ProtectionTriggerQueuePolicy.enqueue(queue, event)
                queue = result.queue
                result.status
            }, wake = { status ->
                assertTrue(ProtectionHeadlessWakePolicy.shouldWake(type, status))
                headless = ProtectionPendingTriggerClaimPolicy.claimHead(queue, "headless-protection", coordinator)
                assertEquals(event, headless?.trigger)
                assertEquals("headless-protection", coordinator.currentOwnerId())
            }, deliver = {
                assertNull(ProtectionPendingTriggerClaimPolicy.claimHead(queue, "foreground-react", coordinator))
            })
            assertNotNull(headless)
            val ack = ProtectionPendingTriggerClaimPolicy.acknowledgeClaimedHead(queue, event.id, headless!!.claimToken, coordinator)
            assertTrue(ack.removed)
            assertTrue(ack.queue.isEmpty())
        }
    }

    @Test fun `persistence failure cannot request any wake`() {
        var woke = false
        try {
            ProtectionTriggerBus.publishDurably(trigger(ProtectionTriggerType.VOICE),
                persist = { throw IllegalStateException("storage failed") },
                wake = { woke = true }, deliver = { fail("unexpected delivery") })
            fail("expected persistence failure")
        } catch (_: IllegalStateException) { assertFalse(woke) }
    }

    @Test fun `duplicate recovery wake cannot grant a second owner`() {
        val event = trigger(ProtectionTriggerType.VOICE)
        val queue = listOf(event)
        val coordinator = ProtectionTriggerClaimCoordinator()
        val first = ProtectionPendingTriggerClaimPolicy.claimHead(queue, "headless-protection", coordinator)!!
        ProtectionTriggerBus.publishDurably(event,
            persist = { ProtectionTriggerQueuePolicy.enqueue(queue, event).status },
            wake = { status ->
                assertEquals(ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT, status)
                assertTrue(ProtectionHeadlessWakePolicy.shouldWake(event.type, status))
                assertNull(ProtectionPendingTriggerClaimPolicy.claimHead(queue, "headless-protection", coordinator))
            }, deliver = {})
        assertTrue(coordinator.release(event.id, first.claimToken))
        assertEquals(event, ProtectionPendingTriggerClaimPolicy.claimHead(queue, "headless-protection", coordinator)?.trigger)
    }

    @Test fun `permission and tracking eligibility requires unlocked resumed interactive Activity`() {
        assertTrue(ProtectionForegroundPolicy.isEligible(true, true, true, false))
        assertFalse(ProtectionForegroundPolicy.isEligible(false, true, true, false))
        assertFalse(ProtectionForegroundPolicy.isEligible(true, false, true, false))
        assertFalse(ProtectionForegroundPolicy.isEligible(true, true, false, false))
        assertFalse(ProtectionForegroundPolicy.isEligible(true, true, true, true))
    }

    @Test fun `invalid and saturated records issue neither headless wake nor listener delivery`() {
        for (type in ProtectionTriggerType.entries) {
            for (status in listOf(ProtectionTriggerQueuePolicy.EnqueueStatus.INVALID, ProtectionTriggerQueuePolicy.EnqueueStatus.SATURATED)) {
                assertEquals(status, ProtectionTriggerBus.publishDurably(trigger(type),
                    persist = { status }, wake = { fail("unexpected headless wake") },
                    deliver = { fail("unexpected listener delivery") }))
            }
        }
    }

    @Test fun `both types recover an already present unclaimed FIFO head`() {
        for (type in ProtectionTriggerType.entries) {
            val event = trigger(type)
            val queue = listOf(event)
            val coordinator = ProtectionTriggerClaimCoordinator()
            var recovered: ProtectionTriggerClaim? = null
            ProtectionTriggerBus.publishDurably(event,
                persist = { ProtectionTriggerQueuePolicy.enqueue(queue, event).status },
                wake = { status ->
                    assertEquals(ProtectionTriggerQueuePolicy.EnqueueStatus.ALREADY_PRESENT, status)
                    recovered = ProtectionPendingTriggerClaimPolicy.claimHead(queue, "foreground-react", coordinator)
                }, deliver = {})
            assertEquals(event, recovered?.trigger)
            assertNull(ProtectionPendingTriggerClaimPolicy.claimHead(queue, "headless-protection", coordinator))
        }
    }
}

package com.opasafety.protection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionTriggerClaimCoordinatorTest {

    private fun sosTrigger(
        id: String,
        timestamp: Long = 1_000L,
    ) = ProtectionEmergencyTrigger(
        id = id,
        type = ProtectionTriggerType.SOS_BUTTON,
        timestamp = timestamp,
    )

    @Test
    fun `first consumer claims fifo head`() {
        val coordinator =
            ProtectionTriggerClaimCoordinator()

        val trigger = sosTrigger("sos-1")

        val claim =
            coordinator.claim(
                trigger = trigger,
                ownerId = "foreground",
            )

        assertEquals(trigger, claim?.trigger)
        assertEquals("foreground", claim?.ownerId)
        assertTrue(claim?.claimToken?.isNotBlank() == true)
    }

    @Test
    fun `second consumer cannot claim while head is owned`() {
        val coordinator =
            ProtectionTriggerClaimCoordinator()

        val trigger = sosTrigger("sos-1")

        val first =
            coordinator.claim(
                trigger = trigger,
                ownerId = "foreground",
            )

        val second =
            coordinator.claim(
                trigger = trigger,
                ownerId = "headless",
            )

        assertTrue(first != null)
        assertNull(second)
    }

    @Test
    fun `matching release allows another consumer to claim same durable head`() {
        val coordinator =
            ProtectionTriggerClaimCoordinator()

        val trigger = sosTrigger("sos-1")

        val first =
            coordinator.claim(
                trigger = trigger,
                ownerId = "foreground",
            )!!

        assertTrue(
            coordinator.release(
                triggerId = first.trigger.id,
                claimToken = first.claimToken,
            ),
        )

        val second =
            coordinator.claim(
                trigger = trigger,
                ownerId = "headless",
            )

        assertEquals(trigger, second?.trigger)
        assertEquals("headless", second?.ownerId)
    }

    @Test
    fun `wrong token cannot release active claim`() {
        val coordinator =
            ProtectionTriggerClaimCoordinator()

        val trigger = sosTrigger("sos-1")

        val first =
            coordinator.claim(
                trigger = trigger,
                ownerId = "foreground",
            )!!

        assertFalse(
            coordinator.release(
                triggerId = first.trigger.id,
                claimToken = "wrong-token",
            ),
        )

        assertNull(
            coordinator.claim(
                trigger = trigger,
                ownerId = "headless",
            ),
        )
    }

    @Test
    fun `wrong trigger id cannot release active claim`() {
        val coordinator =
            ProtectionTriggerClaimCoordinator()

        val trigger = sosTrigger("sos-1")

        val first =
            coordinator.claim(
                trigger = trigger,
                ownerId = "foreground",
            )!!

        assertFalse(
            coordinator.release(
                triggerId = "sos-2",
                claimToken = first.claimToken,
            ),
        )

        assertNull(
            coordinator.claim(
                trigger = trigger,
                ownerId = "headless",
            ),
        )
    }

    @Test
    fun `blank owner cannot claim`() {
        val coordinator =
            ProtectionTriggerClaimCoordinator()

        assertNull(
            coordinator.claim(
                trigger = sosTrigger("sos-1"),
                ownerId = "",
            ),
        )
    }
}
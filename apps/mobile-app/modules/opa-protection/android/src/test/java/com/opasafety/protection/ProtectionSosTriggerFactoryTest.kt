package com.opasafety.protection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionSosTriggerFactoryTest {

    @Test
    fun `notification sos creates explicit durable sos button trigger`() {
        val trigger =
            ProtectionSosTriggerFactory.create(
                timestamp = 1787683000000L,
                id = "lock-screen-sos-1",
            )

        assertEquals(
            "lock-screen-sos-1",
            trigger.id,
        )
        assertEquals(
            ProtectionTriggerType.SOS_BUTTON,
            trigger.type,
        )
        assertEquals(
            1787683000000L,
            trigger.timestamp,
        )
        assertNull(trigger.phrase)
        assertNull(trigger.provider)
    }

    @Test
    fun `factory preserves unique durable identity supplied by caller`() {
        val first =
            ProtectionSosTriggerFactory.create(
                timestamp = 1787683000001L,
                id = "sos-a",
            )

        val second =
            ProtectionSosTriggerFactory.create(
                timestamp = 1787683000002L,
                id = "sos-b",
            )

        assertTrue(first.id != second.id)
    }
}
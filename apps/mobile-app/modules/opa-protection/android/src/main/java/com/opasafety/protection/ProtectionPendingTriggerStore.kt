package com.opasafety.protection

import android.content.Context

/**
 * Bounded durable FIFO handoff for native emergency triggers.
 *
 * The queue contains only provider-neutral trigger envelopes. It does not
 * contain credentials, location, incident data, or user PII.
 *
 * Records remain durable until JavaScript acknowledges the exact trigger ID.
 * Persistence alone does not wake or execute JavaScript.
 */
internal object ProtectionPendingTriggerStore {

    /*
     * Process-local ownership for the durable FIFO head.
     *
     * The queue itself remains durable in SharedPreferences. If Android kills
     * the process, this claim disappears while the unacknowledged trigger
     * remains durable and can be recovered by the next process.
     */
    private val claimCoordinator =
        ProtectionTriggerClaimCoordinator()

    private const val PREFS_NAME =
        "opa_protection_pending_trigger"

    private const val KEY_QUEUE = "queue_v2"

    private const val LEGACY_KEY_ID = "id"
    private const val LEGACY_KEY_PHRASE = "phrase"
    private const val LEGACY_KEY_PROVIDER = "provider"
    private const val LEGACY_KEY_TIMESTAMP = "timestamp"

    @Synchronized
    fun save(
        context: Context,
        trigger: ProtectionEmergencyTrigger,
    ): ProtectionTriggerQueuePolicy.EnqueueStatus {
        val queue =
            readQueue(context)

        val result =
            ProtectionTriggerQueuePolicy.enqueue(
                queue,
                trigger,
            )

        if (
            result.status ==
            ProtectionTriggerQueuePolicy.EnqueueStatus.APPENDED
        ) {
            writeQueue(
                context,
                result.queue,
            )
        }

        return result.status
    }

    /**
     * Atomically reads and claims the current durable FIFO head.
     *
     * Callers cannot choose an arbitrary trigger to claim.
     */
    @Synchronized
    fun claimHead(
        context: Context,
        ownerId: String,
    ): ProtectionTriggerClaim? {
        val queue =
            readQueue(context)

        return ProtectionPendingTriggerClaimPolicy.claimHead(
            queue = queue,
            ownerId = ownerId,
            coordinator = claimCoordinator,
        )
    }

    /**
     * Releases ownership without removing the durable record.
     *
     * Used when processing must RETRY.
     */
    @Synchronized
    fun releaseClaim(
        triggerId: String,
        claimToken: String,
    ): Boolean {
        return claimCoordinator.release(
            triggerId = triggerId,
            claimToken = claimToken,
        )
    }

    /**
     * Removes the FIFO head only when the caller owns that exact head.
     */
    @Synchronized
    fun acknowledgeClaimedHead(
        context: Context,
        triggerId: String,
        claimToken: String,
    ): Boolean {
        val queue =
            readQueue(context)

        val result =
            ProtectionPendingTriggerClaimPolicy.acknowledgeClaimedHead(
                queue = queue,
                triggerId = triggerId,
                claimToken = claimToken,
                coordinator = claimCoordinator,
            )

        if (!result.removed) {
            return false
        }

        writeQueue(
            context,
            result.queue,
        )

        return true
    }

    @Synchronized
    fun peek(
        context: Context,
    ): ProtectionEmergencyTrigger? {
        return readQueue(context).firstOrNull()
    }

    @Synchronized
    fun acknowledge(
        context: Context,
        triggerId: String,
    ): Boolean {
        val queue =
            readQueue(context)

        val result =
            ProtectionTriggerQueuePolicy.acknowledge(
                queue,
                triggerId,
            )

        if (!result.removed) {
            return false
        }

        writeQueue(
            context,
            result.queue,
        )

        return true
    }

    private fun readQueue(
        context: Context,
    ): List<ProtectionEmergencyTrigger> {
        val preferences =
            context.getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE,
            )

        val encoded =
            preferences.getString(
                KEY_QUEUE,
                null,
            )

        if (encoded != null) {
            return ProtectionTriggerPersistenceCodec.decode(
                encoded,
            )
        }

        /*
         * One-time compatibility migration from the original single-slot
         * durability contract. This preserves an unacknowledged voice trigger
         * across an in-place upgrade.
         */
        val legacy =
            readLegacyTrigger(preferences)

        if (legacy != null) {
            writeQueue(
                context,
                listOf(legacy),
            )

            clearLegacyKeys(preferences)

            return listOf(legacy)
        }

        clearLegacyKeys(preferences)

        return emptyList()
    }

    private fun writeQueue(
        context: Context,
        queue: List<ProtectionEmergencyTrigger>,
    ) {
        val encoded =
            ProtectionTriggerPersistenceCodec.encode(
                queue,
            )

        context
            .getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE,
            )
            .edit()
            .putString(
                KEY_QUEUE,
                encoded,
            )
            .apply()
    }

    private fun readLegacyTrigger(
        preferences: android.content.SharedPreferences,
    ): ProtectionEmergencyTrigger? {
        val id =
            preferences.getString(
                LEGACY_KEY_ID,
                null,
            ) ?: return null

        val phrase =
            preferences.getString(
                LEGACY_KEY_PHRASE,
                null,
            ) ?: return null

        val provider =
            preferences.getString(
                LEGACY_KEY_PROVIDER,
                null,
            ) ?: return null

        val timestamp =
            preferences.getLong(
                LEGACY_KEY_TIMESTAMP,
                0L,
            )

        val trigger =
            ProtectionEmergencyTrigger(
                id = id,
                type = ProtectionTriggerType.VOICE,
                phrase = phrase,
                provider = provider,
                timestamp = timestamp,
            )

        return trigger.takeIf(
            ProtectionTriggerQueuePolicy::isValid,
        )
    }

    private fun clearLegacyKeys(
        preferences: android.content.SharedPreferences,
    ) {
        preferences
            .edit()
            .remove(LEGACY_KEY_ID)
            .remove(LEGACY_KEY_PHRASE)
            .remove(LEGACY_KEY_PROVIDER)
            .remove(LEGACY_KEY_TIMESTAMP)
            .apply()
    }
}
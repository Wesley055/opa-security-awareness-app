package com.opasafety.protection

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Bounded durable FIFO handoff for native voice triggers.
 *
 * The queue contains only provider-neutral trigger envelopes. It does not
 * contain credentials, location, incident data, or user PII.
 *
 * Records remain durable until JavaScript acknowledges the exact trigger ID.
 * Persistence alone does not wake or execute JavaScript.
 */
internal object ProtectionPendingTriggerStore {

    private const val PREFS_NAME =
        "opa_protection_pending_trigger"

    private const val KEY_QUEUE = "queue_v2"

    private const val LEGACY_KEY_ID = "id"
    private const val LEGACY_KEY_PHRASE = "phrase"
    private const val LEGACY_KEY_PROVIDER = "provider"
    private const val LEGACY_KEY_TIMESTAMP = "timestamp"

    private const val MAX_PENDING_TRIGGERS = 8

    @Synchronized
    fun save(
        context: Context,
        trigger: ProtectionVoiceTrigger,
    ) {
        if (!isValid(trigger)) {
            return
        }

        val queue =
            readQueue(context).toMutableList()

        /*
         * A provider must not enqueue the same stable trigger twice.
         */
        if (queue.any { it.id == trigger.id }) {
            return
        }

        queue.add(trigger)

        /*
         * Bound storage without overwriting the oldest unacknowledged
         * emergency trigger. If the queue is saturated, reject the newest
         * trigger and preserve the existing durable records.
         */
        if (queue.size > MAX_PENDING_TRIGGERS) {
            return
        }

        writeQueue(
            context,
            queue,
        )
    }

    @Synchronized
    fun peek(
        context: Context,
    ): ProtectionVoiceTrigger? {
        return readQueue(context).firstOrNull()
    }

    @Synchronized
    fun acknowledge(
        context: Context,
        triggerId: String,
    ): Boolean {
        if (triggerId.isBlank()) {
            return false
        }

        val queue =
            readQueue(context).toMutableList()

        val index =
            queue.indexOfFirst {
                it.id == triggerId
            }

        if (index < 0) {
            return false
        }

        queue.removeAt(index)

        writeQueue(
            context,
            queue,
        )

        return true
    }

    private fun readQueue(
        context: Context,
    ): List<ProtectionVoiceTrigger> {
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
            return decodeQueue(encoded)
        }

        /*
         * One-time compatibility migration from the original single-slot
         * durability contract. This preserves an unacknowledged trigger
         * across an in-place vc12 upgrade.
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

    private fun decodeQueue(
        encoded: String,
    ): List<ProtectionVoiceTrigger> {
        return try {
            val array = JSONArray(encoded)
            val queue =
                mutableListOf<ProtectionVoiceTrigger>()

            for (index in 0 until array.length()) {
                val item =
                    array.optJSONObject(index)
                        ?: continue

                val trigger =
                    ProtectionVoiceTrigger(
                        id = item.optString("id"),
                        phrase = item.optString("phrase"),
                        provider = item.optString("provider"),
                        timestamp = item.optLong("timestamp"),
                    )

                if (
                    isValid(trigger) &&
                    queue.none { it.id == trigger.id } &&
                    queue.size < MAX_PENDING_TRIGGERS
                ) {
                    queue.add(trigger)
                }
            }

            queue
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun writeQueue(
        context: Context,
        queue: List<ProtectionVoiceTrigger>,
    ) {
        val array = JSONArray()

        queue
            .take(MAX_PENDING_TRIGGERS)
            .forEach { trigger ->
                array.put(
                    JSONObject().apply {
                        put("id", trigger.id)
                        put("phrase", trigger.phrase)
                        put("provider", trigger.provider)
                        put("timestamp", trigger.timestamp)
                    },
                )
            }

        context
            .getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE,
            )
            .edit()
            .putString(
                KEY_QUEUE,
                array.toString(),
            )
            .apply()
    }

    private fun readLegacyTrigger(
        preferences: android.content.SharedPreferences,
    ): ProtectionVoiceTrigger? {
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
            ProtectionVoiceTrigger(
                id = id,
                phrase = phrase,
                provider = provider,
                timestamp = timestamp,
            )

        return trigger.takeIf(::isValid)
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

    private fun isValid(
        trigger: ProtectionVoiceTrigger,
    ): Boolean {
        return (
            trigger.id.isNotBlank() &&
                trigger.phrase.isNotBlank() &&
                trigger.provider.isNotBlank() &&
                trigger.timestamp > 0L
        )
    }
}
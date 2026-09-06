package com.opasafety.protection

import org.json.JSONArray
import org.json.JSONObject

/**
 * Version-tolerant codec for OPA's durable protection-trigger FIFO.
 *
 * vc13 queue_v2 records did not persist a trigger type. Missing or blank
 * type therefore means VOICE. Unknown future types are ignored record-by-
 * record so one unsupported entry cannot destroy valid queue neighbors.
 */
internal object ProtectionTriggerPersistenceCodec {

    fun decode(
        encoded: String,
    ): List<ProtectionEmergencyTrigger> {
        val array =
            try {
                JSONArray(encoded)
            } catch (_: Exception) {
                return emptyList()
            }

        val decoded =
            buildList {
                for (index in 0 until array.length()) {
                    val item =
                        array.optJSONObject(index)
                            ?: continue

                    val trigger =
                        decodeRecord(item)
                            ?: continue

                    add(trigger)
                }
            }

        return ProtectionTriggerQueuePolicy.sanitize(
            decoded,
        )
    }

    fun encode(
        triggers: List<ProtectionEmergencyTrigger>,
    ): String {
        val sanitized =
            ProtectionTriggerQueuePolicy.sanitize(
                triggers,
            )

        val array = JSONArray()

        sanitized.forEach { trigger ->
            val item =
                JSONObject()
                    .put("id", trigger.id)
                    .put("type", trigger.type.name)
                    .put("timestamp", trigger.timestamp)

            if (trigger.type == ProtectionTriggerType.VOICE) {
                item.put("phrase", trigger.phrase)
                item.put("provider", trigger.provider)
            }

            array.put(item)
        }

        return array.toString()
    }

    private fun decodeRecord(
        item: JSONObject,
    ): ProtectionEmergencyTrigger? {
        val persistedType =
            if (
                !item.has("type") ||
                item.isNull("type")
            ) {
                null
            } else {
                item.optString("type", null)
            }

        val type =
            ProtectionTriggerType.fromPersistedValue(
                persistedType,
            )
                ?: return null

        val phrase =
            if (
                !item.has("phrase") ||
                item.isNull("phrase")
            ) {
                null
            } else {
                item.optString("phrase", null)
            }

        val provider =
            if (
                !item.has("provider") ||
                item.isNull("provider")
            ) {
                null
            } else {
                item.optString("provider", null)
            }

        return ProtectionEmergencyTrigger(
            id = item.optString("id", ""),
            type = type,
            timestamp = item.optLong("timestamp", 0L),
            phrase = phrase,
            provider = provider,
        )
    }
}
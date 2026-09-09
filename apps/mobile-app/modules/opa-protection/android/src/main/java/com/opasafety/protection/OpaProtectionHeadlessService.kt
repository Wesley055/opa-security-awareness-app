package com.opasafety.protection

import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Executes OPA's background emergency-trigger JavaScript worker without
 * launching an Activity.
 *
 * This service owns execution/wake only. Durable FIFO ownership remains in
 * ProtectionPendingTriggerStore and incident business logic remains in JS.
 *
 * VOICE and SOS_BUTTON share this wake and retain their own JS semantics.
 */
class OpaProtectionHeadlessService : HeadlessJsTaskService() {

    override fun getTaskConfig(
        intent: Intent?,
    ): HeadlessJsTaskConfig? {
        Log.i(TAG, "[OPA-HEADLESS] getTaskConfig entry")

        if (intent?.action != ACTION_PROCESS_PENDING_TRIGGERS) {
            Log.i(TAG, "[OPA-HEADLESS] task action rejected")
            return null
        }

        Log.i(TAG, "[OPA-HEADLESS] PROCESS_PENDING_TRIGGERS accepted")
        Log.i(TAG, "[OPA-HEADLESS] returning HeadlessJsTaskConfig")

        return HeadlessJsTaskConfig(
            TASK_KEY,
            Arguments.createMap(),
            TASK_TIMEOUT_MS,
            true,
        )
    }

    companion object {
        private const val TAG = "OpaProtectionHeadless"

        const val ACTION_PROCESS_PENDING_TRIGGERS =
            "com.opasafety.app.protection.action.PROCESS_PENDING_TRIGGERS"

        internal fun requestWake(
            context: Context,
            triggerType: ProtectionTriggerType,
            publishStatus: ProtectionTriggerQueuePolicy.EnqueueStatus,
        ) {
            if (!ProtectionHeadlessWakePolicy.shouldWake(triggerType, publishStatus)) {
                return
            }

            try {
                context.startService(
                    Intent(context, OpaProtectionHeadlessService::class.java).apply {
                        action = ACTION_PROCESS_PENDING_TRIGGERS
                    },
                )
                Log.i(TAG, "Headless protection trigger wake requested type=$triggerType.")
            } catch (error: Throwable) {
                // A refused wake must never remove the durable FIFO record.
                Log.e(TAG, "Headless protection trigger wake failed; durable trigger retained.", error)
            }
        }

        const val TASK_KEY =
            "OpaProtectionEmergencyTrigger"

        /*
         * Bounded safeguard only.
         *
         * The emergency worker may need location acquisition plus authenticated
         * network activity, so this must not be a short UI-style timeout.
         */
        private const val TASK_TIMEOUT_MS =
            60_000L
    }
}
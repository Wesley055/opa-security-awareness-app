package com.opasafety.protection

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
 * VOICE does not use this service. The existing native voice lifecycle remains
 * unchanged.
 */
class OpaProtectionHeadlessService : HeadlessJsTaskService() {

    override fun getTaskConfig(
        intent: Intent?,
    ): HeadlessJsTaskConfig? {
        Log.i(TAG, "[OPA-HEADLESS] getTaskConfig entry")

        if (intent?.action != ACTION_PROCESS_PENDING_SOS) {
            Log.i(TAG, "[OPA-HEADLESS] task action rejected")
            return null
        }

        Log.i(TAG, "[OPA-HEADLESS] PROCESS_PENDING_SOS accepted")
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

        const val ACTION_PROCESS_PENDING_SOS =
            "com.opasafety.app.protection.action.PROCESS_PENDING_SOS"

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
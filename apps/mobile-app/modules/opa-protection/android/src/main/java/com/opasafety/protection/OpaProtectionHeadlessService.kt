package com.opasafety.protection

import android.content.Intent
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
        if (intent?.action != ACTION_PROCESS_PENDING_SOS) {
            return null
        }

        return HeadlessJsTaskConfig(
            TASK_KEY,
            Arguments.createMap(),
            TASK_TIMEOUT_MS,
            true,
        )
    }

    companion object {
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
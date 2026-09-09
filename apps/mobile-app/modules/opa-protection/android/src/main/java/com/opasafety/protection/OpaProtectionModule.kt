package com.opasafety.protection

import android.app.KeyguardManager
import android.content.Context
import android.os.PowerManager
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OpaProtectionModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("OpaProtection")

        Events(VOICE_TRIGGER_EVENT)

        Function("isForegroundEligible") { isForegroundEligible() }

        OnCreate {
            ProtectionTriggerBus.attach { trigger ->
                sendEvent(
                    VOICE_TRIGGER_EVENT,
                    ProtectionTriggerBridgePayload.from(
                        trigger,
                    ),
                )
            }
        }

        OnDestroy {
            ProtectionTriggerBus.detach()
        }

        AsyncFunction("configureVoiceProviderAsync") {
                enabled: Boolean,
                provider: String,
                accessKey: String,
                keywordAssetName: String,
                phrase: String,
                sensitivity: Double ->

            val context =
                appContext.reactContext
                    ?: throw Exceptions.ReactContextLost()

            ProtectionProviderConfigStore.saveVoiceProvider(
                context,
                VoiceProviderConfig(
                    enabled = enabled,
                    provider = provider.trim(),
                    accessKey = accessKey.trim(),
                    keywordAssetName =
                        keywordAssetName.trim(),
                    phrase = phrase.trim(),
                    sensitivity = sensitivity.toFloat(),
                ),
            )
        }

        AsyncFunction("clearVoiceProviderAsync") {
            val context =
                appContext.reactContext
                    ?: throw Exceptions.ReactContextLost()

            ProtectionProviderConfigStore.clearVoiceProvider(
                context,
            )
        }

        /*
         * Atomic durable-trigger ownership boundary.
         *
         * A consumer receives only the current FIFO head and an opaque claim
         * token. RETRY releases ownership without deleting the durable record.
         * ACK requires the exact trigger ID plus matching claim token.
         */
        AsyncFunction("claimPendingProtectionTriggerAsync") {
                ownerId: String ->

            val context =
                appContext.reactContext
                    ?.applicationContext
                    ?: throw Exceptions.ReactContextLost()

            val claim =
                ProtectionPendingTriggerStore.claimHead(
                    context = context,
                    ownerId = ownerId,
                )

            if (claim == null) {
                return@AsyncFunction null
            }

            ProtectionTriggerClaimBridgePayload.from(
                claim,
            )
        }

        AsyncFunction("releasePendingProtectionTriggerAsync") {
                triggerId: String,
                claimToken: String ->

            ProtectionPendingTriggerStore.releaseClaim(
                triggerId = triggerId,
                claimToken = claimToken,
            )
        }

        AsyncFunction("ackClaimedProtectionTriggerAsync") {
                triggerId: String,
                claimToken: String ->

            val context =
                appContext.reactContext
                    ?.applicationContext
                    ?: throw Exceptions.ReactContextLost()

            ProtectionPendingTriggerStore.acknowledgeClaimedHead(
                context = context,
                triggerId = triggerId,
                claimToken = claimToken,
            )
        }

        /*
         * Legacy compatibility APIs.
         *
         * Keep these until all production JavaScript consumers have migrated
         * to the atomic claim contract above.
         */
        AsyncFunction("peekPendingVoiceTriggerAsync") {
            val context =
                appContext.reactContext
                    ?.applicationContext
                    ?: throw Exceptions.ReactContextLost()

            val trigger =
                ProtectionPendingTriggerStore.peek(context)

            if (trigger == null) {
                return@AsyncFunction null
            }

            ProtectionTriggerBridgePayload.from(
                trigger,
            )
        }

        AsyncFunction("ackPendingVoiceTriggerAsync") {
                triggerId: String ->

            val context =
                appContext.reactContext
                    ?.applicationContext
                    ?: throw Exceptions.ReactContextLost()

            ProtectionPendingTriggerStore.acknowledge(
                context,
                triggerId,
            )
        }

        AsyncFunction("startAsync") {
            val context =
                appContext.reactContext
                    ?: throw Exceptions.ReactContextLost()

            val intent =
                Intent(
                    context,
                    OpaProtectionService::class.java,
                ).apply {
                    action =
                        OpaProtectionService.ACTION_START
                }

            if (
                Build.VERSION.SDK_INT >=
                    Build.VERSION_CODES.O
            ) {
                ContextCompat.startForegroundService(
                    context,
                    intent,
                )
            } else {
                context.startService(intent)
            }
        }

        AsyncFunction("stopAsync") {
            val context =
                appContext.reactContext
                    ?: throw Exceptions.ReactContextLost()

            context.stopService(
                Intent(
                    context,
                    OpaProtectionService::class.java,
                ),
            )
        }
    }

    private fun isForegroundEligible(): Boolean {
        val context = appContext.reactContext ?: return false
        val activity = appContext.currentActivity
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        return ProtectionForegroundPolicy.isEligible(
            hasActivity = activity != null && !activity.isFinishing && !activity.isDestroyed,
            resumed = (activity as? LifecycleOwner)?.lifecycle?.currentState == Lifecycle.State.RESUMED,
            interactive = power?.isInteractive == true,
            locked = keyguard?.isKeyguardLocked != false,
        )
    }

    companion object {
        const val VOICE_TRIGGER_EVENT =
            "onVoiceTrigger"
    }}
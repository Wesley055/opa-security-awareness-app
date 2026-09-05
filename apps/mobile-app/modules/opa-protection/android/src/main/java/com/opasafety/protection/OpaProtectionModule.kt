package com.opasafety.protection

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

        OnCreate {
            ProtectionTriggerBus.attach { trigger ->
                sendEvent(
                    VOICE_TRIGGER_EVENT,
                    mapOf(
                        "id" to trigger.id,
                        "phrase" to trigger.phrase,
                        "provider" to trigger.provider,
                        "timestamp" to trigger.timestamp.toDouble(),
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

            mapOf(
                "id" to trigger.id,
                "phrase" to trigger.phrase,
                "provider" to trigger.provider,
                "timestamp" to trigger.timestamp.toDouble(),
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

    companion object {
        const val VOICE_TRIGGER_EVENT =
            "onVoiceTrigger"
    }}
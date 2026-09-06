package com.opasafety.protection

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Permanent Android foreground-service foundation for OPA protection.
 *
 * This service owns the Android foreground lifecycle only. Provider-specific
 * voice engines, incident business logic, authentication, durable journey
 * replay, and location queue ownership remain behind their existing OPA
 * boundaries.
 */
class OpaProtectionService : Service() {

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopProtectionService()
                return START_NOT_STICKY
            }

            ACTION_SOS -> {
                /*
                 * Keep the existing protection foreground/runtime ownership
                 * intact, then publish an explicit durable SOS record.
                 *
                 * Native code does not activate incidents or acquire location.
                 * JavaScript consumes this record through the existing durable
                 * FIFO and existing incident architecture.
                 */
                startProtectionForeground()
                publishNotificationSos()
            }

            else -> startProtectionForeground()
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        ProtectionRuntime.onServiceStopping()
        super.onDestroy()
    }

    private fun startProtectionForeground() {
        val notification = buildProtectionNotification()

        val foregroundServiceType =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            } else {
                0
            }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                foregroundServiceType,
            )
        } else {
            startForeground(
                NOTIFICATION_ID,
                notification,
            )
        }

        ProtectionRuntime.onServiceStarted(this)
    }

    private fun stopProtectionService() {
        ProtectionRuntime.onServiceStopping()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun publishNotificationSos() {
        try {
            ProtectionTriggerBus.publish(
                applicationContext,
                ProtectionSosTriggerFactory.create(
                    id =
                        java.util.UUID
                            .randomUUID()
                            .toString(),
                    timestamp =
                        System.currentTimeMillis(),
                ),
            )

            android.util.Log.i(
                LOG_TAG,
                "Native notification SOS trigger received.",
            )
        } catch (error: Throwable) {
            android.util.Log.e(
                LOG_TAG,
                "Native notification SOS trigger persistence failed.",
                error,
            )
        }
    }
    private fun buildProtectionNotification(): Notification {
        val launchIntent =
            packageManager.getLaunchIntentForPackage(packageName)?.apply {
                flags =
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
            }

        val launchPendingIntent =
            launchIntent?.let {
                PendingIntent.getActivity(
                    this,
                    0,
                    it,
                    PendingIntent.FLAG_UPDATE_CURRENT or
                        PendingIntent.FLAG_IMMUTABLE,
                )
            }

        /*
         * Lock-screen emergency action.
         *
         * The action targets this foreground service directly rather than
         * launching an Activity. This keeps explicit SOS input outside the
         * device-unlock/navigation path while preserving OPA's existing
         * durable trigger, JavaScript incident, location, tracking and audit
         * boundaries.
         */
        val sosIntent =
            Intent(
                this,
                OpaProtectionService::class.java,
            ).apply {
                action = ACTION_SOS
            }

        val sosPendingIntent =
            PendingIntent.getService(
                this,
                SOS_REQUEST_CODE,
                sosIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or
                    PendingIntent.FLAG_IMMUTABLE,
            )

        val builder =
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(applicationInfo.icon)
                .setContentTitle("OPA Protection Service")
                .setContentText(
                    "OPA background protection service is running.",
                )
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(
                    applicationInfo.icon,
                    "SOS",
                    sosPendingIntent,
                )

        if (launchPendingIntent != null) {
            builder.setContentIntent(launchPendingIntent)
        }

        return builder.build()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val channel =
            NotificationChannel(
                CHANNEL_ID,
                "OPA Protection",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description =
                    "Keeps OPA emergency protection available while protection is active."
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setShowBadge(false)
            }

        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }

    companion object {
        private const val LOG_TAG =
            "OpaProtectionService"

        const val ACTION_START =
            "com.opasafety.app.protection.action.START"

        const val ACTION_STOP =
            "com.opasafety.app.protection.action.STOP"

        const val ACTION_SOS =
            "com.opasafety.app.protection.action.SOS"

        private const val CHANNEL_ID =
            "opa-protection-service"

        private const val NOTIFICATION_ID = 41001

        private const val SOS_REQUEST_CODE = 41002
    }
}

/**
 * Provider-neutral protection runtime.
 *
 * Picovoice/Porcupine can plug into this boundary, but the protection service
 * remains valid when no voice provider is configured.
 */
internal object ProtectionRuntime {

    private const val LOG_TAG =
        "OpaProtection"

    private val lifecycleLock = Any()

    @Volatile
    private var provider:
        ProtectionVoiceProvider? = null

    @Volatile
    private var microphone:
        ProtectionMicrophoneCapture? = null

    fun onServiceStarted(service: Service) {
        synchronized(lifecycleLock) {
            if (
                provider?.isRunning() == true &&
                microphone?.isRunning() == true
            ) {
                return
            }

            stopLocked()

            val context = service.applicationContext

            val config =
                ProtectionProviderConfigStore
                    .loadVoiceProvider(context)
                    ?: return

            if (!config.enabled) {
                return
            }

            if (
                config.provider !=
                    PicovoicePorcupineProtectionProvider.PROVIDER_ID
            ) {
                android.util.Log.e(
                    LOG_TAG,
                    "Unsupported native voice provider.",
                )
                return
            }

            var nextProvider:
                ProtectionVoiceProvider? = null

            var nextMicrophone:
                ProtectionMicrophoneCapture? = null

            try {
                val voiceProvider =
                    PicovoicePorcupineProtectionProvider(
                        context,
                        config,
                    )

                voiceProvider.start()
                nextProvider = voiceProvider

                val microphoneCapture =
                    ProtectionMicrophoneCapture(
                        onFrameCallback = { frame ->
                            handleAudioFrame(
                                context,
                                voiceProvider,
                                config,
                                frame,
                            )
                        },
                        onErrorCallback = { error ->
                            android.util.Log.e(
                                LOG_TAG,
                                "Native microphone capture failed.",
                                error,
                            )
                        },
                    )

                nextMicrophone = microphoneCapture

                /*
                 * Publish ownership before capture starts so an immediate
                 * first frame sees the correct provider identity.
                 */
                provider = voiceProvider
                microphone = microphoneCapture

                microphoneCapture.start(
                    voiceProvider.frameLength(),
                    voiceProvider.sampleRate(),
                )

                android.util.Log.i(
                    LOG_TAG,
                    "Native voice protection listening.",
                )
            } catch (error: Throwable) {
                provider = null
                microphone = null

                nextMicrophone?.stop()

                try {
                    nextProvider?.stop()
                } catch (_: Throwable) {
                    // Preserve the original startup failure.
                }

                android.util.Log.e(
                    LOG_TAG,
                    "Native voice protection startup failed.",
                    error,
                )
            }
        }
    }

    fun onServiceStopping() {
        synchronized(lifecycleLock) {
            stopLocked()
        }
    }

    private fun handleAudioFrame(
        context: android.content.Context,
        voiceProvider: ProtectionVoiceProvider,
        config: VoiceProviderConfig,
        frame: ShortArray,
    ) {
        /*
         * Never acquire lifecycleLock from the audio callback.
         * Provider engine lifetime is protected internally by engineLock.
         */
        if (provider !== voiceProvider) {
            return
        }

        val detected =
            try {
                voiceProvider.process(frame)
            } catch (error: Throwable) {
                android.util.Log.e(
                    LOG_TAG,
                    "Native voice frame processing failed.",
                    error,
                )
                false
            }

        if (!detected) {
            return
        }

        try {
            ProtectionTriggerBus.publish(
                context,
                ProtectionVoiceTrigger(
                    id =
                        java.util.UUID
                            .randomUUID()
                            .toString(),
                    phrase = config.phrase,
                    provider = voiceProvider.id,
                    timestamp =
                        System.currentTimeMillis(),
                ),
            )

            android.util.Log.i(
                LOG_TAG,
                "Native voice trigger detected.",
            )
        } catch (error: Throwable) {
            android.util.Log.e(
                LOG_TAG,
                "Native voice trigger persistence failed.",
                error,
            )
        }
    }

    private fun stopLocked() {
        val currentMicrophone = microphone
        val currentProvider = provider

        /*
         * Reject new runtime frames before recorder/provider teardown begins.
         */
        microphone = null
        provider = null

        /*
         * Recorder first, recognition engine second.
         * engineLock protects any Porcupine process() already in flight.
         */
        currentMicrophone?.stop()

        try {
            currentProvider?.stop()
        } catch (error: Throwable) {
            android.util.Log.e(
                LOG_TAG,
                "Native voice provider shutdown failed.",
                error,
            )
        }
    }
}
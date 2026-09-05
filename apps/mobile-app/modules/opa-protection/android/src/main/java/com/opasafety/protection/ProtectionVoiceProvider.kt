package com.opasafety.protection

import android.content.Context
import ai.picovoice.porcupine.Porcupine

/**
 * Provider-neutral native voice-trigger contract.
 *
 * Android foreground-service lifecycle belongs to OPA Protection Service.
 * Individual recognition engines implement this boundary and may be replaced
 * without changing OPA incident or protection lifecycle code.
 */
internal interface ProtectionVoiceProvider {

    val id: String

    fun start()

    fun process(frame: ShortArray): Boolean

    fun stop()

    fun isRunning(): Boolean

    fun frameLength(): Int

    fun sampleRate(): Int
}

/**
 * Current offline voice provider.
 *
 * This class owns only the Porcupine recognition engine. It does not own
 * Android foreground-service lifecycle, OPA incident activation, location,
 * authentication, or notification behavior.
 *
 * Microphone capture will attach separately after this engine boundary has
 * compiled successfully, avoiding concurrent native + React microphone
 * ownership during migration.
 */
internal class PicovoicePorcupineProtectionProvider(
    private val context: Context,
    private val config: VoiceProviderConfig,
) : ProtectionVoiceProvider {

    override val id: String = PROVIDER_ID

    private val engineLock = Any()

    private var porcupine: Porcupine? = null

    override fun start() {
        synchronized(engineLock) {
            if (porcupine != null) {
                return
            }

            require(config.enabled) {
                "Picovoice provider is disabled."
            }

            require(config.provider == PROVIDER_ID) {
                "Unsupported voice provider: ${config.provider}"
            }

            require(config.accessKey.isNotBlank()) {
                "Picovoice access key is not configured."
            }

            require(config.keywordAssetName.isNotBlank()) {
                "Picovoice keyword asset is not configured."
            }

            require(config.sensitivity in 0.0f..1.0f) {
                "Picovoice sensitivity must be between 0 and 1."
            }

            porcupine =
                Porcupine.Builder()
                    .setAccessKey(config.accessKey)
                    .setKeywordPaths(
                        arrayOf(config.keywordAssetName),
                    )
                    .setSensitivities(
                        floatArrayOf(config.sensitivity),
                    )
                    .build(context)
        }
    }

    override fun process(frame: ShortArray): Boolean =
        synchronized(engineLock) {
            val engine =
                porcupine
                    ?: return@synchronized false

            /*
             * process() and delete() are serialized. Native Porcupine cannot
             * be deleted while a frame is being processed.
             */
            engine.process(frame) == 0
        }

    override fun stop() {
        synchronized(engineLock) {
            val engine =
                porcupine
                    ?: return

            porcupine = null
            engine.delete()
        }
    }

    override fun isRunning(): Boolean =
        synchronized(engineLock) {
            porcupine != null
        }

    override fun frameLength(): Int =
        synchronized(engineLock) {
            porcupine?.frameLength
                ?: throw IllegalStateException(
                    "Picovoice provider is not running.",
                )
        }

    override fun sampleRate(): Int =
        synchronized(engineLock) {
            porcupine?.sampleRate
                ?: throw IllegalStateException(
                    "Picovoice provider is not running.",
                )
        }

    companion object {
        const val PROVIDER_ID =
            "picovoice_porcupine"
    }
}
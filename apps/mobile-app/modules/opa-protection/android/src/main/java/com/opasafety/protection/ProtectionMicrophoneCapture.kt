package com.opasafety.protection

import ai.picovoice.android.voiceprocessor.VoiceProcessor
import ai.picovoice.android.voiceprocessor.VoiceProcessorErrorListener
import ai.picovoice.android.voiceprocessor.VoiceProcessorException
import ai.picovoice.android.voiceprocessor.VoiceProcessorFrameListener

/**
 * Native microphone boundary for OPA Protection Service.
 *
 * This class owns microphone capture only. Keyword recognition remains behind
 * ProtectionVoiceProvider, and incident activation remains outside native
 * audio infrastructure.
 *
 * It is intentionally not attached to ProtectionRuntime yet. The proven
 * React Native Picovoice path remains the sole microphone owner until the
 * native path is switched over deliberately.
 */
internal class ProtectionMicrophoneCapture(
    private val onFrame: (ShortArray) -> Unit,
    private val onError: (VoiceProcessorException) -> Unit,
) {

    private val voiceProcessor =
        VoiceProcessor.getInstance()

    private var running = false

    private val frameListener =
        object : VoiceProcessorFrameListener {
            override fun onFrame(frame: ShortArray) {
                onFrame(frame)
            }
        }

    private val errorListener =
        object : VoiceProcessorErrorListener {
            override fun onError(error: VoiceProcessorException) {
                onError(error)
            }
        }

    @Synchronized
    @Throws(VoiceProcessorException::class)
    fun start(
        frameLength: Int,
        sampleRate: Int,
    ) {
        if (running) {
            return
        }

        voiceProcessor.addFrameListener(frameListener)
        voiceProcessor.addErrorListener(errorListener)

        try {
            voiceProcessor.start(
                frameLength,
                sampleRate,
            )
            running = true
        } catch (error: VoiceProcessorException) {
            /*
             * Do not leave listeners registered after a failed microphone
             * start. A later retry must begin from a clean ownership state.
             */
            voiceProcessor.removeFrameListener(frameListener)
            voiceProcessor.removeErrorListener(errorListener)
            throw error
        }
    }

    @Synchronized
    fun stop() {
        if (!running) {
            /*
             * Defensive cleanup also covers a partially initialized start.
             */
            voiceProcessor.removeFrameListener(frameListener)
            voiceProcessor.removeErrorListener(errorListener)
            return
        }

        /*
         * Detach OPA callbacks before stopping the shared recorder so teardown
         * cannot admit new frames into ProtectionRuntime.
         */
        running = false
        voiceProcessor.removeFrameListener(frameListener)
        voiceProcessor.removeErrorListener(errorListener)

        try {
            voiceProcessor.stop()
        } catch (_: VoiceProcessorException) {
            /*
             * Local OPA ownership is already released even if the recorder
             * reports a shutdown failure.
             */
        }
    }

    @Synchronized
    fun isRunning(): Boolean =
        running
}
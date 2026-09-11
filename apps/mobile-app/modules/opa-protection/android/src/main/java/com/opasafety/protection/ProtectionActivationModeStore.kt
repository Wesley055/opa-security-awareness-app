package com.opasafety.protection

import android.content.Context
import android.util.AtomicFile
import java.io.File

/** Device-local consent. No backup, network, operator policy, or microphone control. */
internal object ProtectionActivationModeStore {
    @Synchronized
    fun read(context: Context): String {
        val file = AtomicFile(File(context.noBackupFilesDir, "opa-sos-mode"))
        return try {
            if (String(file.readFully(), Charsets.UTF_8) == "SILENT") "SILENT" else "STANDARD"
        } catch (_: java.io.IOException) { "STANDARD" }
    }

    @Synchronized
    fun write(context: Context, mode: String) {
        require(mode == "SILENT" || mode == "STANDARD")
        val file = AtomicFile(File(context.noBackupFilesDir, "opa-sos-mode"))
        val stream = file.startWrite()
        try {
            stream.write(mode.toByteArray(Charsets.UTF_8))
            file.finishWrite(stream)
        } catch (error: Throwable) {
            file.failWrite(stream)
            throw error
        }
    }
}

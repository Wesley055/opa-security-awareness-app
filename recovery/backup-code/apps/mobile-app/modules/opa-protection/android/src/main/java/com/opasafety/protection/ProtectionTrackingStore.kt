package com.opasafety.protection

import android.content.Context
import android.util.AtomicFile
import java.io.File

/** A retry obligation, not an authorization or a second journey queue. No backup or coordinates. */
internal object ProtectionTrackingStore {
    private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "opa-emergency-tracking"))

    @Synchronized fun read(context: Context): String? = try {
        String(file(context).readFully(), Charsets.UTF_8).takeIf { it.isNotBlank() }
    } catch (_: java.io.FileNotFoundException) { null }

    @Synchronized fun remember(context: Context, incidentId: String) {
        require(incidentId.isNotBlank() && incidentId.length <= 128)
        val target = file(context)
        val output = target.startWrite()
        try {
            output.write(incidentId.toByteArray(Charsets.UTF_8))
            target.finishWrite(output)
        } catch (error: Throwable) {
            target.failWrite(output)
            throw error
        }
    }

    @Synchronized fun clear(context: Context, expected: String?): Boolean {
        if (expected != null && read(context) != expected) return false
        file(context).delete()
        return true
    }
}

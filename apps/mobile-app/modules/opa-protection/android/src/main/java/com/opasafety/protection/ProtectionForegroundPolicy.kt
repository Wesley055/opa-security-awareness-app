package com.opasafety.protection

internal object ProtectionForegroundPolicy {
    fun isEligible(hasActivity: Boolean, resumed: Boolean, interactive: Boolean, locked: Boolean): Boolean =
        hasActivity && resumed && interactive && !locked
}

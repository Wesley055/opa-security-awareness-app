package com.opasafety.protection

import android.content.Context

internal data class VoiceProviderConfig(
    val enabled: Boolean,
    val provider: String,
    val accessKey: String,
    val keywordAssetName: String,
    val phrase: String,
    val sensitivity: Float,
)

internal object ProtectionProviderConfigStore {

    private const val PREFS_NAME = "opa_protection_provider_config"

    private const val KEY_ENABLED = "voice_enabled"
    private const val KEY_PROVIDER = "voice_provider"
    private const val KEY_ACCESS_KEY = "voice_access_key"
    private const val KEY_KEYWORD_ASSET = "voice_keyword_asset"
    private const val KEY_PHRASE = "voice_phrase"
    private const val KEY_SENSITIVITY = "voice_sensitivity"

    fun saveVoiceProvider(
        context: Context,
        config: VoiceProviderConfig,
    ) {
        require(config.provider.isNotBlank()) {
            "Voice provider is required."
        }

        require(config.accessKey.isNotBlank()) {
            "Voice provider access key is required."
        }

        require(config.keywordAssetName.isNotBlank()) {
            "Voice provider keyword asset is required."
        }

        require(config.phrase.isNotBlank()) {
            "Voice trigger phrase is required."
        }

        require(config.sensitivity in 0.0f..1.0f) {
            "Voice provider sensitivity must be between 0 and 1."
        }

        context
            .getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE,
            )
            .edit()
            .putBoolean(KEY_ENABLED, config.enabled)
            .putString(KEY_PROVIDER, config.provider)
            .putString(KEY_ACCESS_KEY, config.accessKey)
            .putString(KEY_KEYWORD_ASSET, config.keywordAssetName)
            .putString(KEY_PHRASE, config.phrase)
            .putFloat(KEY_SENSITIVITY, config.sensitivity)
            .apply()
    }

    fun loadVoiceProvider(
        context: Context,
    ): VoiceProviderConfig? {
        val preferences =
            context.getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE,
            )

        val provider =
            preferences.getString(KEY_PROVIDER, null)
                ?.trim()
                .orEmpty()

        val accessKey =
            preferences.getString(KEY_ACCESS_KEY, null)
                ?.trim()
                .orEmpty()

        val keywordAssetName =
            preferences.getString(KEY_KEYWORD_ASSET, null)
                ?.trim()
                .orEmpty()

        val phrase =
            preferences.getString(KEY_PHRASE, null)
                ?.trim()
                .orEmpty()

        if (
            provider.isEmpty() ||
            accessKey.isEmpty() ||
            keywordAssetName.isEmpty() ||
            phrase.isEmpty()
        ) {
            return null
        }

        return VoiceProviderConfig(
            enabled =
                preferences.getBoolean(
                    KEY_ENABLED,
                    false,
                ),
            provider = provider,
            accessKey = accessKey,
            keywordAssetName = keywordAssetName,
            phrase = phrase,
            sensitivity =
                preferences.getFloat(
                    KEY_SENSITIVITY,
                    0.5f,
                ),
        )
    }

    fun clearVoiceProvider(
        context: Context,
    ) {
        context
            .getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE,
            )
            .edit()
            .clear()
            .apply()
    }
}
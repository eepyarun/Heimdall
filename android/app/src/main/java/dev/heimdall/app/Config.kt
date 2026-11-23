package dev.heimdall.app

import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.remoteconfig.remoteConfig
import com.google.firebase.remoteconfig.remoteConfigSettings
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/** Same Remote Config keys as the web app (remoteconfig.template.json). */
data class AppConfig(
    val cloudModel: String = "gemini-3.5-flash-lite",
    val verifyModel: String = "gemini-3.8-flash",
    val backupModels: List<String> = listOf("gemini-3.5-flash", "gemini-3.5-flash-lite"),
    val escalateAt: Confidence = Confidence.LOW,
    val escalateMedicineAt: Confidence = Confidence.MEDIUM,
    /** ML Kit's Prompt API is only validated for English and Korean on Android. */
    val onDeviceLanguages: List<String> = listOf("en", "ko"),
)

object Config {
    @Volatile var current = AppConfig()
        private set

    suspend fun load(): AppConfig {
        val d = AppConfig()
        val rc = Firebase.remoteConfig
        rc.setConfigSettingsAsync(remoteConfigSettings { minimumFetchIntervalInSeconds = if (BuildConfig.DEBUG) 60 else 3600 })
        rc.setDefaultsAsync(
            mapOf(
                "cloud_model" to d.cloudModel,
                "verify_model" to d.verifyModel,
                "backup_models" to d.backupModels.joinToString(","),
                "escalate_at" to "low",
                "escalate_medicine_at" to "medium",
            ),
        )
        try {
            withTimeoutOrNull(3000) { rc.fetchAndActivate().await() }
        } catch (e: Exception) {
            Log.w("Heimdall", "Remote Config fetch failed; using defaults", e)
        }
        fun list(key: String) = rc.getString(key).split(',').map { it.trim() }.filter { it.isNotEmpty() }
        current = d.copy(
            cloudModel = rc.getString("cloud_model").ifBlank { d.cloudModel },
            verifyModel = rc.getString("verify_model").ifBlank { d.verifyModel },
            backupModels = list("backup_models"),
            escalateAt = normalizeConfidence(rc.getString("escalate_at")),
            escalateMedicineAt = normalizeConfidence(rc.getString("escalate_medicine_at")),
        )
        return current
    }
}

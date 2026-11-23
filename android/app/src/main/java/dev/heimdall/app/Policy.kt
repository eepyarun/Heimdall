package dev.heimdall.app

/** Pure routing rules shared with the web app (src/lib/policy.ts). No Android or Firebase types, so it is unit-testable. */

enum class Mode { DESCRIBE, READ, IDENTIFY, TRANSLATE, ASK }

enum class Privacy { PRIVATE, SMART, QUALITY }

enum class Confidence { LOW, MEDIUM, HIGH }

enum class RouteMode { PREFER_ON_DEVICE, ONLY_ON_DEVICE, PREFER_IN_CLOUD, ONLY_IN_CLOUD }

data class Route(val mode: RouteMode, val why: String)

class PrivateModeUnavailable :
    Exception("Private mode needs on-device AI, and it is not available on this device. Switch to Smart mode to use the cloud.")

fun chooseRoute(privacy: Privacy, lang: String, deviceReady: Boolean, onDeviceLanguages: List<String>, languageName: String): Route {
    if (privacy == Privacy.PRIVATE) {
        if (!deviceReady) throw PrivateModeUnavailable()
        return Route(RouteMode.ONLY_ON_DEVICE, "Private mode: photos never leave this device")
    }
    if (privacy == Privacy.QUALITY) return Route(RouteMode.PREFER_IN_CLOUD, "Best-quality mode: cloud first, on-device if offline")
    if (lang !in onDeviceLanguages) return Route(RouteMode.PREFER_IN_CLOUD, "$languageName isn't supported by on-device AI yet")
    if (!deviceReady) return Route(RouteMode.PREFER_ON_DEVICE, "On-device AI not available here, so the cloud answers")
    return Route(RouteMode.PREFER_ON_DEVICE, "On-device first: private, free, works offline")
}

/** Smart mode double-checks unsure on-device answers in the cloud; medicine uses a stricter bar. */
fun shouldEscalate(
    privacy: Privacy,
    answeredOnDevice: Boolean,
    confidence: Confidence,
    category: String?,
    escalateAt: Confidence,
    escalateMedicineAt: Confidence,
): Boolean {
    if (privacy != Privacy.SMART || !answeredOnDevice) return false
    val threshold = if (category == "medicine") escalateMedicineAt else escalateAt
    return confidence <= threshold
}

fun normalizeConfidence(v: String?): Confidence =
    when (v?.lowercase()) {
        "high" -> Confidence.HIGH
        "medium" -> Confidence.MEDIUM
        else -> Confidence.LOW
    }

private val BUSY = Regex(
    "high demand|overloaded|unavailable|quota|resource.?exhausted|no longer available|not found for API|\\b(429|500|502|503|504)\\b",
    RegexOption.IGNORE_CASE,
)

/** Errors worth retrying on another cloud model: overload, quota, or a retired model name. */
fun isBusyError(e: Throwable): Boolean = BUSY.containsMatchIn("${e::class.simpleName} ${e.message}")

/** Try the chosen model twice (overload spikes are brief), then each other model once. */
fun modelChain(primary: String, others: List<String>): List<String> =
    listOf(primary) + (listOf(primary) + others.filter { it.isNotBlank() }).distinct()

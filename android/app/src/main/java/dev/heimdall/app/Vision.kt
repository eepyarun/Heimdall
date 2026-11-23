package dev.heimdall.app

import android.graphics.Bitmap
import com.google.firebase.Firebase
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.Schema
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.util.Date

val LANGUAGES = linkedMapOf(
    "en" to "English", "es" to "Spanish", "ja" to "Japanese", "hi" to "Hindi", "ar" to "Arabic", "fr" to "French",
    "de" to "German", "zh" to "Chinese (Simplified)", "pt" to "Portuguese", "ko" to "Korean", "ta" to "Tamil",
)

data class Fact(val label: String, val value: String)
data class LinePair(val original: String, val translation: String)

data class VisionResult(
    val speech: String,
    val confidence: Confidence,
    val tip: String,
    val hazards: List<String> = emptyList(),
    val category: String? = null,
    val name: String? = null,
    val facts: List<Fact> = emptyList(),
    val warnings: List<String> = emptyList(),
    val text: String? = null,
    val translation: String? = null,
    val sourceLanguage: String? = null,
    val lines: List<LinePair> = emptyList(),
)

data class Attempt(val onDevice: Boolean, val model: String, val confidence: Confidence?, val ms: Long, val reason: String)

data class Answer(val mode: Mode, val result: VisionResult, val attempts: List<Attempt>, val escalated: Boolean)

// ---------- schemas & prompts (kept in sync with src/lib/vision.ts) ----------

private val str = Schema.string()
private val strList = Schema.array(Schema.string())
private val base = mapOf(
    "speech" to str,
    "confidence" to Schema.enumeration(listOf("high", "medium", "low")),
    "tip" to str,
)

private fun schema(mode: Mode): Schema = when (mode) {
    Mode.DESCRIBE -> Schema.obj(base + mapOf("hazards" to strList))
    Mode.READ -> Schema.obj(base + mapOf("text" to str))
    Mode.IDENTIFY -> Schema.obj(
        base + mapOf(
            "category" to Schema.enumeration(listOf("medicine", "money", "food", "product", "document", "other")),
            "name" to str,
            "facts" to Schema.array(Schema.obj(mapOf("label" to str, "value" to str))),
            "warnings" to strList,
        ),
    )
    Mode.TRANSLATE -> Schema.obj(
        base + mapOf(
            "sourceLanguage" to str,
            "text" to str,
            "translation" to str,
            "lines" to Schema.array(Schema.obj(mapOf("original" to str, "translation" to str))),
        ),
    )
    Mode.ASK -> Schema.obj(base)
}

private val WORDS = mapOf(Mode.DESCRIBE to 40, Mode.READ to 70, Mode.IDENTIFY to 40, Mode.TRANSLATE to 70, Mode.ASK to 45)

fun prompt(mode: Mode, lang: String, question: String?): String {
    val langName = LANGUAGES[lang] ?: "English"
    val rules = """You are Heimdall, the eyes of a person who is blind or has low vision. They took this photo with their phone camera and cannot see it.
Rules:
- Write "speech" in $langName. It is read aloud: at most ${WORDS[mode]} words, the most important thing first, plain words, no markdown or lists.
- Never guess. If something is blurry, cut off, too dark, or too small to read, say so plainly.
- confidence: "high" only if you are sure; "medium" if part of it is unclear; "low" if the photo is too poor to be sure.
- tip: if the photo is poor, one short instruction to fix it, such as "Move the camera closer", "Add more light", or "Tilt the camera down". Otherwise an empty string."""
    return rules + "\n" + when (mode) {
        Mode.DESCRIBE -> """Task: describe what is in front of them so they can act safely.
- Mention hazards first (steps, curbs, obstacles, vehicles, wet floors, open doors), with clock directions ("at 2 o'clock") and rough distance in steps.
- Then the main objects and layout. Describe people only by what they are doing; never identify anyone.
- hazards: each hazard as a short phrase, or [] if none."""
        Mode.READ -> """Task: read the text in the photo.
- text: transcribe ALL readable text exactly as written, in reading order, keeping line breaks. Do not translate it.
- speech: first say what it is in a few words (a letter, a medicine label, a screen, a sign), then the most important part: for mail, who it is from and what it asks; for a screen, the main message; for a short sign, the whole sign."""
        Mode.IDENTIFY -> """Task: identify the main item they are holding or pointing the camera at.
- category: medicine, money, food, product, document, or other.
- name: what it is. For money, the denomination and currency, like "20 US dollars".
- facts: the details that matter, copied exactly from the label. Medicine: drug name, strength, directions, expiry date. Food: product, best-before date, allergens. Product: brand, product, size, key instructions.
- warnings: safety warnings, allergens, or an expiry date that has passed (today is ${Date()}). [] if none.
- For medicine, confidence is "high" only if the drug name AND strength are clearly readable."""
        Mode.TRANSLATE -> """Task: find the foreign-language text (sign, menu, label, notice) and translate it into $langName.
- sourceLanguage: the language of the original text, in English.
- text: the original text exactly. translation: the full translation in $langName.
- lines: the original text line by line, in reading order, each line copied exactly (including prices) with its $langName translation.
- speech: a natural spoken summary of what it says, entirely in $langName; never read the original words aloud. For menus, the translated dishes and prices."""
        Mode.ASK -> """Task: answer this question about the photo: "${question.orEmpty()}"
- speech: a direct, specific answer. If the photo does not show the answer, say so and suggest how to point the camera."""
    }
}

private fun JSONObject.strings(key: String): List<String> =
    optJSONArray(key)?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()

private fun <T> JSONArray?.objects(f: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.let(f) }

fun parse(raw: String): VisionResult {
    val cleaned = raw.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
    return try {
        val j = JSONObject(cleaned)
        VisionResult(
            speech = j.optString("speech").trim(),
            confidence = normalizeConfidence(j.optString("confidence")),
            tip = j.optString("tip").trim(),
            hazards = j.strings("hazards"),
            category = j.optString("category").ifBlank { null },
            name = j.optString("name").ifBlank { null },
            facts = j.optJSONArray("facts").objects { Fact(it.optString("label"), it.optString("value")) },
            warnings = j.strings("warnings"),
            text = j.optString("text").ifBlank { null },
            translation = j.optString("translation").ifBlank { null },
            sourceLanguage = j.optString("sourceLanguage").ifBlank { null },
            lines = j.optJSONArray("lines").objects { LinePair(it.optString("original"), it.optString("translation")) },
        )
    } catch (e: Exception) {
        VisionResult(speech = raw.take(400), confidence = Confidence.LOW, tip = "")
    }
}

// ---------- models ----------

private val RouteMode.sdk: InferenceMode
    get() = when (this) {
        RouteMode.PREFER_ON_DEVICE -> InferenceMode.PREFER_ON_DEVICE
        RouteMode.ONLY_ON_DEVICE -> InferenceMode.ONLY_ON_DEVICE
        RouteMode.PREFER_IN_CLOUD -> InferenceMode.PREFER_IN_CLOUD
        RouteMode.ONLY_IN_CLOUD -> InferenceMode.ONLY_IN_CLOUD
    }

@OptIn(PublicPreviewAPI::class)
private fun model(route: RouteMode, cloudModel: String, mode: Mode?): GenerativeModel =
    Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
        modelName = cloudModel,
        generationConfig = generationConfig {
            temperature = 0.2f
            if (mode != null) {
                responseMimeType = "application/json"
                responseSchema = schema(mode)
            }
        },
        onDeviceConfig = OnDeviceConfig(mode = route.sdk, temperature = 0.2f, topK = 3),
    )

enum class DeviceState { CHECKING, UNAVAILABLE, DOWNLOADABLE, DOWNLOADING, AVAILABLE }

@OptIn(PublicPreviewAPI::class)
object Device {
    @Volatile var state = DeviceState.CHECKING
        private set

    private val probe by lazy { model(RouteMode.PREFER_ON_DEVICE, Config.current.cloudModel, null) }

    suspend fun check(): DeviceState {
        state = try {
            when (probe.onDeviceExtension?.checkStatus()) {
                OnDeviceModelStatus.AVAILABLE -> DeviceState.AVAILABLE
                OnDeviceModelStatus.DOWNLOADABLE -> DeviceState.DOWNLOADABLE
                OnDeviceModelStatus.DOWNLOADING -> DeviceState.DOWNLOADING
                else -> DeviceState.UNAVAILABLE
            }
        } catch (e: Exception) {
            DeviceState.UNAVAILABLE
        }
        return state
    }

    /** Download Gemini Nano through AICore (if needed) and load it, so the first answer is fast. */
    suspend fun prepare(onUpdate: (DeviceState) -> Unit) {
        val ext = probe.onDeviceExtension ?: return
        if (check() == DeviceState.DOWNLOADABLE) {
            state = DeviceState.DOWNLOADING
            onUpdate(state)
            runCatching { ext.download().collect { } }
        }
        if (check() == DeviceState.AVAILABLE) runCatching { ext.warmUp() }
        onUpdate(state)
    }
}

// ---------- running ----------

private const val ON_DEVICE_TIMEOUT_MS = 30_000L

private class Result(val result: VisionResult, val onDevice: Boolean, val ms: Long, val model: String)

private suspend fun attempt(mode: Mode, route: RouteMode, cloudModel: String, text: String, image: Bitmap, timeoutMs: Long?): Result {
    val cfg = Config.current
    val tries = modelChain(cloudModel, listOf(cfg.verifyModel) + cfg.backupModels + cfg.cloudModel)
    val t0 = System.currentTimeMillis()
    val input = content {
        image(image)
        text(text)
    }
    for ((i, name) in tries.withIndex()) {
        try {
            val m = model(route, name, mode)
            val res = if (timeoutMs != null) withTimeout(timeoutMs) { m.generateContent(input) } else m.generateContent(input)
            return Result(parse(res.text.orEmpty()), res.inferenceSource == InferenceSource.ON_DEVICE, System.currentTimeMillis() - t0, name)
        } catch (e: TimeoutCancellationException) {
            throw e
        } catch (e: Exception) {
            if (!isBusyError(e) || i == tries.lastIndex) throw e
            if (tries[i + 1] == name) delay(800)
        }
    }
    error("No answer")
}

suspend fun see(mode: Mode, image: Bitmap, privacy: Privacy, lang: String, question: String?): Answer {
    val cfg = Config.current
    val deviceReady = Device.state == DeviceState.AVAILABLE
    val route = chooseRoute(privacy, lang, deviceReady, cfg.onDeviceLanguages, LANGUAGES[lang] ?: lang)
    val text = prompt(mode, lang, question)
    val attempts = mutableListOf<Attempt>()

    val first = try {
        val timeout = if (deviceReady && route.mode == RouteMode.PREFER_ON_DEVICE) ON_DEVICE_TIMEOUT_MS else null
        attempt(mode, route.mode, if (privacy == Privacy.QUALITY) cfg.verifyModel else cfg.cloudModel, text, image, timeout)
    } catch (e: TimeoutCancellationException) {
        attempts += Attempt(true, "Gemini Nano", null, ON_DEVICE_TIMEOUT_MS, "On-device AI was too slow, so Heimdall asked the cloud instead")
        null
    }

    if (first != null) {
        attempts += Attempt(
            onDevice = first.onDevice,
            model = if (first.onDevice) "Gemini Nano" else first.model,
            confidence = first.result.confidence,
            ms = first.ms,
            reason = when {
                first.onDevice -> route.why
                route.mode == RouteMode.PREFER_ON_DEVICE -> "On-device AI not available here, so the cloud answered"
                else -> route.why
            },
        )
        val escalate = shouldEscalate(privacy, first.onDevice, first.result.confidence, first.result.category, cfg.escalateAt, cfg.escalateMedicineAt)
        if (!escalate) return Answer(mode, first.result, attempts, false)
    }

    val verified = attempt(mode, RouteMode.ONLY_IN_CLOUD, cfg.verifyModel, text, image, null)
    attempts += Attempt(
        onDevice = false,
        model = verified.model,
        confidence = verified.result.confidence,
        ms = verified.ms,
        reason = if (first != null) {
            val unsure = if (first.result.confidence == Confidence.LOW) "unsure" else "not certain"
            val med = if (first.result.category == "medicine") " about a medicine" else ""
            "On-device AI was $unsure$med, so Heimdall double-checked with a stronger cloud model"
        } else {
            "Answered by the cloud after the on-device timeout"
        },
    )
    return Answer(mode, verified.result, attempts, first != null)
}

fun scaleForModel(b: Bitmap): Bitmap {
    val scale = minOf(1f, 1024f / maxOf(b.width, b.height))
    return if (scale >= 1f) b else Bitmap.createScaledBitmap(b, (b.width * scale).toInt(), (b.height * scale).toInt(), true)
}

fun errorMessage(e: Throwable): String {
    val s = "${e::class.simpleName} ${e.message}"
    return when {
        e is PrivateModeUnavailable -> e.message!!
        Regex("api key|app.?check|403|401", RegexOption.IGNORE_CASE).containsMatchIn(s) -> "Heimdall could not reach its cloud AI. Check the Firebase setup."
        isBusyError(e) -> "The cloud AI is busy right now. Please try again in a moment."
        Regex("UnknownHost|network|connect", RegexOption.IGNORE_CASE).containsMatchIn(s) -> "You seem to be offline and on-device AI is not available here."
        else -> "Something went wrong: ${e.message}"
    }
}

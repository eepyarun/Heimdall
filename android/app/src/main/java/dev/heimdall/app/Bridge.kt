package dev.heimdall.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * `window.HeimdallAndroid` for the web UI (see src/lib/native.ts). Async methods take an id and
 * answer through window.__heimdallNative.resolve / reject.
 */
class Bridge(private val activity: MainActivity, private val web: WebView) {
    private val scope = MainScope()
    private var recognizer: SpeechRecognizer? = null
    private val tts = TextToSpeech(activity.applicationContext) { event("voiceschanged", "{}") }

    // ---------- plumbing ----------

    private fun js(code: String) = web.post { web.evaluateJavascript(code, null) }

    private fun resolve(id: Int, json: String) = js("window.__heimdallNative.resolve($id, ${JSONObject.quote(json)})")

    private fun reject(id: Int, message: String) = js("window.__heimdallNative.reject($id, ${JSONObject.quote(message)})")

    private fun event(name: String, json: String) =
        js("window.__heimdallNative && window.__heimdallNative.event(${JSONObject.quote(name)}, ${JSONObject.quote(json)})")

    private fun async(id: Int, block: suspend () -> String) {
        scope.launch {
            try {
                resolve(id, block())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                // Keep the cause: the web app looks for words like "503", "quota" or "App Check" in it.
                val cause = e.cause?.message?.let { " ($it)" } ?: ""
                reject(id, "${e::class.simpleName}: ${e.message}$cause")
            }
        }
    }

    fun destroy() {
        scope.cancel()
        recognizer?.destroy()
        tts.shutdown()
    }

    // ---------- AI & App Check ----------

    @JavascriptInterface
    fun generate(id: Int, request: String) = async(id) { NativeAI.generate(JSONObject(request)).toString() }

    @JavascriptInterface
    fun deviceStatus(id: Int) = async(id) { JSONObject.quote(NativeAI.status()) }

    @JavascriptInterface
    fun prepareDevice(id: Int) = async(id) {
        NativeAI.prepare()
        "null"
    }

    @JavascriptInterface
    fun appCheckToken(id: Int, forceRefresh: Boolean) = async(id) {
        val t = Firebase.appCheck.getAppCheckToken(forceRefresh).await()
        JSONObject().put("token", t.token).put("expireTimeMillis", t.expireTimeMillis).toString()
    }

    // ---------- speech out ----------

    @JavascriptInterface
    fun speak(text: String, lang: String, rate: Double, voice: String) {
        val v = voice.takeIf { it.isNotEmpty() }?.let { name -> tts.voices?.firstOrNull { it.name == name } }
        if (v != null) tts.voice = v else tts.language = Locale.forLanguageTag(lang)
        tts.setSpeechRate(rate.toFloat())
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "heimdall")
    }

    @JavascriptInterface
    fun stopSpeaking() {
        tts.stop()
    }

    @JavascriptInterface
    fun isSpeaking(): Boolean = tts.isSpeaking

    /** Same shape as the browser's SpeechSynthesisVoice, best quality first. */
    @JavascriptInterface
    fun voices(): String {
        val list = runCatching { tts.voices }.getOrNull().orEmpty()
            .filter { TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features }
            .sortedByDescending { it.quality }
        val out = JSONArray()
        for (v in list) {
            val kind = if (v.isNetworkConnectionRequired) "online" else "on-device"
            out.put(
                JSONObject()
                    .put("name", "${v.locale.displayName} · ${v.name.substringAfter("-x-").substringBefore("-")} ($kind)")
                    .put("lang", v.locale.toLanguageTag())
                    .put("voiceURI", v.name)
                    .put("localService", !v.isNetworkConnectionRequired),
            )
        }
        return out.toString()
    }

    // ---------- speech in ----------

    @JavascriptInterface
    fun listen(id: Int, lang: String) {
        scope.launch {
            if (!activity.ensurePermission(Manifest.permission.RECORD_AUDIO)) {
                reject(id, "Microphone permission was denied.")
                return@launch
            }
            if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
                reject(id, "Speech recognition is not available on this phone.")
                return@launch
            }
            recognizer?.destroy()
            val r = SpeechRecognizer.createSpeechRecognizer(activity)
            recognizer = r
            r.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle) {
                    resolve(id, JSONObject.quote(results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()))
                }

                override fun onError(error: Int) {
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) resolve(id, "\"\"")
                    else reject(id, "Speech recognition: error $error")
                }

                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            r.startListening(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1),
            )
        }
    }

    @JavascriptInterface
    fun stopListening() {
        scope.launch { recognizer?.stopListening() }
    }

    // ---------- haptics ----------

    /** Web pattern: a number or [on, off, on, …] in ms. */
    @JavascriptInterface
    fun vibrate(pattern: String) {
        val parsed = runCatching { JSONArray(pattern).let { a -> LongArray(a.length()) { a.getLong(it) } } }
            .getOrElse { longArrayOf(pattern.toLongOrNull() ?: 30L) }
        val vibrator = if (Build.VERSION.SDK_INT >= 31) {
            (activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0L) + parsed, -1))
    }
}

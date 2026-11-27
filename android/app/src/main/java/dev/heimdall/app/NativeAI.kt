@file:OptIn(PublicPreviewAPI::class)

package dev.heimdall.app

import android.graphics.BitmapFactory
import android.util.Base64
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
import org.json.JSONObject

/**
 * Firebase AI Logic hybrid inference for the Android app. The web UI (src/lib/vision.ts) keeps all the
 * routing policy, timeouts and escalation; this runs each single call it asks for. On phones with
 * Gemini Nano in AICore (Pixel 8+, Galaxy S24+ and similar) on-device routes run locally; elsewhere the
 * SDK answers from the cloud, exactly like the web app.
 */
object NativeAI {
    /** Only used to probe and download the on-device model; the cloud model name is irrelevant there. */
    private const val PROBE_CLOUD_MODEL = "gemini-3.5-flash-lite"

    private fun inferenceMode(route: String) = when (route) {
        "only_on_device" -> InferenceMode.ONLY_ON_DEVICE
        "prefer_in_cloud" -> InferenceMode.PREFER_IN_CLOUD
        "only_in_cloud" -> InferenceMode.ONLY_IN_CLOUD
        else -> InferenceMode.PREFER_ON_DEVICE
    }

    private fun model(route: String, cloudModel: String, schema: Schema?): GenerativeModel =
        Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = cloudModel,
            generationConfig = generationConfig {
                temperature = 0.2f
                if (schema != null) {
                    responseMimeType = "application/json"
                    responseSchema = schema
                }
            },
            onDeviceConfig = OnDeviceConfig(mode = inferenceMode(route), temperature = 0.2f, topK = 3),
        )

    private val probe by lazy { model("prefer_on_device", PROBE_CLOUD_MODEL, null) }

    /** Same values as the web app's DeviceState. */
    suspend fun status(): String = try {
        when (probe.onDeviceExtension?.checkStatus()) {
            null -> "unsupported"
            OnDeviceModelStatus.AVAILABLE -> "available"
            OnDeviceModelStatus.DOWNLOADABLE -> "downloadable"
            OnDeviceModelStatus.DOWNLOADING -> "downloading"
            else -> "unavailable"
        }
    } catch (e: Exception) {
        "unavailable"
    }

    /** Downloads Gemini Nano through AICore if needed, then loads it so the first answer is fast. */
    suspend fun prepare() {
        val ext = probe.onDeviceExtension ?: return
        if (status() == "downloadable") runCatching { ext.download().collect { } }
        if (status() == "available") runCatching { ext.warmUp() }
    }

    /** request: { route, model, prompt, image (base64), schema (JSON Schema) } → { text, source }. */
    suspend fun generate(request: JSONObject): JSONObject {
        val route = request.getString("route")
        val schemaJson = request.optJSONObject("schema")
        val bytes = Base64.decode(request.getString("image"), Base64.DEFAULT)
        val image = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: error("Could not read the photo")
        var prompt = request.getString("prompt")
        // Structured output is a cloud feature; spell the shape out for Gemini Nano too.
        if (route != "only_in_cloud" && schemaJson != null) {
            prompt += "\n\nReply with only a JSON object, no markdown, matching this JSON schema:\n$schemaJson"
        }
        val res = model(route, request.getString("model"), schemaJson?.let(::toSchema)).generateContent(
            content {
                image(image)
                text(prompt)
            },
        )
        return JSONObject()
            .put("text", res.text.orEmpty())
            .put("source", if (res.inferenceSource == InferenceSource.ON_DEVICE) "on_device" else "in_cloud")
    }

    /** Converts the web app's JSON Schemas (object / array / string / enum) to the SDK's Schema. */
    private fun toSchema(j: JSONObject): Schema {
        j.optJSONArray("enum")?.let { e -> return Schema.enumeration(List(e.length()) { e.getString(it) }) }
        return when (j.optString("type")) {
            "object" -> {
                val props = j.optJSONObject("properties") ?: JSONObject()
                val required = j.optJSONArray("required")?.let { r -> List(r.length()) { r.getString(it) } }
                val properties = props.keys().asSequence().associateWith { toSchema(props.getJSONObject(it)) }
                Schema.obj(properties, optionalProperties = properties.keys.filter { required != null && it !in required })
            }
            "array" -> Schema.array(toSchema(j.optJSONObject("items") ?: JSONObject().put("type", "string")))
            "integer" -> Schema.integer()
            "number" -> Schema.double()
            "boolean" -> Schema.boolean()
            else -> Schema.string()
        }
    }
}

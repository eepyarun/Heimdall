package dev.heimdall.app

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.Bundle
import android.speech.tts.TextToSpeech
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch
import java.util.Locale

private val Primary = Color(0xFF7CACF8)
private val Bg = Color(0xFF1A1D20)
private val Panel = Color(0xFF24282C)

class MainActivity : ComponentActivity() {
    private var tts: TextToSpeech? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tts = TextToSpeech(this) { }
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Primary, background = Bg, surface = Panel)) {
                HeimdallScreen(speak = ::speak)
            }
        }
    }

    private fun speak(text: String, lang: String) {
        tts?.language = Locale.forLanguageTag(lang)
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "heimdall")
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }
}

private val MODE_LABELS = listOf(
    Mode.DESCRIBE to "Describe", Mode.READ to "Read", Mode.IDENTIFY to "Identify", Mode.TRANSLATE to "Translate", Mode.ASK to "Ask",
)

private val DEVICE_COPY = mapOf(
    DeviceState.CHECKING to "Checking…",
    DeviceState.AVAILABLE to "On-device AI ready",
    DeviceState.DOWNLOADABLE to "Tap to enable on-device AI",
    DeviceState.DOWNLOADING to "Downloading on-device AI",
    DeviceState.UNAVAILABLE to "Cloud AI",
)

@Composable
fun HeimdallScreen(speak: (String, String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var hasCamera by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var device by remember { mutableStateOf(DeviceState.CHECKING) }
    var mode by remember { mutableStateOf(Mode.DESCRIBE) }
    var privacy by remember { mutableStateOf(Privacy.SMART) }
    var lang by remember { mutableStateOf("en") }
    var question by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    var frozen by remember { mutableStateOf<Bitmap?>(null) }
    var answer by remember { mutableStateOf<Answer?>(null) }

    val controller = remember {
        LifecycleCameraController(context).apply { setEnabledUseCases(LifecycleCameraController.IMAGE_CAPTURE) }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasCamera = it }

    LaunchedEffect(Unit) {
        if (!hasCamera) permission.launch(Manifest.permission.CAMERA)
        Config.load()
        device = Device.check()
    }

    fun run(image: Bitmap) {
        busy = true
        answer = null
        frozen = image
        status = if (mode == Mode.ASK) "Thinking…" else "Looking…"
        scope.launch {
            try {
                val a = see(mode, scaleForModel(image), privacy, lang, question.ifBlank { null })
                answer = a
                status = ""
                val prefix = if (a.escalated) "Double-checked. " else ""
                val tip = if (a.result.tip.isNotBlank()) " Tip: ${a.result.tip}" else ""
                speak(prefix + a.result.speech + tip, lang)
            } catch (e: Exception) {
                status = errorMessage(e)
                speak(status, "en")
            } finally {
                busy = false
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }?.let(::run)
    }

    fun capture() {
        if (!hasCamera) return permission.launch(Manifest.permission.CAMERA)
        controller.takePicture(
            ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    val rotation = image.imageInfo.rotationDegrees
                    val raw = image.toBitmap()
                    image.close()
                    val upright = if (rotation == 0) raw else
                        Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
                    run(upright)
                }

                override fun onError(exception: ImageCaptureException) {
                    status = "The camera could not take a photo. Try again."
                }
            },
        )
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Heimdall", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.semantics { heading() })
            Spacer(Modifier.weight(1f))
            OutlinedButton(
                onClick = { scope.launch { Device.prepare { device = it } } },
                enabled = device == DeviceState.DOWNLOADABLE,
            ) { Text(DEVICE_COPY.getValue(device), color = Primary) }
        }

        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(3f / 4f)
                .clip(RoundedCornerShape(20.dp))
                .background(Color.Black),
        ) {
            val shot = frozen
            if (shot != null) {
                Image(shot.asImageBitmap(), contentDescription = "Photo being described", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                OutlinedButton(onClick = { frozen = null; answer = null }, modifier = Modifier.align(Alignment.BottomCenter).padding(8.dp)) {
                    Text("Back to live camera", color = Color.White)
                }
            } else if (hasCamera) {
                AndroidView(
                    factory = { ctx ->
                        PreviewView(ctx).apply {
                            this.controller = controller
                            controller.bindToLifecycle(ctx as androidx.lifecycle.LifecycleOwner)
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Text("Camera permission is needed. Or use Choose photo.", color = Color.White, modifier = Modifier.align(Alignment.Center).padding(24.dp))
            }
        }

        // All five modes stay visible: horizontal scrolling is hard for TalkBack users.
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            MODE_LABELS.forEach { (m, label) ->
                FilterChip(selected = mode == m, onClick = { mode = m }, label = { Text(label, fontSize = 12.sp, maxLines = 1) }, modifier = Modifier.weight(1f))
            }
        }

        if (mode == Mode.ASK) {
            OutlinedTextField(question, { question = it }, label = { Text("Your question") }, modifier = Modifier.fillMaxWidth())
        }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !busy) {
                Text("Choose photo", color = Color.White)
            }
            Button(
                onClick = ::capture,
                enabled = !busy,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = Bg),
                modifier = Modifier.size(96.dp).semantics { contentDescription = "${MODE_LABELS.first { it.first == mode }.second}. Take photo and look" },
            ) { Text(if (busy) "…" else "Look", fontWeight = FontWeight.Bold) }
        }

        Text("Privacy", color = Color.Gray)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(Privacy.PRIVATE to "Private", Privacy.SMART to "Smart", Privacy.QUALITY to "Best quality").forEach { (p, label) ->
                FilterChip(selected = privacy == p, onClick = { privacy = p }, label = { Text(label) })
            }
        }
        OutlinedButton(onClick = {
            val keys = LANGUAGES.keys.toList()
            lang = keys[(keys.indexOf(lang) + 1) % keys.size]
        }) { Text("Answer language: ${LANGUAGES[lang]}", color = Color.White) }

        if (status.isNotBlank()) {
            Text(status, color = Color.White, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        }

        answer?.let { AnswerView(it, onRepeat = { speak(it.result.speech, lang) }) }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun AnswerView(a: Answer, onRepeat: () -> Unit) {
    val r = a.result
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Panel)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val engine = if (a.attempts.lastOrNull()?.onDevice == true) "On this device" else "Cloud"
        val conf = when (r.confidence) { Confidence.HIGH -> "Sure"; Confidence.MEDIUM -> "Fairly sure"; Confidence.LOW -> "Not sure" }
        Text("$engine · $conf${if (a.escalated) " · Double-checked" else ""}", color = Primary, fontSize = 13.sp)
        Text(r.speech, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        if (r.tip.isNotBlank()) Text("Tip: ${r.tip}", color = Primary)
        if (r.hazards.isNotEmpty()) Text("Hazards: " + r.hazards.joinToString("; "), color = Color(0xFFFF8A80))
        r.facts.forEach { Text("${it.label}: ${it.value}", color = Color.White) }
        if (r.warnings.isNotEmpty()) Text("Warnings: " + r.warnings.joinToString("; "), color = Color(0xFFFF8A80))
        if (r.lines.isNotEmpty()) {
            Text("Translation${r.sourceLanguage?.let { " from $it" } ?: ""}", color = Color.Gray)
            Row { Text("Original", color = Color.Gray, modifier = Modifier.weight(1f)); Text("Translation", color = Color.Gray, modifier = Modifier.weight(1f)) }
            r.lines.forEach {
                Row { Text(it.original, color = Color.White, modifier = Modifier.weight(1f)); Text(it.translation, color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)) }
            }
        } else if (r.translation != null) {
            Text(r.translation, color = Color.White)
        }
        if (r.text != null && r.lines.isEmpty()) Text(r.text, color = Color.LightGray)
        OutlinedButton(onClick = onRepeat) { Text("Repeat", color = Color.White) }
        Text("How this answer was made", color = Color.Gray, fontSize = 13.sp)
        a.attempts.forEach {
            Text("• ${it.model} (${it.ms} ms): ${it.reason}", color = Color.Gray, fontSize = 13.sp)
        }
    }
}

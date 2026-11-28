# Heimdall: eyes for everyone

Point your camera and hear what's there. Heimdall is a **privacy-first** camera guide: **describe** a room, **read** a letter, **identify** medicine or products, **translate** a sign, or **ask** a question, all by voice, with one big button.

It is built for **anyone who wants help from the camera without sending every photo to the cloud first**: people who are blind or have low vision, older adults who want large buttons and spoken answers, and anyone who prefers on-device AI until they choose otherwise.

It runs **on your device first** with Gemini Nano, and only falls back to (or double-checks with) Gemini in the cloud through **Firebase AI Logic hybrid inference** when you allow it.

> Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/). Platforms: **Web** (Chrome; installable as a PWA on iOS and Android, live at https://heimdall-50c68.web.app) and **Android app** (Kotlin + the web UI, `android/`). Source: https://github.com/eepyarun/Heimdall

## Try it

- **Web:** open https://heimdall-50c68.web.app in Chrome (desktop Chrome can run Gemini Nano on-device).
- **Android:** [**Download Heimdall.apk**](https://github.com/eepyarun/Heimdall/releases/latest/download/Heimdall.apk) (Android 8.0+). Open the file on your phone and allow "Install unknown apps" when asked. On phones with Gemini Nano in AICore (for example Pixel 8 and newer, Galaxy S24 and newer) answers can run on-device; on other phones they come from the cloud. All releases: [Releases](https://github.com/eepyarun/Heimdall/releases).

## Why hybrid matters here

Camera AI sees the most private things in people's lives: prescription bottles, bank letters, mail, the inside of a home. Most assistants upload every photo to a server. Many people, especially older adults and anyone careful about privacy, would rather keep that on the device. On-device AI is private, free and works **offline**, but it is small, and **a confidently wrong answer about a medicine is dangerous**.

Heimdall treats the two models as one system with a privacy-and-safety policy:

| Situation | What Heimdall does |
| --- | --- |
| Gemini Nano available, clear photo | Answers **on-device**. Nothing leaves the device. Works offline. |
| Nano is **unsure** (it rates its own confidence) | **Smart mode** re-asks a stronger cloud model and says "Double-checked". |
| It's a **medicine** and Nano is only "fairly sure" | Stricter bar: double-checked in the cloud (threshold in Remote Config). |
| Language Nano can't speak (e.g. Hindi, Arabic) | Routed to the cloud, and the reason is shown. |
| Nano slow or can't answer | After 8 seconds (or on an error) Heimdall **asks** whether to switch to cloud AI for this photo: a pop-up with **Use cloud AI / Keep waiting**, spoken aloud too. If the question was asked by voice, it listens for "yes" or "no". In Smart mode, if nobody answers, it still switches after 30 seconds. In Private mode, it asks for consent to send that one photo. |
| Phone or browser without Nano (e.g. iPhone) | Same app; Firebase AI Logic falls back to the cloud automatically. |
| **Private mode** | **On-device only and offline.** Photos and answers never use the cloud. If there is no on-device model, Heimdall **refuses** rather than silently uploading (see below). |
| Offline with on-device AI | Still works: Private or Smart mode on the device, and the app shell is cached by a service worker. |
| Cloud model overloaded or out of free-tier quota | Retries once, then walks a backup model list from Remote Config; the trail shows which model answered. |

Every answer has a "How this answer was made" trail: which model answered, its confidence, latency and *why* it was routed there.

### A gotcha we designed around

In the Web SDK, if the browser has **no `LanguageModel` API at all**, a model created with `ONLY_ON_DEVICE` is given no Chrome adapter and the request is sent **to the cloud**. For a privacy mode, that's unacceptable, so Heimdall checks `LanguageModel.availability()` itself before every Private-mode request (`src/lib/policy.ts`, `src/lib/device.ts`).

## Firebase products used

- **Firebase AI Logic** (`firebase/ai`): `getGenerativeModel` with `InferenceMode` `PREFER_ON_DEVICE` / `ONLY_ON_DEVICE` / `PREFER_IN_CLOUD` / `ONLY_IN_CLOUD`, image + text input, structured JSON output on both paths (`responseConstraint` on-device, `responseJsonSchema` in the cloud), `initializeDeviceModel()` warm-up, and `response.inferenceSource` for routing transparency. See `src/lib/vision.ts`.
- **App Check**: reCAPTCHA Enterprise (or v3) in production, debug token for development.
- **Authentication**: anonymous sign-in, no account needed.
- **Cloud Firestore**: "My things", saved medicines/items (text only, never photos), so Heimdall can say "This is your saved Lisinopril". Owner-only security rules.
- **Remote Config**: cloud models, backup models, escalation thresholds (general and medicine), on-device languages, tunable without a release. Shared by web and Android.
- **Hosting**: static PWA.

## Accessibility and ease of use

Designed so blind and low-vision users, older adults, and anyone who prefers listening over reading can use the same app.

- **Warnings first.** Every answer has an `alerts` field: medicine warnings, allergens, expiry dates, danger signs, steps and traffic. Alerts are spoken before anything else ("Warning. May cause dizziness."), with an alarm tone, a long vibration and a red box.
- One huge **Look** button, **Voice** to ask a question about what the camera sees, and **Live** to hear only what changes as you move.
- **Private / Smart / Best quality** is one tap away: the chip in the top bar shows the current mode and engine ("Smart · Cloud") and opens the three choices, so you never have to dig into Settings to choose between on-device and cloud AI. Look, Live and Voice stay pinned to the bottom of the screen on phones.
- **Follow-up questions** about the same photo by voice or by typing (the box under each answer).
- Answers are spoken in sentence-sized chunks with the most natural voice on the device (choosable in Settings) and announced through an ARIA live region. Any tap interrupts speech; "One moment, analyzing" covers the wait.
- Prompts use clock directions, distances in steps, plain language, never guess, and a camera **tip** ("Move closer", "Add more light") when the photo is poor.
- WCAG AAA design: 7:1 text contrast in light and dark themes, flat surfaces, Atkinson Hyperlegible, 56px+ touch targets, support for system contrast, reduced motion and Windows high-contrast modes.
- Each mode has its own colour **and** icon, and the selected one is also marked with a check and an underline, so colour is never the only signal. **Calm** (muted, default) and **Vivid** colour styles, because bright multi-colour screens can overwhelm some users.
- Keyboard: **Space** look, **M** ask by voice, **L** live, **1–5** modes, **R** repeat, **Esc** stop.

## Run it locally

Requirements: Node 20+, Chrome 139+ on desktop (Windows, macOS, ChromeOS) for on-device AI.

```bash
npm install
cp .env.example .env.local   # fill in your Firebase web config
npm run dev
```

### Firebase setup

1. Create a Firebase project and add a **Web app**. Copy the config into `.env.local`.
2. **AI Logic** → Get started → choose the **Gemini Developer API**.
3. **App Check** → register the web app with **reCAPTCHA Enterprise** and put the site key in `VITE_RECAPTCHA_SITE_KEY`. Enforce App Check for AI Logic. For local dev, leave `VITE_APPCHECK_DEBUG_TOKEN=true`, open the app, copy the debug token from the browser console, and add it under App Check → Apps → Manage debug tokens.
4. **Authentication** → enable **Anonymous**.
5. **Firestore** → create a database, then `firebase deploy --only firestore:rules`.
6. **Remote Config** → `firebase deploy --only remoteconfig` (uses `remoteconfig.template.json`).

### Enable Gemini Nano in Chrome

1. Update Chrome (`chrome://settings/help`).
2. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart.
3. Open Heimdall and tap the status chip ("Tap to enable on-device AI"). The model downloads once.

To show the cloud fallback on the same laptop: **Settings → For demo → Simulate a device without on-device AI**.

No camera handy? **Samples** on the camera view loads fictional photos (a medicine bottle, a utility letter, a French menu).

### Deploy

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # pick your project
npm run deploy                # build + hosting + rules + remote config
```

On iPhone/iPad: open the hosted URL in Safari → Share → **Add to Home Screen**.

## Android app

The Android app (`android/`) shows **the same UI as the web app**, with every feature (five modes, Live, Voice, warnings first, Calm/Vivid, Samples, My things, Settings), and does the AI natively:

- **UI**: the web build is bundled into the APK (`npm run build:android` → `android/app/src/main/assets/web`) and served by `WebViewAssetLoader` under the web app's own origin, so it works offline and Firebase domain rules match. Nothing is downloaded from a server at start-up.
- **Hybrid inference, native**: a WebView has no on-device model, so `src/lib/vision.ts` sends each model call over a JavaScript bridge (`src/lib/native.ts` ↔ `Bridge.kt`) to the **Android Firebase AI Logic SDK** (`firebase-ai` + `firebase-ai-ondevice`, `NativeAI.kt`). The same `InferenceMode` the web policy picks is passed to `OnDeviceConfig`, so on phones with Gemini Nano in AICore (ML Kit Prompt API) answers run on-device, and everywhere else they come from the cloud. `onDeviceExtension.checkStatus()/download()/warmUp()` drive the status chip, and `response.inferenceSource` drives the answer trail. The routing policy, timeouts and escalation stay in one place (`policy.ts`/`vision.ts`) for both platforms.
- **App Check**: native Play Integrity in release builds, debug provider in debug builds; the web UI gets its App Check tokens from the native SDK.
- **Speech**: Android's WebView has no Web Speech API, so speaking, the voice list, voice questions and vibration use Android's `TextToSpeech`, `SpeechRecognizer` and `Vibrator` through the bridge.
- **Camera**: `getUserMedia` in the WebView (camera permission granted natively), plus the system photo picker.

Build it yourself:

```bash
npm run build:android          # needs .env.local; bundles the web UI into the app
cd android
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

Use JDK 17 or 21 (Android Studio: Settings → Build Tools → Gradle → Gradle JDK). For a debug build, run the app once, search Logcat for `DebugAppCheckProvider`, and register that token under Firebase console → App Check → Apps → Heimdall Android → Manage debug tokens. Release builds are signed with a key in `android/keystore.properties` (gitignored).

`android/app/google-services.json` holds the public Firebase config for app `dev.heimdall.app`.

## Testing status

| Platform | Cloud AI | On-device AI |
| --- | --- | --- |
| Web, Chrome desktop (Windows) | Tested | Supported (Gemini Nano via Chrome's Prompt API) |
| Web, Android and iPhone browsers | Tested | Not available: browsers on phones don't expose Gemini Nano yet, so Firebase AI Logic uses the cloud |
| Android app (APK) | Tested on a Galaxy A53 (Android 14) | Code complete (AICore); the A53 has no Gemini Nano, so it needs a Pixel 8 / Galaxy S24 or newer to test |
| Native iOS app | Planned | Planned (Apple on-device models) |

**To do:** test on-device AI on a supported Android phone and build and test an iOS version. We didn't have access to a recent enough phone during the hackathon; the cloud path works on the phones we had.

## Tests

```bash
npm test   # routing, escalation, model fallback (shared by web and Android)
```

## Project structure

```
src/lib/vision.ts    prompts, schemas, hybrid calls, timeout, cloud double-check
src/lib/policy.ts    routing + escalation rules (pure, unit-tested)
src/lib/device.ts    Gemini Nano availability checks
src/lib/config.ts    Remote Config
src/lib/items.ts     Firestore "My things"
src/lib/speech.ts    speech synthesis / recognition, haptics (native on Android)
src/lib/native.ts    bridge to the Android app
src/lib/samples.ts   fictional sample photos drawn on canvas
src/components/      Camera, AnswerCard, Settings
android/app/src/main/java/dev/heimdall/app/
  MainActivity.kt    WebView shell: bundled web UI, camera + mic permissions, photo picker
  Bridge.kt          window.HeimdallAndroid: AI calls, App Check tokens, speech, haptics
  NativeAI.kt        Firebase AI Logic hybrid calls, Gemini Nano status/download/warm-up
  HeimdallApp.kt     Firebase + App Check (Play Integrity / debug)
```

## License

Apache 2.0. See [LICENSE](LICENSE).

Heimdall describes what a camera sees and can make mistakes. Always confirm medicine details with a pharmacist.

---

Made with love, Arun :)

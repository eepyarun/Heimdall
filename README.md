# Heimdall: eyes for everyone

Point your camera and hear what's there. Heimdall helps blind and low-vision people **describe** their surroundings, **read** text, **identify** medicine, money and products, **translate** signs and menus, and **ask** follow-up questions, all by voice, with one big button.

It runs **on your device first** with Gemini Nano, and falls back to (or double-checks with) Gemini in the cloud through **Firebase AI Logic hybrid inference**.

> Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/). Platforms: **Web** (Chrome; installable as a PWA on iOS and Android, live at https://heimdall-50c68.web.app) and **native Android** (Kotlin, `android/`).

## Why hybrid matters here

People who are blind point their camera at the most private things in their lives: prescription bottles, bank letters, mail, their own home. Today's assistants upload every photo to the cloud. On-device AI is private, free and works offline, but it is small, and **a confidently wrong answer about a medicine is dangerous**.

Heimdall treats the two models as one system with a safety policy:

| Situation | What Heimdall does |
| --- | --- |
| Gemini Nano available, clear photo | Answers **on-device**. Nothing leaves the device. |
| Nano is **unsure** (it rates its own confidence) | **Smart mode** re-asks a stronger cloud model and says "Double-checked". |
| It's a **medicine** and Nano is only "fairly sure" | Stricter bar: double-checked in the cloud (threshold in Remote Config). |
| Language Nano can't speak (e.g. Hindi, Arabic) | Routed to the cloud, and the reason is shown. |
| Nano too slow (cold start) | After 30s, Heimdall says "Switching to cloud AI" and the cloud answers instead. |
| Phone or browser without Nano (e.g. iPhone) | Same app; Firebase AI Logic falls back to the cloud automatically. |
| **Private mode** | Only on-device. If there is no on-device model, Heimdall **refuses** rather than silently using the cloud (see below). |
| Offline on a Nano laptop | Still works: app shell is cached by a service worker. |
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

## Accessibility

- **Warnings first.** Every answer has an `alerts` field: medicine warnings, allergens, expiry dates, danger signs, steps and traffic. Alerts are spoken before anything else ("Warning. May cause dizziness."), with an alarm tone, a long vibration and a red box.
- One huge **Look** button, **Voice** to ask a question about what the camera sees, and **Live** to hear only what changes as you move.
- Answers are spoken in sentence-sized chunks with the most natural voice on the device (choosable in Settings) and announced through an ARIA live region. Any tap interrupts speech; "One moment, analyzing" covers the wait.
- Prompts are written for blind users: clock directions, distances in steps, never guess, and a camera **tip** ("Move closer", "Add more light") when the photo is poor.
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

To show the cloud fallback on the same laptop: **Settings → For judges and testers → Simulate a device without on-device AI**.

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

`android/` is a native Kotlin + Jetpack Compose app with the same five modes, prompts, JSON schemas and routing policy (`Policy.kt` mirrors `src/lib/policy.ts`).

- **Hybrid inference**: `firebase-ai` + `firebase-ai-ondevice`, `OnDeviceConfig(mode = InferenceMode.PREFER_ON_DEVICE)`. Gemini Nano runs through Android AICore (ML Kit Prompt API) on supported phones (for example Pixel 10 and Galaxy S25 series); `onDeviceExtension.checkStatus()/download()/warmUp()` manage the model, and `response.inferenceSource` drives the answer trail.
- **Camera**: CameraX, plus a photo picker for emulator demos.
- **App Check**: debug provider in debug builds, Play Integrity in release. **Remote Config**: same keys as the web.
- The Android emulator has no AICore, so it demonstrates the cloud path; Private mode correctly refuses there.

Run it:

1. Install [Android Studio](https://developer.android.com/studio) and open the `android/` folder. Let it sync Gradle.
2. Create an emulator (Device Manager → Pixel, latest API). In its advanced settings set **Back camera → Webcam0** to use your laptop camera.
3. Run the app, open **Logcat**, search `DebugAppCheckProvider`, and register that token in Firebase console → App Check → Apps → Heimdall Android → Manage debug tokens.

`android/app/google-services.json` holds the public Firebase config for app `dev.heimdall.app`.

## Tests

```bash
npm test                                  # web: routing, escalation, model fallback
cd android && ./gradlew testDebugUnitTest # Android: same policy rules
```

## Project structure

```
src/lib/vision.ts    prompts, schemas, hybrid calls, timeout, cloud double-check
src/lib/policy.ts    routing + escalation rules (pure, unit-tested)
src/lib/device.ts    Gemini Nano availability checks
src/lib/config.ts    Remote Config
src/lib/items.ts     Firestore "My things"
src/lib/speech.ts    speech synthesis / recognition, haptics
src/lib/samples.ts   fictional sample photos drawn on canvas
src/components/      Camera, AnswerCard, Settings
android/app/src/main/java/dev/heimdall/app/
  Policy.kt          same routing rules as policy.ts (unit-tested)
  Vision.kt          prompts, schemas, hybrid calls, Nano status/download
  Config.kt          Remote Config
  MainActivity.kt    CameraX + Compose screen, text-to-speech
```

## License

Apache 2.0. See [LICENSE](LICENSE).

Heimdall describes what a camera sees and can make mistakes. Always confirm medicine details with a pharmacist.

import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "dev.heimdall.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.heimdall.app"
        // firebase-ai-ondevice (ML Kit Prompt API) requires API 26+.
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.1.0"
    }

    // Release signing reads android/keystore.properties (gitignored; keep the keystore itself out of the repo).
    val signingProps = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { f ->
        Properties().apply { f.inputStream().use { load(it) } }
    }
    signingConfigs {
        if (signingProps != null) {
            create("release") {
                storeFile = file(signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (signingProps != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    // Target Java 17 bytecode but build with any installed JDK 17+ (e.g. Android Studio's JDK 21).
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// The app's UI is the web build. Run `npm run build:android` in the repo root first.
val webIndex = file("src/main/assets/web/index.html")
tasks.named("preBuild") {
    doFirst {
        check(webIndex.exists()) { "Missing the bundled web UI: run `npm run build:android` in the repo root first." }
    }
}

dependencies {
    // Firebase AI Logic hybrid inference. The on-device SDK is not in the BoM yet.
    implementation("com.google.firebase:firebase-ai:18.2.0")
    implementation("com.google.firebase:firebase-ai-ondevice:16.0.0-beta08")
    implementation(platform("com.google.firebase:firebase-bom:34.10.0"))
    implementation("com.google.firebase:firebase-appcheck-playintegrity")
    implementation("com.google.firebase:firebase-appcheck-debug:20.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")

    // The UI is the web app (built into src/main/assets/web by `npm run build:android`), shown in a WebView.
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")

    testImplementation("junit:junit:4.13.2")
}

package dev.heimdall.app

import android.app.Application
import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.initialize

class HeimdallApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Firebase.initialize(this)
        // Debug builds print a debug token to Logcat; register it in Firebase console > App Check > Manage debug tokens.
        Firebase.appCheck.installAppCheckProviderFactory(
            if (BuildConfig.DEBUG) DebugAppCheckProviderFactory.getInstance()
            else PlayIntegrityAppCheckProviderFactory.getInstance(),
        )
    }
}

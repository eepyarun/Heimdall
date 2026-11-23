package dev.heimdall.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PolicyTest {
    private val langs = listOf("en", "es", "ja")

    @Test(expected = PrivateModeUnavailable::class)
    fun privateModeRefusesWithoutOnDeviceModel() {
        chooseRoute(Privacy.PRIVATE, "en", deviceReady = false, onDeviceLanguages = langs, languageName = "English")
    }

    @Test
    fun privateModeStaysOnDevice() {
        assertEquals(RouteMode.ONLY_ON_DEVICE, chooseRoute(Privacy.PRIVATE, "en", true, langs, "English").mode)
    }

    @Test
    fun smartModeRoutesUnsupportedLanguagesToCloud() {
        assertEquals(RouteMode.PREFER_ON_DEVICE, chooseRoute(Privacy.SMART, "en", true, langs, "English").mode)
        assertEquals(RouteMode.PREFER_IN_CLOUD, chooseRoute(Privacy.SMART, "hi", true, langs, "Hindi").mode)
    }

    @Test
    fun medicineEscalatesAtStricterThreshold() {
        assertTrue(shouldEscalate(Privacy.SMART, true, Confidence.MEDIUM, "medicine", Confidence.LOW, Confidence.MEDIUM))
        assertFalse(shouldEscalate(Privacy.SMART, true, Confidence.MEDIUM, "food", Confidence.LOW, Confidence.MEDIUM))
        assertFalse(shouldEscalate(Privacy.PRIVATE, true, Confidence.LOW, "medicine", Confidence.LOW, Confidence.MEDIUM))
        assertFalse(shouldEscalate(Privacy.SMART, false, Confidence.LOW, null, Confidence.LOW, Confidence.MEDIUM))
    }

    @Test
    fun busyErrorsAreRetriedButAuthErrorsAreNot() {
        assertTrue(isBusyError(Exception("[500] This model is currently experiencing high demand.")))
        assertTrue(isBusyError(Exception("GenerateRequestsPerDayPerProjectPerModel-FreeTier quota")))
        assertFalse(isBusyError(Exception("[401] Firebase App Check token is invalid.")))
    }

    @Test
    fun modelChainRetriesPrimaryThenEachBackupOnce() {
        assertEquals(listOf("lite", "lite", "flash", "old"), modelChain("lite", listOf("flash", "old", "lite", "")))
    }
}

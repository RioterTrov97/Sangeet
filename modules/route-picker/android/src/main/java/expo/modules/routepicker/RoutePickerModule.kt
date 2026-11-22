package expo.modules.routepicker

import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android's counterpart of the AirPlay picker: opens the system sound output switcher (the volume panel carries "Media output"
 * on Android 10+; Android 11+ shows speakers, headphones, Bluetooth and Cast devices there).
 */
class RoutePickerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RoutePicker")

    Function("isAvailable") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q }

    Function("showPicker") {
      try {
        val i = Intent(Settings.Panel.ACTION_VOLUME)
        val activity = appContext.currentActivity
        if (activity != null) activity.startActivity(i) else appContext.reactContext?.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (_: Exception) {}
      null
    }
  }
}

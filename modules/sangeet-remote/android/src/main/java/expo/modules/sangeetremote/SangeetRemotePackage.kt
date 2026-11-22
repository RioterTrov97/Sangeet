package expo.modules.sangeetremote

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Lets the main activity turn the screen on when the service brings it to the front (phone plays while the TV is in standby). */
class SangeetRemotePackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> = listOf(
    object : ReactActivityLifecycleListener {
      override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
        if (activity != null && Build.VERSION.SDK_INT >= 27) {
          activity.setTurnScreenOn(true)
          activity.setShowWhenLocked(true)
        }
      }
    },
  )
}

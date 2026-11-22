package expo.modules.tvkeys

import android.content.Context
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

class TvKeysPackage : Package {
  override fun createReactActivityHandlers(activityContext: Context?): List<ReactActivityHandler> = listOf(
    object : ReactActivityHandler {
      override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean = TvKeys.handle(keyCode, event)
      override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean = TvKeys.name(keyCode)?.let { !TvKeys.isDpad(it) || TvKeys.captured.contains(it) } ?: false
    },
  )
}

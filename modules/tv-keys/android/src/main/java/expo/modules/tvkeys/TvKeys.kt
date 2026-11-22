package expo.modules.tvkeys

import android.view.KeyEvent

object TvKeys {
  @Volatile var sink: ((String, Int) -> Unit)? = null
  /** Sees every D-pad key the app does not capture (they go on to Android's focus search, unconsumed). */
  @Volatile var navSink: ((String) -> Unit)? = null
  @Volatile var captured: Set<String> = emptySet()

  fun name(code: Int): String? = when (code) {
    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "play_pause"
    KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
    KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
    KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
    KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "previous"
    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "fast_forward"
    KeyEvent.KEYCODE_MEDIA_REWIND -> "rewind"
    KeyEvent.KEYCODE_DPAD_LEFT -> "left"
    KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
    KeyEvent.KEYCODE_DPAD_UP -> "up"
    KeyEvent.KEYCODE_DPAD_DOWN -> "down"
    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> "center"
    else -> null
  }

  fun isDpad(n: String) = n == "left" || n == "right" || n == "up" || n == "down" || n == "center"

  /** True when the key was consumed (JS got it). */
  fun handle(code: Int, event: KeyEvent?): Boolean {
    val n = name(code) ?: return false
    if (isDpad(n) && !captured.contains(n)) {
      navSink?.invoke(n)
      return false
    }
    val s = sink ?: return false
    s(n, event?.repeatCount ?: 0)
    return true
  }
}

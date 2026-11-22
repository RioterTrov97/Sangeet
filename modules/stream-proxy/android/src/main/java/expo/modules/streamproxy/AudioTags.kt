package expo.modules.streamproxy

import android.media.MediaMetadataRetriever
import java.io.File

/**
 * Tags and embedded cover of a local audio file (songs picked on the phone). Same result shape as the iOS AudioTags.swift. Never throws:
 * an unreadable file comes back with empty fields and the JS side falls back to the file name.
 */
object AudioTags {
  fun read(path: String, artworkOut: String): Map<String, Any> {
    val out = HashMap<String, Any>()
    out["hasArtwork"] = false
    val r = MediaMetadataRetriever()
    try {
      r.setDataSource(path)
      fun text(key: Int) = r.extractMetadata(key)?.trim()?.takeIf { it.isNotEmpty() }
      text(MediaMetadataRetriever.METADATA_KEY_TITLE)?.let { out["title"] = it }
      (text(MediaMetadataRetriever.METADATA_KEY_ARTIST) ?: text(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST))?.let { out["artist"] = it }
      text(MediaMetadataRetriever.METADATA_KEY_ALBUM)?.let { out["album"] = it }
      text(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.let { if (it > 0) out["durationSec"] = it / 1000.0 }
      val art = r.embeddedPicture
      if (art != null && art.isNotEmpty() && artworkOut.isNotEmpty()) {
        val f = File(artworkOut)
        f.parentFile?.mkdirs()
        f.writeBytes(art)
        out["hasArtwork"] = true
      }
    } catch (_: Exception) {
    } finally {
      try { r.release() } catch (_: Exception) {}
    }
    return out
  }
}

package expo.modules.streamproxy

import java.io.File

/**
 * On-disk cache of whole songs (audio only): `<id>.m4a` / `<id>.webm` when complete, `<id>.<ext>.part` while downloading.
 * Least recently used files (by last-modified, touched whenever a song is served) are deleted when the total passes [capBytes].
 * Unfinished parts from an earlier run are removed at start.
 */
class SongCache(private val dir: File, @Volatile var capBytes: Long) {
  init {
    dir.mkdirs()
    dir.listFiles()?.filter { it.name.endsWith(".part") }?.forEach { it.delete() }
  }

  private fun ext(mime: String) = if (mime.contains("webm")) "webm" else "m4a"
  private fun safe(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "_")

  fun part(id: String, mime: String) = File(dir, "${safe(id)}.${ext(mime)}.part")

  /** The finished file for [id], or null. */
  fun complete(id: String): File? {
    val n = safe(id)
    return listOf("m4a", "webm").map { File(dir, "$n.$it") }.firstOrNull { it.isFile && it.length() > 0 }
  }

  /** Atomically publishes a finished part file. */
  fun finish(id: String, mime: String): Boolean {
    val p = part(id, mime)
    val d = File(dir, "${safe(id)}.${ext(mime)}")
    return p.renameTo(d).also { if (it) d.setLastModified(System.currentTimeMillis()) }
  }

  /** (id, bytes, last used epoch ms) of every finished song. */
  fun list(): List<Triple<String, Long, Long>> =
    dir.listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }?.map { Triple(it.name.substringBeforeLast('.'), it.length(), it.lastModified()) } ?: emptyList()

  fun delete(id: String) {
    val n = safe(id)
    listOf("m4a", "webm").forEach { File(dir, "$n.$it").delete() }
  }

  fun clear() {
    dir.listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }?.forEach { it.delete() }
  }

  /**
   * Safety net only: the JS side ranks songs by value and deletes them as soon as one finishes. This plain LRU runs when the cache
   * is 25 % over its budget anyway (JS not running). [protect] ids are kept.
   */
  fun trim(protect: Set<String>) {
    val files = dir.listFiles()?.filter { it.isFile && !it.name.endsWith(".part") } ?: return
    var total = files.sumOf { it.length() }
    val keep = protect.map { safe(it) }.toSet()
    for (f in files.sortedBy { it.lastModified() }) {
      if (capBytes <= 0 || total <= capBytes + capBytes / 4) break
      if (f.name.substringBeforeLast('.') in keep) continue
      total -= f.length()
      f.delete()
    }
  }

  fun totalBytes(): Long = dir.listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }?.sumOf { it.length() } ?: 0L
}

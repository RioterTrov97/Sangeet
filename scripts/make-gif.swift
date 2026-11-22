#!/usr/bin/env swift
// Builds an animated GIF from image frames with ImageIO (no ffmpeg/gifski needed).
//   swift scripts/make-gif.swift <out.gif> <fps> <width> <frame1.png> <frame2.png> ...
// Frames are downscaled to <width> px wide first; the GIF loops forever.
// If the single input is a .mov/.mp4 (e.g. from `xcrun simctl io <udid> recordVideo`), frames are sampled from it at <fps>:
//   swift scripts/make-gif.swift out.gif 10 360 clip.mov [startSeconds [durationSeconds]]
import Foundation
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count >= 4, let fps = Double(a[2]), let width = Int(a[3]), fps > 0 else {
  FileHandle.standardError.write("usage: make-gif.swift out.gif fps width frames...\n".data(using: .utf8)!)
  exit(2)
}
var frames = Array(a[4...])
var cleanup: URL?
if let v = frames.first, v.hasSuffix(".mov") || v.hasSuffix(".mp4") {
  let asset = AVURLAsset(url: URL(fileURLWithPath: v))
  let total = CMTimeGetSeconds(asset.duration) // deprecated accessor, fine for a dev tool
  let start = frames.count > 1 ? Double(frames[1]) ?? 0 : 0
  let dur = min(frames.count > 2 ? Double(frames[2]) ?? total : total, total - start)
  let gen = AVAssetImageGenerator(asset: asset)
  gen.appliesPreferredTrackTransform = true
  gen.requestedTimeToleranceBefore = .zero; gen.requestedTimeToleranceAfter = .zero
  gen.maximumSize = CGSize(width: width * 2, height: width * 8) // keep the aspect ratio; the width is finalised below
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent("gifframes-\(getpid())")
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  cleanup = dir; frames = []
  var i = 0
  while Double(i) / fps < dur {
    let t = CMTime(seconds: start + Double(i) / fps, preferredTimescale: 600)
    if let cg = try? gen.copyCGImage(at: t, actualTime: nil) {
      let u = dir.appendingPathComponent(String(format: "f%04d.png", i))
      if let d = CGImageDestinationCreateWithURL(u as CFURL, UTType.png.identifier as CFString, 1, nil) {
        CGImageDestinationAddImage(d, cg, nil); CGImageDestinationFinalize(d); frames.append(u.path)
      }
    }
    i += 1
  }
}
defer { if let c = cleanup { try? FileManager.default.removeItem(at: c) } }
guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, UTType.gif.identifier as CFString, frames.count, nil) else { exit(1) }
CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
let frameProps = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1.0 / fps]] as CFDictionary
for f in frames {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: f) as CFURL, nil),
        let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
        let pw = props[kCGImagePropertyPixelWidth] as? Int, let ph = props[kCGImagePropertyPixelHeight] as? Int,
        let img = CGImageSourceCreateThumbnailAtIndex(src, 0, [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: max(pw, ph) * width / pw, // longest side, so the width ends up as <width>
        ] as CFDictionary) else { FileHandle.standardError.write("skip \(f)\n".data(using: .utf8)!); continue }
  CGImageDestinationAddImage(dest, img, frameProps)
}
guard CGImageDestinationFinalize(dest) else { exit(1) }

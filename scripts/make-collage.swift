#!/usr/bin/env swift
// Composites screenshots into one image with CoreGraphics/ImageIO (nothing to install).
//
// Grid mode: images laid out in rows, each cell scaled to the same width, rows centred.
//   swift scripts/make-collage.swift --out docs/media/iphone-gallery.jpg --cols 4 --width 1600 \
//     --gap 24 --pad 32 --radius 36 --bg "#0d0f14" --frame a.png b.png c.png ...
//
// Canvas mode: free placement on a fixed canvas; each item is file@x,y,width (pixels, top-left origin).
// Items draw in the order given, so later ones overlap earlier ones.
//   swift scripts/make-collage.swift --out docs/media/banner.jpg --canvas 1800x900 --radius 28 --frame --shadow \
//     --bg "#0d0f14" tv.jpg@40,150,1100 phone.png@1200,60,300
//
// Options:
//   --out <file>      .png or .jpg (jpg is flattened onto the background; default quality 0.85, see --quality)
//   --cols <n>        grid columns (grid mode)
//   --width <px>      output width (grid mode)
//   --canvas <WxH>    canvas size (canvas mode)
//   --gap <px>        gap between cells (grid mode, default 16)
//   --pad <px>        outer padding (grid mode, default 0)
//   --radius <px>     corner radius at output scale (default 0; use ~8% of the cell width for phones)
//   --bg <color>      "transparent" (PNG only; default) or "#rrggbb"
//   --frame           thin device-style bezel outline around each image
//   --shadow          soft drop shadow under each image
//   --quality <0-1>   JPEG quality (default 0.85)
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

func die(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(2) }

var out = "", cols = 0, width = 0, gap = 16.0, pad = 0.0, radius = 0.0, quality = 0.85
var bg = "transparent", frame = false, shadow = false, canvas: (Int, Int)?
var inputs: [String] = []
var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
  let k = args.removeFirst()
  func val() -> String { if args.isEmpty { die("missing value for \(k)") }; return args.removeFirst() }
  switch k {
  case "--out": out = val()
  case "--cols": cols = Int(val()) ?? 0
  case "--width": width = Int(val()) ?? 0
  case "--gap": gap = Double(val()) ?? 16
  case "--pad": pad = Double(val()) ?? 0
  case "--radius": radius = Double(val()) ?? 0
  case "--quality": quality = Double(val()) ?? 0.85
  case "--bg": bg = val()
  case "--frame": frame = true
  case "--shadow": shadow = true
  case "--canvas":
    let p = val().split(separator: "x").compactMap { Int($0) }
    guard p.count == 2 else { die("--canvas WxH") }
    canvas = (p[0], p[1])
  default: inputs.append(k)
  }
}
guard !out.isEmpty, !inputs.isEmpty else { die("usage: make-collage.swift --out f (--cols N --width W | --canvas WxH) [options] images...") }

func load(_ path: String) -> CGImage {
  guard let s = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let i = CGImageSourceCreateImageAtIndex(s, 0, nil) else { die("cannot read \(path)") }
  return i
}

struct Item { let img: CGImage; var rect: CGRect } // rect in top-left-origin pixels

var items: [Item] = []
var W = 0, H = 0
if let c = canvas {
  W = c.0; H = c.1
  for spec in inputs {
    let parts = spec.components(separatedBy: "@")
    guard parts.count == 2 else { die("canvas item must be file@x,y,width: \(spec)") }
    let n = parts[1].split(separator: ",").compactMap { Double($0) }
    guard n.count == 3 else { die("bad placement: \(spec)") }
    let img = load(parts[0])
    let h = n[2] * Double(img.height) / Double(img.width)
    items.append(Item(img: img, rect: CGRect(x: n[0], y: n[1], width: n[2], height: h)))
  }
} else {
  guard cols > 0, width > 0 else { die("grid mode needs --cols and --width") }
  W = width
  let cw = (Double(width) - 2 * pad - Double(cols - 1) * gap) / Double(cols)
  let imgs = inputs.map(load)
  let heights = imgs.map { cw * Double($0.height) / Double($0.width) }
  var y = pad
  var idx = 0
  while idx < imgs.count {
    let rowEnd = min(idx + cols, imgs.count)
    let rowH = heights[idx..<rowEnd].max()!
    let rowW = Double(rowEnd - idx) * cw + Double(rowEnd - idx - 1) * gap
    var x = (Double(width) - rowW) / 2 // centre a short last row
    for j in idx..<rowEnd {
      items.append(Item(img: imgs[j], rect: CGRect(x: x, y: y + (rowH - heights[j]) / 2, width: cw, height: heights[j])))
      x += cw + gap
    }
    y += rowH + gap
    idx = rowEnd
  }
  H = Int((y - gap + pad).rounded(.up))
}

let space = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { die("context") }
ctx.interpolationQuality = .high
ctx.translateBy(x: 0, y: CGFloat(H)); ctx.scaleBy(x: 1, y: -1) // top-left origin

func color(_ hex: String, _ a: CGFloat = 1) -> CGColor {
  let h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
  let v = UInt32(h, radix: 16) ?? 0
  return CGColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: a)
}
let isJPEG = out.lowercased().hasSuffix(".jpg") || out.lowercased().hasSuffix(".jpeg")
if bg != "transparent" || isJPEG {
  ctx.setFillColor(bg == "transparent" ? color("#000000") : color(bg))
  ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
}

for it in items {
  let r = it.rect
  let path = CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil)
  if shadow {
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -r.width * 0.03), blur: r.width * 0.08, color: color("#000000", 0.55))
    ctx.setFillColor(color("#000000")); ctx.addPath(path); ctx.fillPath()
    ctx.restoreGState()
  }
  ctx.saveGState()
  ctx.addPath(path); ctx.clip()
  // flip back so the image is not upside down inside the flipped context
  ctx.translateBy(x: r.minX, y: r.maxY); ctx.scaleBy(x: 1, y: -1)
  ctx.draw(it.img, in: CGRect(x: 0, y: 0, width: r.width, height: r.height))
  ctx.restoreGState()
  if frame {
    ctx.saveGState()
    ctx.setStrokeColor(color("#4a4d57")); ctx.setLineWidth(max(2, r.width * 0.006))
    ctx.addPath(path); ctx.strokePath()
    ctx.restoreGState()
  }
}

guard let result = ctx.makeImage() else { die("render") }
let type = isJPEG ? UTType.jpeg : UTType.png
guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, type.identifier as CFString, 1, nil) else { die("cannot write \(out)") }
CGImageDestinationAddImage(dest, result, isJPEG ? [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary : nil)
guard CGImageDestinationFinalize(dest) else { die("finalize") }
print("\(out): \(W)x\(H)")

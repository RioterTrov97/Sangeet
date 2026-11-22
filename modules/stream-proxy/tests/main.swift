// Standalone check of RangePlan and HlsPlaylist (no test target exists for native modules):
//   swiftc ios/RangePlan.swift ios/HlsPlaylist.swift tests/main.swift -o /tmp/range_plan_check && /tmp/range_plan_check
// Mirror the cases in android/.../RangePlan.kt if you change either.
import Foundation

var failed = 0
func check(_ ok: Bool, _ what: String) { if !ok { failed += 1; print("FAIL: \(what)") } }

check(!RangePlan.useQueryForm(from: 0, flagged: true), "from 0 always header")
check(!RangePlan.useQueryForm(from: 100, flagged: false), "unflagged header")
check(RangePlan.useQueryForm(from: 100, flagged: true), "flagged later range uses query")
check(RangePlan.chunkCap(flagged: true, normal: 8 << 20) == 1 << 20, "flagged cap 1 MiB")
check(RangePlan.chunkCap(flagged: true, normal: 256 << 10) == 256 << 10, "flagged cap never raises")
check(RangePlan.chunkCap(flagged: false, normal: 8 << 20) == 8 << 20, "unflagged cap unchanged")
check(RangePlan.boundedTo(from: 10, to: 999, length: 500) == 499, "clamped to length")
check(RangePlan.boundedTo(from: 10, to: 99, length: 500) == 99, "inside length unchanged")
check(RangePlan.boundedTo(from: 10, to: 99, length: 0) == 99, "unknown length unchanged")
let u = URL(string: "https://rr1.googlevideo.com/videoplayback?id=a&range=0-5&rn=9")!
check(RangePlan.withQueryRange(u, from: 100, to: 199).absoluteString.contains("range=100-199"), "query range set")
check(RangePlan.withQueryRange(u, from: 100, to: 199).absoluteString.components(separatedBy: "range=").count == 2, "old range replaced")
let r = RangePlan.withRn(u, 3).absoluteString
check(r.contains("rn=3") && !r.contains("rn=9"), "rn replaced")
check(RangePlan.withRn(URL(string: "https://x.test/a?b=1")!, 3).absoluteString == "https://x.test/a?b=1", "rn only on videoplayback")

// HlsPlaylist.fromFile: ftyp(24) + moov(100) + v0 sidx with 2 refs, then filler.
func be32(_ v: Int) -> [UInt8] { [UInt8(v >> 24 & 255), UInt8(v >> 16 & 255), UInt8(v >> 8 & 255), UInt8(v & 255)] }
func box(_ type: String, _ body: [UInt8]) -> [UInt8] { be32(8 + body.count) + Array(type.utf8) + body }
let ftyp = box("ftyp", [UInt8](repeating: 1, count: 16))
let moov = box("moov", [UInt8](repeating: 2, count: 92))
// version/flags, ref id, timescale 1000, earliest pts, first offset 0, reserved, count 2, then 2 x (size, duration, SAP)
var sidxBody: [UInt8] = [0, 0, 0, 0] + be32(1) + be32(1000) + be32(0) + be32(0) + [0, 0, 0, 2]
sidxBody += be32(5000) + be32(4000) + be32(0) + be32(3000) + be32(2500) + be32(0)
let sidx = box("sidx", sidxBody)
let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("hls_check.m4a")
try! Data(ftyp + moov + sidx + [UInt8](repeating: 0, count: 64)).write(to: tmp)
let pl = HlsPlaylist.fromFile(tmp, uri: "abc") ?? ""
let initLen = ftyp.count + moov.count
let sidxEnd = initLen + sidx.count // first segment starts right after the sidx
check(pl.contains("#EXT-X-MAP:URI=\"abc\",BYTERANGE=\"\(initLen)@0\""), "map byterange is ftyp+moov @0")
check(pl.contains("#EXT-X-BYTERANGE:5000@\(sidxEnd)\n"), "segment 1 byterange")
check(pl.contains("#EXT-X-BYTERANGE:3000@\(sidxEnd + 5000)\n"), "segment 2 byterange")
check(pl.components(separatedBy: "#EXT-X-BYTERANGE").count == 3, "two segments")
let webm = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("hls_check.webm")
try! Data(ftyp + moov + sidx).write(to: webm)
check(HlsPlaylist.fromFile(webm, uri: "abc") == nil, "webm has no playlist")
try! Data(ftyp + moov).write(to: tmp)
check(HlsPlaylist.fromFile(tmp, uri: "abc") == nil, "no sidx -> nil")
print(failed == 0 ? "ok" : "\(failed) failed")
exit(failed == 0 ? 0 : 1)

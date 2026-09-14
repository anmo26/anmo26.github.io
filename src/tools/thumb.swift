// Ask QuickLook for the thumbnail Finder itself draws for a file, and write it
// out as a PNG. This is the same machinery Finder uses, so a photo comes back
// as a small picture of itself and a document comes back as a page with its
// first lines showing -- not a generic badge for the file type.
//
// Prints "<width> <height>" of the written PNG so the caller can size the img
// without loading it back.
import AppKit
import QuickLookThumbnailing

let args = CommandLine.arguments
guard args.count >= 4, let px = Int(args[3]) else {
    FileHandle.standardError.write("usage: thumb <src-path> <out.png> <pixels>\n".data(using: .utf8)!)
    exit(2)
}
let src = args[1], out = args[2]
let url = URL(fileURLWithPath: src)

// QuickLook thinks in points. Asking for half the pixels at 2x gets the
// representation a retina screen wants while keeping the longest edge at `px`.
let scale: CGFloat = 2
let points = CGFloat(px) / scale

var thumbnail: CGImage?
let done = DispatchSemaphore(value: 0)
let request = QLThumbnailGenerator.Request(
    fileAt: url, size: NSSize(width: points, height: points),
    scale: scale, representationTypes: .all)

QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { rep, _ in
    thumbnail = rep?.cgImage
    done.signal()
}
// A wedged QuickLook plugin must not hang a rebuild -- the site watcher runs
// this on every save. Give up and fall through to the plain system icon.
_ = done.wait(timeout: .now() + 10)

let rep: NSBitmapImageRep

if let image = thumbnail {
    rep = NSBitmapImageRep(cgImage: image)
} else {
    // No thumbnail provider for this type. NSWorkspace still knows which icon
    // Finder draws, which is better than nothing and matches the folder path.
    let icon = NSWorkspace.shared.icon(forFile: src)
    let size = NSSize(width: px, height: px)
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
    bitmap.size = size

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current?.imageInterpolation = .high
    icon.draw(in: NSRect(origin: .zero, size: size),
              from: .zero, operation: .sourceOver, fraction: 1.0)
    NSGraphicsContext.restoreGraphicsState()
    rep = bitmap
}

// These PNGs are committed to a public repo, so squeeze what AppKit will give
// us: no interlacing, and let it pick the smallest filter per row.
guard let data = rep.representation(using: .png, properties: [.interlaced: false]) else { exit(1) }
do { try data.write(to: URL(fileURLWithPath: out)) } catch { exit(1) }

print("\(rep.pixelsWide) \(rep.pixelsHigh)")

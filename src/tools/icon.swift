// Ask the system for the icon it actually draws for a path, and write it out
// as a PNG. This is the same call Finder makes, so a custom icon or a tag
// colour comes through exactly as it looks on the desk.
import AppKit

let args = CommandLine.arguments
guard args.count >= 4, let px = Int(args[3]) else {
    FileHandle.standardError.write("usage: icon <src-path> <out.png> <pixels>\n".data(using: .utf8)!)
    exit(2)
}
let src = args[1], out = args[2]

let icon = NSWorkspace.shared.icon(forFile: src)
let size = NSSize(width: px, height: px)

// icon(forFile:) hands back a multi-representation image. Drawing it into a
// bitmap of the size we want lets AppKit pick the right representation and
// scale it, rather than us grabbing whichever rep happens to be first.
guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
rep.size = size

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
icon.draw(in: NSRect(origin: .zero, size: size),
          from: .zero, operation: .sourceOver, fraction: 1.0)
NSGraphicsContext.restoreGraphicsState()

guard let data = rep.representation(using: .png, properties: [:]) else { exit(1) }
do { try data.write(to: URL(fileURLWithPath: out)) } catch { exit(1) }

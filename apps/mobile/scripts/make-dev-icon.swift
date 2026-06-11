// Generates the dev-variant app icon by stamping a DEV banner on the
// production icon. Re-run when assets/images/icon.png changes:
//   swift scripts/make-dev-icon.swift assets/images/icon.png assets/images/icon-dev.png
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else {
  fputs("usage: make-dev-icon.swift <input.png> <output.png>\n", stderr)
  exit(1)
}
guard let source = NSImage(contentsOfFile: args[1]) else {
  fputs("cannot read \(args[1])\n", stderr)
  exit(1)
}

let size = 1024
guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
) else {
  fputs("cannot create bitmap\n", stderr)
  exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

source.draw(in: NSRect(x: 0, y: 0, width: size, height: size))

let bannerHeight: CGFloat = 264
let banner = NSRect(x: 0, y: 0, width: CGFloat(size), height: bannerHeight)
NSColor(calibratedRed: 0.91, green: 0.36, blue: 0.05, alpha: 1.0).setFill()
banner.fill()

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let label = NSAttributedString(string: "DEV", attributes: [
  .font: NSFont.systemFont(ofSize: 172, weight: .heavy),
  .foregroundColor: NSColor.white,
  .kern: 26,
  .paragraphStyle: paragraph,
])
let labelHeight = label.size().height
label.draw(in: NSRect(x: 0, y: (bannerHeight - labelHeight) / 2, width: CGFloat(size), height: labelHeight))

NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
  fputs("cannot encode png\n", stderr)
  exit(1)
}
try! png.write(to: URL(fileURLWithPath: args[2]))

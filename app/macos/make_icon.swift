// Draws Daybook's app icon (the spine-and-pages D from web/icon.svg on a macOS-style rounded square) as a 1024px PNG.
// Run by build.sh: swift make_icon.swift <out.png>
import AppKit

let S: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(S), pixelsHigh: Int(S), bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

let inset: CGFloat = 100, radius: CGFloat = 185
let body = NSRect(x: inset, y: inset, width: S - 2 * inset, height: S - 2 * inset)
let shape = NSBezierPath(roundedRect: body, xRadius: radius, yRadius: radius)
let brand = NSColor(red: 0x11 / 255.0, green: 0x7a / 255.0, blue: 0x58 / 255.0, alpha: 1)   // --brand (light)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 30, color: NSColor.black.withAlphaComponent(0.3).cgColor)
brand.setFill(); shape.fill()
ctx.restoreGState()

// The mark from web/icon.svg (a book seen from the spine: the spine, then its pages, which together
// make a D), drawn in that file's 64-unit box, which maps onto `body`.
let k = body.width / 64
func pt(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: inset + x * k, y: S - inset - y * k) }
let spine = NSBezierPath(roundedRect: NSRect(origin: pt(15, 51), size: NSSize(width: 7.5 * k, height: 38 * k)), xRadius: 3 * k, yRadius: 3 * k)
let pages = NSBezierPath()
pages.move(to: pt(25, 13))
pages.line(to: pt(30, 13))
pages.curve(to: pt(49, 32), controlPoint1: pt(42.2, 13), controlPoint2: pt(49, 20.6))
pages.curve(to: pt(30, 51), controlPoint1: pt(49, 43.4), controlPoint2: pt(42.2, 51))
pages.line(to: pt(25, 51))
pages.close()
NSColor.white.setFill()
spine.fill()
pages.fill()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))

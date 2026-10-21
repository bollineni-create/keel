// Draws Daybook's app icon (the D mark from web/icon.svg on a macOS-style rounded square) as a 1024px PNG.
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

// The mark from web/icon.svg (a D whose two cut-out lines are a daybook's first entries), drawn in that
// file's 64-unit box, which maps onto `body`.
let k = body.width / 64
func pt(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: inset + x * k, y: S - inset - y * k) }
let mark = NSBezierPath()
mark.windingRule = .evenOdd
mark.move(to: pt(19, 14))
mark.line(to: pt(31, 14))
mark.appendArc(withCenter: pt(31, 32), radius: 18 * k, startAngle: 90, endAngle: -90, clockwise: true)   // the D's bowl
mark.line(to: pt(19, 50))
mark.appendArc(withCenter: pt(19, 47), radius: 3 * k, startAngle: -90, endAngle: 180, clockwise: true)
mark.line(to: pt(16, 17))
mark.appendArc(withCenter: pt(19, 17), radius: 3 * k, startAngle: 180, endAngle: 90, clockwise: true)
mark.close()
for (x, y, w) in [(23.0, 25.0, 17.0), (23.0, 34.0, 11.0)] {                                                 // the two entries
    let r = NSRect(origin: pt(CGFloat(x), CGFloat(y + 5)), size: NSSize(width: CGFloat(w) * k, height: 5 * k))
    mark.append(NSBezierPath(roundedRect: r, xRadius: 2.5 * k, yRadius: 2.5 * k))
}
NSColor.white.setFill()
mark.fill()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))

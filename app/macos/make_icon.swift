// Draws Keel's app icon (the mark from web/icon.svg on a macOS-style rounded square) as a 1024px PNG.
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

// The mark is drawn in web/icon.svg's 24-unit space, where the square spans 2…22; map that onto `body`.
let unit = body.width / 20
func pt(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: inset + (x - 2) * unit, y: S - inset - (y - 2) * unit) }
let mark = NSBezierPath()
mark.move(to: pt(7, 17)); mark.line(to: pt(7, 7))                                  // mast
mark.move(to: pt(7, 17))
mark.appendArc(withCenter: pt(14, 17), radius: 7 * unit, startAngle: 180, endAngle: 90, clockwise: true)   // sail
mark.move(to: pt(7, 17)); mark.line(to: pt(17, 17))                                // keel
mark.lineWidth = 2 * unit
mark.lineCapStyle = .round
mark.lineJoinStyle = .round
NSColor.white.setStroke()
mark.stroke()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))

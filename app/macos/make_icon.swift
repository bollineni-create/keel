// Draws Daybook's app icon (the open-book mark from web/icon.svg on a macOS-style rounded square) as a 1024px PNG.
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

// The mark (an open daybook with two entries on its right page) from web/icon.svg, where the square spans
// 8…56 of a 64-unit box. Here it's in a 24-unit space whose square spans 2…22, mapped onto `body`.
let unit = body.width / 20
func pt(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: inset + (x - 2) * unit, y: S - inset - (y - 2) * unit) }
let book = NSBezierPath()
book.move(to: pt(12.0, 8.458))                                                                         // spine, top
book.curve(to: pt(5.958, 7.417), controlPoint1: pt(10.333, 7.208), controlPoint2: pt(8.042, 7.0))      // left page, top edge
book.line(to: pt(5.958, 15.958))
book.curve(to: pt(12.0, 17.0), controlPoint1: pt(8.042, 15.542), controlPoint2: pt(10.333, 15.75))   // left page, bottom edge
book.curve(to: pt(18.042, 15.958), controlPoint1: pt(13.667, 15.75), controlPoint2: pt(15.958, 15.542))
book.line(to: pt(18.042, 7.417))                                                                     // right page
book.curve(to: pt(12.0, 8.458), controlPoint1: pt(15.958, 7.0), controlPoint2: pt(13.667, 7.208))
book.close()
book.move(to: pt(12.0, 8.458)); book.line(to: pt(12.0, 17.0))                                          // spine
book.lineWidth = 1.875 * unit
book.lineCapStyle = .round
book.lineJoinStyle = .round
let entries = NSBezierPath()
entries.move(to: pt(14.292, 10.958)); entries.line(to: pt(15.958, 10.958))
entries.move(to: pt(14.292, 13.25)); entries.line(to: pt(15.958, 13.25))
entries.lineWidth = 1.25 * unit
entries.lineCapStyle = .round
NSColor.white.setStroke()
book.stroke()
entries.stroke()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))

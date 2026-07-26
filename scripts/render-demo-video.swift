#!/usr/bin/env swift

import AppKit
import AVFoundation
import CoreVideo
import Foundation

struct Slide {
    let image: String
    let title: String
    let caption: String
    let seconds: Int
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    fputs("Usage: render-demo-video.swift REPOSITORY_ROOT OUTPUT_MP4\n", stderr)
    exit(2)
}

let root = URL(fileURLWithPath: arguments[1], isDirectory: true)
let output = URL(fileURLWithPath: arguments[2])
let slides = [
    Slide(image: "docs/assets/sam-lab-blank-workbench.png", title: "1 · Honest blank workbench", caption: "No fake success and no checkpoint exist before a real data source is selected.", seconds: 18),
    Slide(image: "docs/assets/sam-lab-datahub-connected.png", title: "2 · Trusted DataHub context", caption: "The official MCP server exposes bounded schema, classification and lineage reads from local DataHub OSS.", seconds: 28),
    Slide(image: "docs/assets/sam-lab-proposal-review.png", title: "3 · Reviewable agent proposal", caption: "The agent returns a strict card-and-edge diff. The committed graph is unchanged until explicit approval.", seconds: 35),
    Slide(image: "docs/assets/sam-lab-reviewed-pipeline.png", title: "4 · Atomic graph correction", caption: "The approved revision adds profile memory, impact analysis, PII protection and a Human Review gate.", seconds: 34),
    Slide(image: "docs/assets/sam-lab-version-checkpoint.png", title: "5 · Evidence inherited by the next agent", caption: "The checkpoint preserves get_entities, list_schema_fields and get_lineage provenance for replay and audit.", seconds: 25),
]

let width = 1600
let height = 900
let framesPerSecond: Int32 = 5
let frameDuration = CMTime(value: 1, timescale: framesPerSecond)

try? FileManager.default.removeItem(at: output)
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 3_200_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
])
input.expectsMediaDataInRealTime = false

let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
])
guard writer.canAdd(input) else { throw NSError(domain: "SAM LAB demo", code: 1, userInfo: [NSLocalizedDescriptionKey: "AVAssetWriter refused the video input"]) }
writer.add(input)
guard writer.startWriting() else { throw writer.error ?? NSError(domain: "SAM LAB demo", code: 2) }
writer.startSession(atSourceTime: .zero)

let images: [NSImage] = try slides.map { slide in
    let url = root.appendingPathComponent(slide.image)
    guard let image = NSImage(contentsOf: url) else {
        throw NSError(domain: "SAM LAB demo", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to read \(url.path)"])
    }
    return image
}

func waitUntilReady() {
    while !input.isReadyForMoreMediaData { usleep(2_000) }
}

func drawImage(_ image: NSImage, in context: CGContext, alpha: CGFloat) {
    let available = CGRect(x: 34, y: 102, width: CGFloat(width - 68), height: CGFloat(height - 190))
    let imageRatio = image.size.width / image.size.height
    let availableRatio = available.width / available.height
    let size = imageRatio > availableRatio
        ? CGSize(width: available.width, height: available.width / imageRatio)
        : CGSize(width: available.height * imageRatio, height: available.height)
    let rect = CGRect(x: available.midX - size.width / 2, y: available.midY - size.height / 2, width: size.width, height: size.height)
    context.saveGState()
    context.setAlpha(alpha)
    context.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: NSColor.black.withAlphaComponent(0.34).cgColor)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    context.restoreGState()
}

func drawText(_ slide: Slide, in context: CGContext, alpha: CGFloat) {
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    let titleStyle: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 28, weight: .bold),
        .foregroundColor: NSColor.white.withAlphaComponent(alpha),
    ]
    let captionStyle: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 20, weight: .medium),
        .foregroundColor: NSColor(calibratedRed: 0.78, green: 0.82, blue: 0.92, alpha: alpha),
    ]
    (slide.title as NSString).draw(in: CGRect(x: 52, y: 842, width: 1496, height: 40), withAttributes: titleStyle)
    (slide.caption as NSString).draw(in: CGRect(x: 52, y: 34, width: 1496, height: 52), withAttributes: captionStyle)
    NSGraphicsContext.restoreGraphicsState()
}

var frameIndex: Int64 = 0
for (slideIndex, slide) in slides.enumerated() {
    let frameCount = slide.seconds * Int(framesPerSecond)
    for localFrame in 0..<frameCount {
        waitUntilReady()
        guard let pool = adaptor.pixelBufferPool else { throw NSError(domain: "SAM LAB demo", code: 4) }
        var optionalBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optionalBuffer) == kCVReturnSuccess, let buffer = optionalBuffer else {
            throw NSError(domain: "SAM LAB demo", code: 5)
        }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else { throw NSError(domain: "SAM LAB demo", code: 6) }
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { throw NSError(domain: "SAM LAB demo", code: 7) }

        context.setFillColor(NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.11, alpha: 1).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let transitionFrames = Int(framesPerSecond)
        let transition = localFrame < transitionFrames ? CGFloat(localFrame + 1) / CGFloat(transitionFrames) : 1
        if slideIndex > 0 && transition < 1 {
            drawImage(images[slideIndex - 1], in: context, alpha: 1 - transition)
        }
        drawImage(images[slideIndex], in: context, alpha: transition)
        context.setFillColor(NSColor(calibratedWhite: 0.02, alpha: 0.82).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: 96))
        context.fill(CGRect(x: 0, y: 828, width: width, height: 72))
        drawText(slide, in: context, alpha: transition)

        let presentationTime = CMTimeMultiply(frameDuration, multiplier: Int32(frameIndex))
        guard adaptor.append(buffer, withPresentationTime: presentationTime) else {
            throw writer.error ?? NSError(domain: "SAM LAB demo", code: 8)
        }
        frameIndex += 1
    }
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
guard writer.status == .completed else { throw writer.error ?? NSError(domain: "SAM LAB demo", code: 9) }
print("Rendered \(output.path) · \(slides.reduce(0) { $0 + $1.seconds }) seconds · \(frameIndex) frames")


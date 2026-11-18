import Foundation
import Vision

// Inspect the installed UIKit app through its final simulator screenshot.
let screenshot = URL(fileURLWithPath: CommandLine.arguments[1])
let target = CommandLine.arguments[2]
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.minimumTextHeight = 0.005
request.customWords = ["solid-gallery", "library"]
try VNImageRequestHandler(url: screenshot).perform([request])
let words = (request.results ?? []).compactMap { result -> (String, CGRect)? in
    guard let word = result.topCandidates(1).first else { return nil }
    return (word.string.lowercased(), result.boundingBox)
}
for (text, bounds) in words { print(text, bounds) }
guard let title = words.first(where: { $0.0.contains("solid-gallery") }),
      let button = words.first(where: { $0.0.contains("library") }),
      title.1.minY > button.1.maxY else {
    fatalError("The starter title and extension button must be visible and separated")
}
if target == "ios" && 1 - title.1.maxY < 0.065 {
    fatalError("The title overlaps the iPhone status bar")
}

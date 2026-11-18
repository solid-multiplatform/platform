import AVFoundation
import UIKit

/// AVFoundation owns decode, composition and timing. JavaScript receives state transitions
/// and one progress update per second. All bridge calls originate on the main thread.
@objc(SolidPlayback)
public final class SolidPlayback: UIView {
    public override class var layerClass: AnyClass { AVPlayerLayer.self }
    private let engine = AVPlayer()
    private var itemObserver: NSKeyValueObservation?
    private var stateObserver: NSKeyValueObservation?
    private var periodic: Any?
    private var ended: NSObjectProtocol?
    private var progress: ((String, Double, Double) -> Void)?
    private var prepared: ((String?) -> Void)?
    private var surface: AVPlayerLayer { layer as! AVPlayerLayer }

    @objc public static func make() -> SolidPlayback {
        let view = SolidPlayback(frame: .zero)
        view.surface.player = view.engine
        return view
    }

    @objc public func observe(_ handler: @escaping (String, Double, Double) -> Void) {
        progress = handler
        stateObserver = engine.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.report() }
        }
        periodic = engine.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 2), queue: .main) { [weak self] _ in self?.report() }
    }

    private func report() {
        guard let item = engine.currentItem, item.status == .readyToPlay else { return }
        let position = engine.currentTime().seconds, duration = item.duration.seconds
        let state = engine.timeControlStatus == .playing ? "playing" :
            (engine.timeControlStatus == .waitingToPlayAtSpecifiedRate ? "buffering" : "paused")
        progress?(state, position.isFinite ? position : 0, duration.isFinite ? duration : -1)
    }

    @objc(prepareURL:completion:)
    public func prepare(url value: String, completion: @escaping (String?) -> Void) {
        guard let url = URL(string: value), ["file","https","http"].contains(url.scheme?.lowercased() ?? "") else {
            completion("Unsupported media URL"); return
        }
        let item = AVPlayerItem(url: url)
        prepared = completion
        itemObserver = item.observe(\.status, options: [.initial,.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                guard let self = self, self.engine.currentItem === item else { return }
                switch item.status {
                case .readyToPlay:
                    let callback = self.prepared; self.prepared = nil
                    self.report(); callback?(nil)
                case .failed:
                    let callback = self.prepared; self.prepared = nil
                    self.progress?("error", 0, -1); callback?("AVPlayer item failed")
                default: break
                }
            }
        }
        ended = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            let end = item.duration.seconds
            self?.progress?("ended", end.isFinite ? end : 0, end.isFinite ? end : -1)
        }
        engine.replaceCurrentItem(with: item)
    }

    @objc public func play() { engine.play() }
    @objc public func pause() { engine.pause() }
    @objc(seekSeconds:completion:)
    public func seek(seconds: Double, completion: @escaping (Bool) -> Void) {
        engine.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero, completionHandler: completion)
    }
    @objc public func volume(_ level: Double) { engine.volume = Float(level) }
    @objc public func mute(_ enabled: Bool) { engine.isMuted = enabled }
    @objc public func fill(_ enabled: Bool) { surface.videoGravity = enabled ? .resizeAspectFill : .resizeAspect }

    @objc public func tracksJSON() -> String {
        guard let item = engine.currentItem else { return "{}" }
        var output: [String:Any] = ["audio":[],"text":[],"selectedAudioId":NSNull(),"selectedTextId":NSNull()]
        for (kind, characteristic) in [("audio", AVMediaCharacteristic.audible), ("text", .legible)] {
            guard let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: characteristic) else { continue }
            let selected = item.currentMediaSelection.selectedMediaOption(in: group)
            output[kind] = group.options.enumerated().map { index, option -> [String:Any] in
                let id = "\(kind):\(index)"
                if option == selected { output[kind == "audio" ? "selectedAudioId" : "selectedTextId"] = id }
                return ["id":id,"label":option.displayName,"language":option.extendedLanguageTag ?? "und","available":option.isPlayable]
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: output) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }
    @objc(selectKind:identifier:)
    public func select(kind: String, id: String?) -> Bool {
        guard let item = engine.currentItem,
              let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: kind == "audio" ? .audible : .legible) else { return false }
        if id == nil && group.allowsEmptySelection { item.select(nil, in: group); return true }
        guard let value = id, let index = group.options.indices.first(where: { "\(kind):\($0)" == value }),
              group.options[index].isPlayable else { return false }
        item.select(group.options[index], in: group); return true
    }
    @objc public func close() {
        progress = nil; prepared = nil
        itemObserver?.invalidate(); stateObserver?.invalidate()
        if let token = periodic { engine.removeTimeObserver(token); periodic = nil }
        if let token = ended { NotificationCenter.default.removeObserver(token); ended = nil }
        engine.pause(); engine.replaceCurrentItem(with: nil); surface.player = nil
    }
}

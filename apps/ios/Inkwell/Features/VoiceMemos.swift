import AVFoundation
import Observation
import Speech
import SwiftUI

enum MemoAudioError: LocalizedError {
    case microphoneDenied
    case recordingFailed
    case recordingMissing
    case playbackFailed

    var errorDescription: String? {
        switch self {
        case .microphoneDenied: "Microphone access is turned off. Enable it for Inkwell in Settings to record a memo."
        case .recordingFailed: "The recording could not be started. Please try again."
        case .recordingMissing: "This recording is not on this device and has not been uploaded yet."
        case .playbackFailed: "This recording could not be played."
        }
    }
}

/// Audio is saved in Documents before its annotation is returned to the reader.
/// Upload failures never remove the original recording.
enum MemoAudioStore {
    static func fileURL(memoID: String) throws -> URL {
        let directory = try FileManager.default.url(
            for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ).appendingPathComponent("VoiceMemos", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Existing server IDs are opaque. Encode them so none can escape this directory.
        let filename = Data(memoID.utf8).base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "=", with: "")
        return directory.appendingPathComponent(filename).appendingPathExtension("m4a")
    }

    static func existingFile(memoID: String) throws -> URL? {
        let url = try fileURL(memoID: memoID)
        if FileManager.default.fileExists(atPath: url.path) { return url }
        // An App Store update retains the React Native app's Documents directory.
        // Bring its unsynced recordings forward before attempting a remote download.
        guard let legacy = try legacyFile(memoID: memoID) else { return nil }
        do {
            try FileManager.default.copyItem(at: legacy, to: url)
            try? FileManager.default.removeItem(at: legacy)
            return url
        } catch {
            // Disk pressure must not make an otherwise playable original disappear.
            return legacy
        }
    }

    static func deleteLocal(memoID: String) throws {
        if let url = try existingFile(memoID: memoID) { try FileManager.default.removeItem(at: url) }
        if let legacy = try legacyFile(memoID: memoID) { try FileManager.default.removeItem(at: legacy) }
    }

    private static func legacyFile(memoID: String) throws -> URL? {
        let safe = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        guard !memoID.isEmpty, memoID.count <= 200,
              memoID.unicodeScalars.allSatisfy({ safe.contains($0) }) else { return nil }
        let documents = try FileManager.default.url(
            for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let legacy = documents.appendingPathComponent("memos", isDirectory: true)
            .appendingPathComponent(memoID).appendingPathExtension("m4a")
        return FileManager.default.fileExists(atPath: legacy.path) ? legacy : nil
    }

    @MainActor
    static func upload(memo: VoiceMemo, articleID: String, store: InkwellStore) async throws -> VoiceMemo {
        guard let url = try existingFile(memoID: memo.id) else { throw MemoAudioError.recordingMissing }
        try await store.uploadMemo(articleID: articleID, memoID: memo.id, fileURL: url)
        var uploaded = memo
        uploaded.status = "uploaded"
        return uploaded
    }

    @MainActor
    static func playableFile(memo: VoiceMemo, articleID: String, store: InkwellStore) async throws -> URL {
        if let local = try existingFile(memoID: memo.id) { return local }
        guard memo.status == "uploaded" else { throw MemoAudioError.recordingMissing }
        let data = try await store.downloadMemo(articleID: articleID, memoID: memo.id)
        let url = try fileURL(memoID: memo.id)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return url
    }

    @MainActor
    static func delete(memo: VoiceMemo, articleID: String, store: InkwellStore) async throws {
        // Delete remotely first: if offline, keep both the annotation and local audio for retry.
        try await store.deleteMemo(articleID: articleID, memoID: memo.id)
        try deleteLocal(memoID: memo.id)
    }
}

@MainActor
@Observable
private final class MemoRecorder: NSObject, AVAudioRecorderDelegate {
    let id = UUID().uuidString
    var isRecording = false
    var readyToSave = false
    var duration: TimeInterval = 0
    var level: Double = 0
    var error: String?
    var saved = false
    private var recorder: AVAudioRecorder?
    private var clock: Task<Void, Never>?
    private var interruptionObserver: NSObjectProtocol?

    func start() async {
        error = nil
        duration = 0
        level = 0
        readyToSave = false
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else { error = MemoAudioError.microphoneDenied.localizedDescription; return }
        guard !Task.isCancelled else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            #if compiler(>=6.2)
            let bluetooth = AVAudioSession.CategoryOptions.allowBluetoothHFP
            #else
            let bluetooth = AVAudioSession.CategoryOptions.allowBluetooth
            #endif
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, bluetooth])
            try session.setActive(true)
            let recording = try AVAudioRecorder(url: MemoAudioStore.fileURL(memoID: id), settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 64_000,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ])
            recording.delegate = self
            recording.isMeteringEnabled = true
            guard recording.prepareToRecord(), recording.record(forDuration: 600) else {
                throw MemoAudioError.recordingFailed
            }
            recorder = recording
            isRecording = true
            interruptionObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification, object: session, queue: .main
            ) { [weak self] notification in
                guard let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      type == AVAudioSession.InterruptionType.began.rawValue else { return }
                Task { @MainActor [weak self] in self?.stop() }
            }
            clock = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(100))
                    guard !Task.isCancelled, let self, let recorder = self.recorder else { return }
                    if recorder.isRecording {
                        self.duration = recorder.currentTime
                        recorder.updateMeters()
                        self.level = min(1, max(0, pow(10, Double(recorder.averagePower(forChannel: 0)) / 40)))
                    } else if self.isRecording {
                        self.stop()
                    }
                }
            }
        } catch {
            self.error = error.localizedDescription
            releaseSession()
        }
    }

    func stop() {
        guard isRecording else { return }
        duration = min(600, max(duration, recorder?.currentTime ?? 0))
        isRecording = false
        recorder?.stop()
        clock?.cancel()
        clock = nil
        readyToSave = duration > 0.3
        if !readyToSave {
            error = "Record for at least a moment before saving."
            try? MemoAudioStore.deleteLocal(memoID: id)
        }
        releaseSession()
    }

    func cancel() {
        clock?.cancel()
        clock = nil
        isRecording = false
        recorder?.stop()
        releaseSession()
        if !saved { try? MemoAudioStore.deleteLocal(memoID: id) }
    }

    private func releaseSession() {
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
        interruptionObserver = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self, self.isRecording else { return }
            if !flag { self.error = "Recording was interrupted. The captured audio has been kept." }
            self.stop()
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: (any Error)?) {
        let message = error?.localizedDescription ?? "The recording was interrupted."
        Task { @MainActor [weak self] in
            self?.error = message
            self?.stop()
        }
    }
}

/// Speech processing is explicitly restricted to the device. A missing model,
/// denied authorization, or timeout yields an empty transcript without losing audio.
@MainActor
private final class MemoTranscriber {
    private var task: SFSpeechRecognitionTask?
    private var timeout: Task<Void, Never>?
    private var continuation: CheckedContinuation<String, Never>?
    private var latestText = ""

    func transcribe(url: URL) async -> String {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.supportsOnDeviceRecognition, recognizer.isAvailable else { return "" }
        let authorization = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard authorization == .authorized, !Task.isCancelled else { return "" }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(returning: ""); return }
                self.continuation = continuation
                task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                    let text = result?.bestTranscription.formattedString
                    let complete = result?.isFinal == true || error != nil
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        if let text { self.latestText = text }
                        if complete { self.finish() }
                    }
                }
                timeout = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(45))
                    guard !Task.isCancelled else { return }
                    self?.finish()
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish() }
        }
    }

    private func finish() {
        guard let continuation else { return }
        self.continuation = nil
        timeout?.cancel()
        timeout = nil
        task?.cancel()
        task = nil
        continuation.resume(returning: latestText.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

struct MemoRecorderSheet: View {
    let articleID: String
    let anchor: CGPoint
    let store: InkwellStore
    let onRecorded: (VoiceMemo) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var recorder = MemoRecorder()
    @State private var processing = false
    @State private var starting = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 28) {
                Spacer(minLength: 12)
                Image(systemName: "waveform")
                    .font(.system(size: 52, weight: .light))
                    .foregroundStyle(recorder.isRecording ? Color.red : Color.accentColor)
                    .scaleEffect(recorder.isRecording ? 0.85 + recorder.level * 0.3 : 1)
                    .frame(height: 70)
                    .accessibilityHidden(true)
                Text(memoDuration(recorder.duration))
                    .font(.system(.largeTitle, design: .monospaced).weight(.medium))
                    .monospacedDigit()
                    .accessibilityLabel("Recorded \(memoDuration(recorder.duration))")
                if processing {
                    ProgressView("Transcribing on device…")
                } else {
                    Button {
                        if recorder.isRecording { recorder.stop() }
                        else {
                            starting = true
                            Task { await recorder.start(); starting = false }
                        }
                    } label: {
                        Label(recorder.isRecording ? "Stop and save" : "Record", systemImage: recorder.isRecording ? "stop.fill" : "mic.fill")
                            .frame(minWidth: 150, minHeight: 30)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(recorder.isRecording ? .red : .accentColor)
                    .disabled(starting)
                }
                Text("Up to 10 minutes")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let error = recorder.error {
                    Text(error).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                Spacer(minLength: 12)
            }
            .padding(28)
            .navigationTitle("Voice memo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { recorder.cancel(); dismiss() }.disabled(processing || starting)
                }
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(recorder.isRecording || processing || starting)
        .onChange(of: recorder.readyToSave) { _, ready in
            if ready { Task { await saveRecording() } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active && recorder.isRecording { recorder.stop() }
        }
        .onDisappear { recorder.cancel() }
    }

    private func saveRecording() async {
        guard !processing, !recorder.saved else { return }
        processing = true
        do {
            guard let url = try MemoAudioStore.existingFile(memoID: recorder.id) else {
                throw MemoAudioError.recordingMissing
            }
            let transcript = await MemoTranscriber().transcribe(url: url)
            let memo = VoiceMemo(
                id: recorder.id, x: Double(anchor.x), y: Double(anchor.y),
                durationMs: recorder.duration * 1_000, transcript: transcript,
                status: "local", createdAt: Date().timeIntervalSince1970 * 1_000
            )
            recorder.saved = true
            onRecorded(memo)
            dismiss()
        } catch {
            recorder.error = error.localizedDescription
            recorder.readyToSave = false
        }
        processing = false
    }
}

@MainActor
@Observable
private final class MemoPlayer: NSObject, AVAudioPlayerDelegate {
    var isPlaying = false
    var isLoading = true
    var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0
    var error: String?
    private var player: AVAudioPlayer?
    private var clock: Task<Void, Never>?

    func load(memo: VoiceMemo, articleID: String, store: InkwellStore) async {
        error = nil
        isLoading = true
        defer { isLoading = false }
        do {
            let url = try await MemoAudioStore.playableFile(memo: memo, articleID: articleID, store: store)
            guard !Task.isCancelled else { return }
            let audio = try AVAudioPlayer(contentsOf: url)
            guard audio.prepareToPlay() else { throw MemoAudioError.playbackFailed }
            audio.delegate = self
            player = audio
            duration = audio.duration
        } catch { self.error = error.localizedDescription }
    }

    func toggle() {
        guard let player else { return }
        if player.isPlaying {
            player.pause()
            isPlaying = false
            clock?.cancel()
        } else {
            do {
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                if player.currentTime >= duration - 0.05 { player.currentTime = 0 }
                guard player.play() else { throw MemoAudioError.playbackFailed }
                isPlaying = true
                clock?.cancel()
                clock = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .milliseconds(100))
                        guard !Task.isCancelled, let self else { return }
                        self.currentTime = self.player?.currentTime ?? 0
                        if self.player?.isPlaying != true { self.isPlaying = false; return }
                    }
                }
            } catch { self.error = error.localizedDescription }
        }
    }

    func seek(_ time: TimeInterval) {
        currentTime = min(duration, max(0, time))
        player?.currentTime = currentTime
    }

    func stop() {
        clock?.cancel()
        clock = nil
        player?.stop()
        isPlaying = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.isPlaying = false
            self.currentTime = self.duration
            self.clock?.cancel()
            if !flag { self.error = MemoAudioError.playbackFailed.localizedDescription }
        }
    }
}

struct MemoPlayerSheet: View {
    let memo: VoiceMemo
    let articleID: String
    let store: InkwellStore
    let onUpdated: (VoiceMemo) -> Void
    let onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var player = MemoPlayer()
    @State private var confirmingDelete = false
    @State private var working = false
    @State private var uploaded = false
    @State private var operationError: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 16) {
                    Button { player.toggle() } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title2).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.circle)
                    .disabled(player.isLoading || player.error != nil)
                    .accessibilityLabel(player.isPlaying ? "Pause voice memo" : "Play voice memo")
                    Slider(value: Binding(get: { player.currentTime }, set: { player.seek($0) }), in: 0...max(player.duration, 0.1))
                        .disabled(player.isLoading || player.error != nil)
                        .accessibilityLabel("Playback position")
                    Text(memoDuration(player.isPlaying || player.currentTime > 0 ? player.currentTime : max(player.duration, memo.durationMs / 1_000)))
                        .font(.callout.monospacedDigit()).frame(minWidth: 46, alignment: .trailing)
                }
                if player.isLoading { ProgressView("Loading recording…") }
                if let error = player.error {
                    Text(error).font(.callout).foregroundStyle(.red)
                }
                if let operationError {
                    Text(operationError).font(.callout).foregroundStyle(.red)
                }
                if memo.status == "local" && !uploaded {
                    HStack {
                        Label("Saved on this iPad", systemImage: "internaldrive")
                            .font(.footnote).foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry upload") { Task { await upload() } }.disabled(working)
                    }
                }
                ScrollView {
                    Text(memo.transcript.isEmpty ? "No transcript available. On-device speech recognition may be unavailable for this recording." : memo.transcript)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .foregroundStyle(memo.transcript.isEmpty ? .secondary : .primary)
                        .textSelection(.enabled)
                }
                HStack {
                    Text(Date(timeIntervalSince1970: memo.createdAt / 1_000), style: .date)
                        .font(.footnote).foregroundStyle(.secondary)
                    Spacer()
                    Button("Delete", role: .destructive) { confirmingDelete = true }.disabled(working)
                }
            }
            .padding(24)
            .navigationTitle("Voice memo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(working) } }
            .confirmationDialog("Delete this voice memo?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete recording", role: .destructive) { Task { await delete() } }
            } message: { Text("The recording and its transcript will be removed.") }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(working)
        .task { await player.load(memo: memo, articleID: articleID, store: store) }
        .onDisappear { player.stop() }
    }

    private func upload() async {
        working = true
        operationError = nil
        defer { working = false }
        do {
            let result = try await MemoAudioStore.upload(memo: memo, articleID: articleID, store: store)
            uploaded = true
            onUpdated(result)
        } catch { operationError = "Upload failed. Your recording is still saved on this iPad. \(error.localizedDescription)" }
    }

    private func delete() async {
        working = true
        operationError = nil
        player.stop()
        defer { working = false }
        do {
            try await MemoAudioStore.delete(memo: memo, articleID: articleID, store: store)
            onDelete()
            dismiss()
        } catch { operationError = "Could not delete the recording. Please retry when connected. \(error.localizedDescription)" }
    }
}

private func memoDuration(_ seconds: TimeInterval) -> String {
    let total = Int(min(Double(Int32.max), max(0, seconds.isFinite ? seconds : 0)))
    return String(format: "%d:%02d", total / 60, total % 60)
}

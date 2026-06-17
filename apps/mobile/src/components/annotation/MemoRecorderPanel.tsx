// Floating recording panel for the voice-memo tool. Owns the expo-audio
// recorder for one take: mounts → asks permission → records (mono 64kbps
// AAC m4a, 10-minute cap); Stop hands the file back, Cancel discards it.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Effect from "effect/Effect";

import {
  NativeCommandError,
  unknownErrorMessage,
} from "../../effect/errors";
import {
  runMobileEffect,
  useMobileEffectRunner,
} from "../../effect/react";
import { makeThemedStyles, useTheme } from "../../lib/theme";
import { prepareTranscription } from "../../lib/voiceMemos";

// Speech-appropriate settings: mono 64kbps AAC ≈ 0.5MB/min.
const SPEECH_PRESET: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  numberOfChannels: 1,
  bitRate: 64000,
};

const MAX_SECONDS = 600;

type Props = {
  onComplete: (recording: { uri: string; durationMs: number }) => void;
  /** Recording abandoned; `message` is a user-facing error when not chosen. */
  onCancel: (message?: string) => void;
};

const formatClock = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export function MemoRecorderPanel({ onComplete, onCancel }: Props) {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const run = useMobileEffectRunner();
  const [failed, setFailed] = useState(false);
  // Settling guards Stop/Cancel double-taps and the mount/unmount window.
  const settlingRef = useRef(false);
  const startedRef = useRef(false);
  const wasRecordingRef = useRef(false);
  const latestDurationMsRef = useRef(0);

  const recorder = useAudioRecorder(SPEECH_PRESET, (status) => {
    // Media-services reset (rare daemon crash) invalidates the recorder
    // mid-take; surface it instead of silently recording nothing.
    if (status.mediaServicesDidReset || status.error) setFailed(true);
  });
  const recorderState = useAudioRecorderState(recorder, 100);

  useEffect(() => {
    // Model preparation is independent so it overlaps with permission/setup.
    const cancelTranscriptionPreparation = run(prepareTranscription, {
      onFailure: (error) =>
        console.info("[Inkwell] Transcription preparation:", error.message),
    });
    const cancelStart = run(
      Effect.gen(function* () {
        const permission = yield* Effect.tryPromise({
          try: () => requestRecordingPermissionsAsync(),
          catch: (error) =>
            new NativeCommandError({
              operation: "request microphone permission",
              message: unknownErrorMessage(error),
            }),
        });
        if (!permission.granted) {
          return yield* new NativeCommandError({
            operation: "request microphone permission",
            message: "Microphone access is needed for voice memos.",
          });
        }
        yield* Effect.tryPromise({
          try: () =>
            setAudioModeAsync({
              allowsRecording: true,
              playsInSilentMode: true,
            }),
          catch: (error) =>
            new NativeCommandError({
              operation: "enable recording audio mode",
              message: unknownErrorMessage(error),
            }),
        });
        yield* Effect.tryPromise({
          try: () => recorder.prepareToRecordAsync(),
          catch: (error) =>
            new NativeCommandError({
              operation: "prepare audio recorder",
              message: unknownErrorMessage(error),
            }),
        });
        yield* Effect.try({
          try: () => recorder.record({ forDuration: MAX_SECONDS }),
          catch: (error) =>
            new NativeCommandError({
              operation: "start audio recorder",
              message: unknownErrorMessage(error),
            }),
        });
        startedRef.current = true;
      }),
      {
        onFailure: (error) => onCancel(error.message),
        onDefect: () => onCancel("Couldn't start recording."),
      }
    );
    return () => {
      cancelTranscriptionPreparation();
      cancelStart();
      runMobileEffect(
        Effect.tryPromise({
          try: () =>
            setAudioModeAsync({
              allowsRecording: false,
              playsInSilentMode: true,
            }),
          catch: (error) =>
            new NativeCommandError({
              operation: "restore playback audio mode",
              message: unknownErrorMessage(error),
            }),
        })
      );
    };
    // Runs once for the lifetime of the panel (one take per mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settle = useCallback(
    (commit: boolean) => {
      if (settlingRef.current) return;
      settlingRef.current = true;
      const durationMs = Math.max(
        latestDurationMsRef.current,
        Math.round(recorder.currentTime * 1000)
      );
      run(
        Effect.gen(function* () {
          if (startedRef.current) {
            yield* Effect.tryPromise({
              try: () => recorder.stop(),
              catch: (error) =>
                new NativeCommandError({
                  operation: "stop audio recorder",
                  message: unknownErrorMessage(error),
                }),
            }).pipe(
              Effect.catch((error) =>
                Effect.logWarning("Audio recorder stop failed", error)
              )
            );
          }
          yield* Effect.tryPromise({
            try: () =>
              setAudioModeAsync({
                allowsRecording: false,
                playsInSilentMode: true,
              }),
            catch: (error) =>
              new NativeCommandError({
                operation: "restore playback audio mode",
                message: unknownErrorMessage(error),
              }),
          });
          const uri = recorder.uri;
          return commit && uri && durationMs > 300
            ? { uri, durationMs }
            : null;
        }),
        {
          onSuccess: (recording) => {
            if (recording) onComplete(recording);
            else onCancel();
          },
          onFailure: () => onCancel("Couldn't finish recording."),
          onDefect: () => onCancel("Couldn't finish recording."),
        }
      );
    },
    [recorder, onComplete, onCancel, run]
  );

  useEffect(() => {
    if (failed) settle(false);
    // settle is stable enough; failure handling should not re-fire on rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  useEffect(() => {
    if (recorderState.durationMillis > 0) {
      latestDurationMsRef.current = recorderState.durationMillis;
    }
    if (recorderState.isRecording) {
      wasRecordingRef.current = true;
      return;
    }
    if (startedRef.current && wasRecordingRef.current) settle(true);
  }, [recorderState.durationMillis, recorderState.isRecording, settle]);

  const meterFraction =
    recorderState.metering != null
      ? Math.max(0, Math.min(1, 1 + recorderState.metering / 60))
      : 0;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.recordDot} />
        <Text style={styles.clock}>
          {formatClock(recorderState.durationMillis)}
        </Text>
        <View style={styles.meterTrack}>
          <View style={[styles.meterFill, { flex: meterFraction }]} />
          <View style={{ flex: 1 - meterFraction }} />
        </View>
        <Pressable
          onPress={() => settle(false)}
          accessibilityRole="button"
          accessibilityLabel="Discard recording"
          hitSlop={6}
          style={styles.cancelButton}
        >
          <MaterialCommunityIcons name="close" size={20} color={c.inkSecondary} />
        </Pressable>
        <Pressable
          onPress={() => settle(true)}
          accessibilityRole="button"
          accessibilityLabel="Finish recording"
          hitSlop={6}
          style={styles.stopButton}
        >
          <MaterialCommunityIcons name="stop" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    wrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 34,
      alignItems: "center",
    },
    panel: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: 28,
      borderCurve: "continuous",
      paddingVertical: 10,
      paddingLeft: 18,
      paddingRight: 12,
      shadowColor: "#172A3E",
      shadowOpacity: 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    recordDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.dangerSolid,
    },
    clock: {
      fontSize: 15,
      fontWeight: "600",
      color: c.ink,
      fontVariant: ["tabular-nums"],
      minWidth: 42,
    },
    meterTrack: {
      flexDirection: "row",
      width: 110,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.accentSoft,
      overflow: "hidden",
    },
    meterFill: {
      backgroundColor: c.accent,
      borderRadius: 3,
    },
    cancelButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    stopButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.dangerSolid,
    },
  })
);

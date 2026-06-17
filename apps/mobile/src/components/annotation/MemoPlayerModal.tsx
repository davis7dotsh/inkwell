// Playback modal for a pinned voice memo: play/pause, tap-to-seek progress,
// the transcript, and delete. Audio comes from the local store when the
// recording is still on this device, otherwise from the api worker (R2)
// with the Clerk bearer token.
import { useAuth } from "@clerk/expo";
import type { VoiceMemoAnnotation } from "@inkwell/content";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  type AudioSource,
} from "expo-audio";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Effect from "effect/Effect";

import { authToken } from "../../effect/commands";
import { mobileConfig } from "../../effect/codecs";
import {
  NativeCommandError,
  operationalErrorMessage,
  unknownErrorMessage,
} from "../../effect/errors";
import { useMobileEffectRunner } from "../../effect/react";
import { makeThemedStyles, useTheme } from "../../lib/theme";
import { showError } from "../../lib/toast";
import { findMemoFile, memoAudioUrl } from "../../lib/voiceMemos";
import { formatMemoDuration } from "./MemosLayer";

const API_URL = mobileConfig.apiUrl;

type Props = {
  memo: VoiceMemoAnnotation;
  articleId: string;
  onDelete: (memo: VoiceMemoAnnotation) => void;
  onClose: () => void;
};

export function MemoPlayerModal({ memo, articleId, onDelete, onClose }: Props) {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const { getToken } = useAuth();
  const run = useMobileEffectRunner();

  // The local recording wins when it's still on this device; otherwise the
  // audio streams from the worker (resolved async below, needs a token).
  const [source, setSource] = useState<AudioSource | null>(null);
  const [localChecked, setLocalChecked] = useState(false);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const player = useAudioPlayer(undefined, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const playbackError = status.error;
  const [barWidth, setBarWidth] = useState(0);

  const unavailable =
    localChecked &&
    !source &&
    (memo.status !== "uploaded" || !API_URL || remoteFailed);

  useEffect(() => {
    return run(findMemoFile(memo.id), {
      onSuccess: (file) => {
        if (file) setSource({ uri: file.uri });
        setLocalChecked(true);
      },
      onFailure: (error) => {
        setLocalChecked(true);
        showError(`Couldn't read memo audio: ${operationalErrorMessage(error)}`);
      },
    });
  }, [memo.id, run]);

  useEffect(() => {
    if (
      !localChecked ||
      source ||
      memo.status !== "uploaded" ||
      !API_URL ||
      remoteFailed
    ) {
      return;
    }
    return run(authToken("load voice memo", getToken), {
      onSuccess: (token) =>
        setSource({
          uri: memoAudioUrl(API_URL, articleId, memo.id),
          headers: { Authorization: `Bearer ${token}` },
        }),
      onFailure: (error) => {
        setRemoteFailed(true);
        showError(`Couldn't load memo audio: ${operationalErrorMessage(error)}`);
      },
    });
  }, [
    localChecked,
    source,
    memo.status,
    memo.id,
    articleId,
    getToken,
    remoteFailed,
    run,
  ]);

  useEffect(() => {
    if (source) player.replace(source);
    // player is hook-owned and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    if (!status.error) return;
    showError("This voice memo could not be played.");
  }, [status.error]);

  const duration = status.duration > 0 ? status.duration : memo.durationMs / 1000;
  const progress =
    duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  const togglePlayback = () => {
    if (!source || playbackError) return;
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || progress >= 1) {
      run(
        Effect.tryPromise({
          try: () => player.seekTo(0),
          catch: (error) =>
            new NativeCommandError({
              operation: "restart voice memo",
              message: unknownErrorMessage(error),
            }),
        }).pipe(
          Effect.andThen(
            Effect.try({
              try: () => player.play(),
              catch: (error) =>
                new NativeCommandError({
                  operation: "restart voice memo",
                  message: unknownErrorMessage(error),
                }),
            })
          )
        ),
        {
          onFailure: (error) =>
            showError(`Couldn't restart audio: ${error.message}`),
        }
      );
      return;
    }
    player.play();
  };

  const seekToFraction = (fraction: number) => {
    if (!source || duration <= 0) return;
    run(
      Effect.tryPromise({
        try: () =>
          player.seekTo(Math.max(0, Math.min(1, fraction)) * duration),
        catch: (error) =>
          new NativeCommandError({
            operation: "seek voice memo",
            message: unknownErrorMessage(error),
          }),
      }),
      {
        onFailure: (error) =>
          showError(`Couldn't seek audio: ${error.message}`),
      }
    );
  };

  const confirmDelete = () =>
    Alert.alert("Delete voice memo?", "The recording will be removed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(memo) },
    ]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.headerRow}>
            <MaterialCommunityIcons name="microphone" size={18} color={c.accent} />
            <Text style={styles.title}>Voice memo</Text>
            {memo.status === "local" ? (
              <Text style={styles.syncBadge}>Not synced yet</Text>
            ) : null}
          </View>

          <View style={styles.playerRow}>
            <Pressable
              onPress={togglePlayback}
              disabled={!source || Boolean(playbackError)}
              accessibilityRole="button"
              accessibilityLabel={status.playing ? "Pause" : "Play"}
              style={[
                styles.playButton,
                (!source || playbackError) && { opacity: 0.5 },
              ]}
            >
              <MaterialCommunityIcons
                name={status.playing ? "pause" : "play"}
                size={24}
                color={c.onAccent}
              />
            </Pressable>
            <Pressable
              style={styles.barTrack}
              onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
              onPress={(e) =>
                barWidth > 0 && seekToFraction(e.nativeEvent.locationX / barWidth)
              }
              accessibilityLabel="Seek"
            >
              <View style={[styles.barFill, { flex: progress }]} />
              <View style={{ flex: 1 - progress }} />
            </Pressable>
            <Text style={styles.clock}>
              {formatMemoDuration(
                (status.playing || status.currentTime > 0
                  ? status.currentTime
                  : duration) * 1000
              )}
            </Text>
          </View>

          {playbackError ? (
            <Text style={styles.unavailable}>
              This audio is currently unavailable.
            </Text>
          ) : unavailable ? (
            <Text style={styles.unavailable}>
              The audio isn&apos;t on this device yet.
            </Text>
          ) : null}

          <ScrollView style={styles.transcriptScroll}>
            <Text
              style={memo.transcript ? styles.transcript : styles.noTranscript}
            >
              {memo.transcript || "No transcript available."}
            </Text>
          </ScrollView>

          <View style={styles.row}>
            <Pressable onPress={confirmDelete} style={styles.button}>
              <Text style={[styles.buttonText, styles.deleteText]}>Delete</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} style={[styles.button, styles.doneButton]}>
              <Text style={[styles.buttonText, styles.doneText]}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.backdrop,
      alignItems: "center",
      justifyContent: "flex-start",
      paddingTop: 130,
      padding: 24,
    },
    card: {
      width: "100%",
      maxWidth: 440,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      borderRadius: 24,
      borderCurve: "continuous",
      padding: 20,
      gap: 16,
      shadowColor: "#172A3E",
      shadowOpacity: 0.14,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 12 },
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    title: {
      fontSize: 16,
      fontWeight: "600",
      color: c.ink,
    },
    syncBadge: {
      marginLeft: "auto",
      fontSize: 11.5,
      fontWeight: "600",
      color: c.accent,
    },
    playerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    playButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
    },
    barTrack: {
      flex: 1,
      flexDirection: "row",
      height: 8,
      borderRadius: 4,
      backgroundColor: c.accentSoft,
      overflow: "hidden",
    },
    barFill: {
      backgroundColor: c.accent,
      borderRadius: 4,
    },
    clock: {
      fontSize: 13,
      fontWeight: "600",
      color: c.inkSecondary,
      fontVariant: ["tabular-nums"],
      minWidth: 38,
      textAlign: "right",
    },
    unavailable: {
      fontSize: 13,
      color: c.inkFaint,
    },
    transcriptScroll: {
      maxHeight: 200,
    },
    transcript: {
      fontSize: 15,
      lineHeight: 22,
      color: c.ink,
    },
    noTranscript: {
      fontSize: 14,
      fontStyle: "italic",
      color: c.inkFaint,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    button: {
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 18,
      borderCurve: "continuous",
    },
    doneButton: {
      backgroundColor: c.accent,
    },
    buttonText: {
      fontSize: 15,
      fontWeight: "600",
      color: c.inkSecondary,
    },
    doneText: { color: c.onAccent },
    deleteText: { color: c.danger },
  })
);

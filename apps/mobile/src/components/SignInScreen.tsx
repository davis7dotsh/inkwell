// SSO sign-in (Apple / GitHub / Google — the providers configured on the
// Clerk instance). Uses Clerk's browser-based SSO flow via expo-web-browser;
// in Expo Go the redirect lands on the exp:// development URL, in a dev
// build on the app scheme.
import { useSSO } from "@clerk/expo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Effect from "effect/Effect";

import { authCommand } from "../effect/commands";
import { AuthCommandError, operationalErrorMessage } from "../effect/errors";
import { runMobileEffect, useMobileEffectRunner } from "../effect/react";
import { coolBrowser, warmBrowser } from "../lib/nativeCommands";
import { makeThemedStyles, serif, useTheme } from "../lib/theme";
import { showError } from "../lib/toast";

import { GlassSurface, glassAvailable } from "./glass";

WebBrowser.maybeCompleteAuthSession();

type Provider = {
  strategy: "oauth_github" | "oauth_google";
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
};

// GitHub + Google — the providers configured on both Clerk instances.
// (Apple Sign-In requires a paid Apple Developer account; add it here and in
// the Clerk dashboard if that ever changes.)
const PROVIDERS: Provider[] = [
  { strategy: "oauth_github", label: "Continue with GitHub", icon: "github" },
  { strategy: "oauth_google", label: "Continue with Google", icon: "google" },
];

export function SignInScreen() {
  const { startSSOFlow } = useSSO();
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const run = useMobileEffectRunner();
  const [busy, setBusy] = useState<Provider["strategy"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Warm up the in-app browser so the first tap feels instant.
  useEffect(() => {
    const cancelWarmup = run(warmBrowser);
    return () => {
      cancelWarmup();
      runMobileEffect(coolBrowser);
    };
  }, [run]);

  const signInWith = useCallback(
    (strategy: Provider["strategy"]) => {
      setBusy(strategy);
      setError(null);
      run(
        Effect.gen(function* () {
          const result = yield* authCommand("start sign-in", () =>
            startSSOFlow({
              strategy,
              redirectUrl: AuthSession.makeRedirectUri(),
            }),
          );
          const { createdSessionId, setActive } = result;
          if (createdSessionId && setActive) {
            yield* authCommand("activate session", () =>
              setActive({ session: createdSessionId }),
            );
            return;
          }
          if (result.authSessionResult?.type === "cancel") return;
          return yield* new AuthCommandError({
            operation: "complete sign-in",
            message:
              "Sign-in didn't complete. If this account is new, try again or use another provider.",
          });
        }),
        {
          onSuccess: () => setBusy(null),
          onFailure: (failure) => {
            const message = operationalErrorMessage(failure);
            setError(message);
            setBusy(null);
            showError(message);
          },
          onDefect: (failure) => {
            const message = operationalErrorMessage(failure);
            setError(message);
            setBusy(null);
            showError(message);
          },
        },
      );
    },
    [run, startSSOFlow],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>PRIVATE READING LIBRARY</Text>
        <Text style={styles.title}>Inkwell</Text>
        <View style={styles.rule} />
        <Text style={styles.subtitle}>
          Keep articles, notes, and voice memos in sync across your devices.
        </Text>

        {PROVIDERS.map((provider) => (
          <Pressable
            key={provider.strategy}
            style={({ pressed }) =>
              pressed && !glassAvailable && styles.buttonPressed
            }
            disabled={busy !== null}
            accessibilityRole="button"
            onPress={() => signInWith(provider.strategy)}
          >
            <GlassSurface
              isInteractive
              effectStyle="clear"
              style={styles.button}
              fallbackStyle={styles.buttonFallback}
            >
              {busy === provider.strategy ? (
                <ActivityIndicator color={c.ink} />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={provider.icon}
                    size={20}
                    color={c.ink}
                  />
                  <Text style={styles.buttonText}>{provider.label}</Text>
                </>
              )}
            </GlassSurface>
          </Pressable>
        ))}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    card: {
      width: "100%",
      maxWidth: 380,
      gap: 13,
    },
    eyebrow: {
      fontSize: 10.5,
      fontWeight: "700",
      letterSpacing: 1.35,
      color: c.inkFaint,
      textAlign: "center",
    },
    title: {
      fontFamily: serif,
      fontSize: 38,
      lineHeight: 44,
      fontWeight: "600",
      color: c.ink,
      textAlign: "center",
    },
    rule: {
      width: 42,
      height: StyleSheet.hairlineWidth,
      alignSelf: "center",
      backgroundColor: c.inkFaint,
      marginTop: 2,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14.5,
      lineHeight: 21,
      color: c.inkSecondary,
      textAlign: "center",
      marginBottom: 18,
    },
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      borderRadius: 24,
      borderCurve: "continuous",
      height: 48,
    },
    buttonFallback: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.hairline,
    },
    buttonPressed: {
      opacity: 0.7,
    },
    buttonText: {
      fontSize: 15.5,
      fontWeight: "600",
      color: c.ink,
    },
    error: {
      fontSize: 13.5,
      color: c.danger,
      textAlign: "center",
      marginTop: 8,
    },
  }),
);

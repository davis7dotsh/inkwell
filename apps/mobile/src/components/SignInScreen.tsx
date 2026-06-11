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

import { makeThemedStyles, serif, useTheme } from "../lib/theme";
import { showError } from "../lib/toast";

import { BackdropWash } from "./BackdropWash";
import { BrushStroke } from "./BrushStroke";
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
  const [busy, setBusy] = useState<Provider["strategy"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Warm up the in-app browser so the first tap feels instant.
  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const signInWith = useCallback(
    async (strategy: Provider["strategy"]) => {
      setBusy(strategy);
      setError(null);
      try {
        const { createdSessionId, setActive, authSessionResult } =
          await startSSOFlow({
            strategy,
            redirectUrl: AuthSession.makeRedirectUri(),
          });
        if (createdSessionId && setActive) {
          await setActive({ session: createdSessionId });
          return; // useConvexAuth flips and the gate swaps screens.
        }
        if (authSessionResult?.type === "cancel") return;
        const message =
          "Sign-in didn't complete. If this account is new, try again — or use another provider.";
        setError(message);
        showError(message);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        showError(message);
      } finally {
        setBusy(null);
      }
    },
    [startSSOFlow]
  );

  return (
    <View style={styles.screen}>
      <BackdropWash />
      <View style={styles.card}>
        <Text style={styles.title}>Inkwell</Text>
        <BrushStroke
          width={118}
          height={9}
          color={c.wash}
          style={{ alignSelf: "center", marginTop: 2 }}
        />
        <Text style={styles.subtitle}>
          Sign in to sync your library across devices.
        </Text>

        {PROVIDERS.map((provider) => (
          <Pressable
            key={provider.strategy}
            style={({ pressed }) =>
              pressed && !glassAvailable && styles.buttonPressed
            }
            disabled={busy !== null}
            accessibilityRole="button"
            onPress={() => void signInWith(provider.strategy)}
          >
            <GlassSurface
              isInteractive
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
      gap: 12,
    },
    title: {
      fontFamily: serif,
      fontSize: 34,
      fontWeight: "700",
      color: c.ink,
      textAlign: "center",
    },
    subtitle: {
      fontSize: 14,
      color: c.inkSecondary,
      textAlign: "center",
      marginTop: 6,
      marginBottom: 14,
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
  })
);

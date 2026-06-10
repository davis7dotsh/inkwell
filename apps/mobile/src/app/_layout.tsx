import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { SignInScreen } from "../components/SignInScreen";
import { colors, serif } from "../lib/theme";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

// One client for the app's lifetime (created outside React).
const convex = convexUrl
  ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false })
  : null;

/** Spinner sign-in/app gate. Convex must validate the Clerk token, so gate on
 * useConvexAuth(), not Clerk's isSignedIn. */
function AuthGate() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!isAuthenticated) {
    return <SignInScreen />;
  }
  return (
    <Stack
      screenOptions={{
        // Screens render their own safe-area-aware headers (ScreenHeader).
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}

/** Shown instead of crashing when the EXPO_PUBLIC_ env vars aren't set. */
function ConfigNeededScreen() {
  const missing = [
    !publishableKey && "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    !convexUrl && "EXPO_PUBLIC_CONVEX_URL",
  ].filter((name): name is string => Boolean(name));
  return (
    <View style={styles.configScreen}>
      <Text style={styles.configTitle}>Inkwell</Text>
      <Text style={styles.configText}>
        Almost there — this build is missing configuration. Copy
        {" .env.example"} to {".env.local"} and set:
      </Text>
      {missing.map((name) => (
        <Text key={name} style={styles.configVar}>
          {name}
        </Text>
      ))}
      <Text style={styles.configText}>Then restart the dev server.</Text>
    </View>
  );
}

export default function RootLayout() {
  if (!publishableKey || !convex) {
    return (
      <View style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <ConfigNeededScreen />
      </View>
    );
  }
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar style="dark" />
          <AuthGate />
        </GestureHandlerRootView>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  configScreen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    gap: 12,
  },
  configTitle: {
    fontFamily: serif,
    fontSize: 30,
    fontWeight: "700",
    color: colors.ink,
  },
  configText: {
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  configVar: {
    fontSize: 13.5,
    color: colors.accent,
    fontWeight: "600",
  },
});

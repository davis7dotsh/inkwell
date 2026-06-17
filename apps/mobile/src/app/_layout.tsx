import { ClerkProvider, useAuth } from "@clerk/expo";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { FatalErrorScreen } from "../components/FatalErrorScreen";
import { SignInScreen } from "../components/SignInScreen";
import { ToastViewport } from "../components/ToastViewport";
import { createClerkTokenCache } from "../lib/clerkTokenCache";
import {
  clearLastFatalReport,
  persistFatalReport,
  readLastFatalReport,
  setFatalErrorListener,
  toFatalReport,
  type FatalReport,
} from "../lib/crashGuard";
import { makeThemedStyles, serif, useTheme } from "../lib/theme";
import { showError } from "../lib/toast";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const clerkFrontendApiUrl = "https://clerk.inkwellapp.net";
const STARTUP_TIMEOUT_MS = 8000;
const clerkTokenCache = publishableKey
  ? createClerkTokenCache(publishableKey)
  : undefined;

// One client for the app's lifetime (created outside React).
const convex = convexUrl
  ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false })
  : null;

function getClerkErrorCode(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const errors = Reflect.get(payload, "errors");
  if (!Array.isArray(errors) || !errors[0] || typeof errors[0] !== "object") {
    return null;
  }
  const code = Reflect.get(errors[0], "code");
  return typeof code === "string" ? code : null;
}

/** Spinner sign-in/app gate. Convex must validate the Clerk token, so gate on
 * useConvexAuth(), not Clerk's isSignedIn. */
function AuthGate() {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const clerk = useAuth();
  const convexAuth = useConvexAuth();
  const [clerkProbe, setClerkProbe] = useState("pending");
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${clerkFrontendApiUrl}/v1/environment?_is_native=1`, {
      headers: {
        "x-mobile": "1",
        "x-expo-sdk-version": "3.3.1",
      },
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        const code = getClerkErrorCode(payload);
        if (!cancelled) {
          setClerkProbe(code ?? `HTTP ${response.status}`);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setClerkProbe(
            error instanceof Error ? error.message : "Unknown network error"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (clerk.isLoaded && !convexAuth.isLoading) {
      setTimedOut(false);
      return;
    }
    const timeout = setTimeout(() => setTimedOut(true), STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [clerk.isLoaded, convexAuth.isLoading]);

  useEffect(() => {
    if (!timedOut) return;
    showError(
      clerkProbe === "native_api_disabled"
        ? "Clerk Native API is disabled for the production instance."
        : clerk.isLoaded
        ? "Convex could not validate the production session."
        : "Clerk could not initialize the production session."
    );
  }, [clerk.isLoaded, clerkProbe, timedOut]);

  if (timedOut) {
    const stage = clerk.isLoaded ? "Convex authentication" : "Clerk startup";
    return (
      <View style={styles.startupError}>
        <Text style={styles.configTitle}>Inkwell couldn&apos;t start</Text>
        <Text style={styles.configText}>
          {stage} did not finish. The issue has been logged.
        </Text>
        <Text style={styles.diagnostic}>
          Clerk loaded: {String(clerk.isLoaded)}
          {"\n"}Clerk signed in: {String(clerk.isSignedIn)}
          {"\n"}Clerk endpoint: {clerkProbe}
          {"\n"}Convex loading: {String(convexAuth.isLoading)}
          {"\n"}Convex authenticated: {String(convexAuth.isAuthenticated)}
        </Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => setTimedOut(false)}
        >
          <Text style={styles.retryButtonText}>Try again</Text>
        </Pressable>
        {clerk.isLoaded && clerk.isSignedIn ? (
          <Pressable
            style={styles.secondaryButton}
            onPress={() => void clerk.signOut()}
          >
            <Text style={styles.secondaryButtonText}>Reset session</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (convexAuth.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.accent} />
        <Text style={styles.loadingText}>
          {clerk.isLoaded ? "Connecting to Inkwell…" : "Starting sign-in…"}
        </Text>
      </View>
    );
  }
  if (!convexAuth.isAuthenticated) {
    return <SignInScreen />;
  }
  return (
    <Stack
      screenOptions={{
        // Screens render their own safe-area-aware headers (ScreenHeader).
        headerShown: false,
        contentStyle: { backgroundColor: c.background },
      }}
    />
  );
}

/** Shown instead of crashing when the EXPO_PUBLIC_ env vars aren't set. */
function ConfigNeededScreen() {
  const { scheme } = useTheme();
  const styles = themed[scheme];
  const missing = [
    !publishableKey && "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    !convexUrl && "EXPO_PUBLIC_CONVEX_URL",
  ].filter((name): name is string => Boolean(name));
  return (
    <View style={styles.configScreen}>
      <Text style={styles.configTitle}>Inkwell</Text>
      <Text style={styles.configText}>
        Almost there. This build is missing configuration. Set the matching
        values in {".env.development"} or {".env.production"}:
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

/** Catches render errors anywhere in the tree and shows the diagnostic
 * screen instead of letting the release build abort. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { report: FatalReport | null }
> {
  state: { report: FatalReport | null } = { report: null };

  static getDerivedStateFromError(error: unknown) {
    return { report: toFatalReport(error, true) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const report = this.state.report ?? toFatalReport(error, true);
    persistFatalReport({
      ...report,
      stack: [report.stack, info.componentStack].filter(Boolean).join("\n"),
    });
  }

  render() {
    if (this.state.report) {
      return (
        <FatalErrorScreen
          report={this.state.report}
          mode="live"
          onClose={() => this.setState({ report: null })}
        />
      );
    }
    return this.props.children;
  }
}

/** Surfaces fatal errors the boundary can't see: ones reported through the
 * global handler (event handlers, timers) and ones persisted by a previous
 * launch that died. */
function CrashGate({ children }: { children: React.ReactNode }) {
  const [liveReport, setLiveReport] = useState<FatalReport | null>(null);
  const [previousReport, setPreviousReport] = useState<FatalReport | null>(
    () => readLastFatalReport()
  );

  useEffect(() => {
    setFatalErrorListener(setLiveReport);
    return () => setFatalErrorListener(null);
  }, []);

  if (liveReport) {
    return (
      <FatalErrorScreen
        report={liveReport}
        mode="live"
        onClose={() => setLiveReport(null)}
      />
    );
  }
  if (previousReport) {
    return (
      <FatalErrorScreen
        report={previousReport}
        mode="previous"
        onClose={() => {
          clearLastFatalReport();
          setPreviousReport(null);
        }}
      />
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <RootErrorBoundary>
      <CrashGate>
        {!publishableKey || !convex ? (
          <View style={{ flex: 1 }}>
            <StatusBar style="auto" />
            <ConfigNeededScreen />
          </View>
        ) : (
          <ClerkProvider
            publishableKey={publishableKey}
            tokenCache={clerkTokenCache}
          >
            <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
              <SafeAreaProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <StatusBar style="auto" />
                  <AuthGate />
                  <ToastViewport />
                </GestureHandlerRootView>
              </SafeAreaProvider>
            </ConvexProviderWithClerk>
          </ClerkProvider>
        )}
      </CrashGate>
    </RootErrorBoundary>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.background,
      gap: 12,
    },
    loadingText: {
      color: c.inkSecondary,
      fontSize: 14,
    },
    startupError: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.background,
      paddingHorizontal: 30,
      gap: 14,
    },
    diagnostic: {
      width: "100%",
      maxWidth: 420,
      padding: 14,
      borderRadius: 10,
      backgroundColor: c.surface,
      color: c.inkSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    retryButton: {
      minWidth: 180,
      alignItems: "center",
      borderRadius: 12,
      backgroundColor: c.accent,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    retryButtonText: {
      color: c.onAccent,
      fontSize: 15,
      fontWeight: "700",
    },
    secondaryButton: {
      minWidth: 180,
      alignItems: "center",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.surface,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    secondaryButtonText: {
      color: c.ink,
      fontSize: 14,
      fontWeight: "600",
    },
    configScreen: {
      flex: 1,
      backgroundColor: c.background,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 36,
      gap: 12,
    },
    configTitle: {
      fontFamily: serif,
      fontSize: 30,
      fontWeight: "700",
      color: c.ink,
    },
    configText: {
      fontSize: 14.5,
      lineHeight: 21,
      color: c.inkSecondary,
      textAlign: "center",
    },
    configVar: {
      fontSize: 13.5,
      color: c.accent,
      fontWeight: "600",
    },
  })
);

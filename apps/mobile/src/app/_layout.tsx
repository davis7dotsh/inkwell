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
import * as Effect from "effect/Effect";

import { FatalErrorScreen } from "../components/FatalErrorScreen";
import { SignInScreen } from "../components/SignInScreen";
import { ToastViewport } from "../components/ToastViewport";
import { authCommand } from "../effect/commands";
import { mobileConfig } from "../effect/codecs";
import { operationalErrorMessage } from "../effect/errors";
import { useMobileEffectRunner } from "../effect/react";
import { probeClerkEnvironment } from "../lib/authProbe";
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

const publishableKey = mobileConfig.clerkPublishableKey;
const convexUrl = mobileConfig.convexUrl;
const STARTUP_TIMEOUT_MS = 8000;
const clerkTokenCache = publishableKey
  ? createClerkTokenCache(publishableKey)
  : undefined;

// One client for the app's lifetime (created outside React).
const convex = convexUrl
  ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false })
  : null;

/** Spinner sign-in/app gate. Convex must validate the Clerk token, so gate on
 * useConvexAuth(), not Clerk's isSignedIn. */
function AuthGate() {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const clerk = useAuth();
  const convexAuth = useConvexAuth();
  const run = useMobileEffectRunner();
  const [clerkProbe, setClerkProbe] = useState("pending");
  const [timedOut, setTimedOut] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const startupPending = !clerk.isLoaded || convexAuth.isLoading;

  useEffect(() => {
    return run(probeClerkEnvironment, {
      onSuccess: setClerkProbe,
      onFailure: (error) => setClerkProbe(operationalErrorMessage(error)),
      onDefect: (error) => setClerkProbe(operationalErrorMessage(error)),
    });
  }, [retryAttempt, run]);

  useEffect(() => {
    if (!startupPending) {
      const reset = setTimeout(() => setTimedOut(false), 0);
      return () => clearTimeout(reset);
    }
    return run(Effect.sleep(STARTUP_TIMEOUT_MS), {
      onSuccess: () => setTimedOut(true),
      onDefect: (error) =>
        showError(`Startup timer failed: ${operationalErrorMessage(error)}`),
    });
  }, [retryAttempt, run, startupPending]);

  useEffect(() => {
    if (!timedOut || !startupPending) return;
    showError(
      clerkProbe === "native_api_disabled"
        ? "Clerk Native API is disabled for the production instance."
        : clerk.isLoaded
          ? "Convex could not validate the production session."
          : "Clerk could not initialize the production session.",
    );
  }, [clerk.isLoaded, clerkProbe, startupPending, timedOut]);

  if (timedOut && startupPending) {
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
          onPress={() => {
            setTimedOut(false);
            setClerkProbe("pending");
            setRetryAttempt((attempt) => attempt + 1);
          }}
        >
          <Text style={styles.retryButtonText}>Try again</Text>
        </Pressable>
        {clerk.isLoaded && clerk.isSignedIn ? (
          <Pressable
            style={styles.secondaryButton}
            onPress={() =>
              run(authCommand("reset session", clerk.signOut), {
                onFailure: (error) => showError(operationalErrorMessage(error)),
              })
            }
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
  const run = useMobileEffectRunner();
  const [liveReport, setLiveReport] = useState<FatalReport | null>(null);
  const [previousReport, setPreviousReport] = useState<
    FatalReport | null | undefined
  >(undefined);

  useEffect(() => {
    setFatalErrorListener(setLiveReport);
    return () => setFatalErrorListener(null);
  }, []);

  useEffect(
    () =>
      run(readLastFatalReport, {
        onSuccess: setPreviousReport,
        onFailure: (error) => {
          clearLastFatalReport();
          setPreviousReport(null);
          showError(
            `The previous crash report was unreadable: ${operationalErrorMessage(
              error,
            )}`,
          );
        },
      }),
    [run],
  );

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
  if (previousReport === undefined) return null;
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
  }),
);

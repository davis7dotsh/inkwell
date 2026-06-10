// Custom email-code auth (works in Expo Go; native OAuth needs a dev build).
// One screen covers both directions: try the sign-in flow first, and when
// Clerk reports no matching account, transparently switch to sign-up. Built
// on the Core 3 signal hooks (useSignIn/useSignUp return `Future` resources
// whose methods resolve to { error } instead of throwing).
import { isClerkAPIResponseError, useSignIn, useSignUp } from "@clerk/expo";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, serif } from "../lib/theme";

import { BrushStroke } from "./BrushStroke";

type AuthError = { code: string; message: string; longMessage?: string };

function describe(error: AuthError): string {
  return error.longMessage ?? error.message;
}

/** Clerk's "no account for this identifier" — the cue to sign up instead. */
function needsSignUp(error: AuthError): boolean {
  if (error.code === "form_identifier_not_found") return true;
  return (
    isClerkAPIResponseError(error) &&
    error.errors.some((e) => e.code === "form_identifier_not_found")
  );
}

export function SignInScreen() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  const [step, setStep] = useState<"email" | "code">("email");
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = useCallback(async () => {
    const address = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setError("That doesn't look like an email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await signIn.create({ identifier: address });
      if (!created.error) {
        const sent = await signIn.emailCode.sendCode({
          emailAddress: address,
        });
        if (sent.error) {
          setError(describe(sent.error));
          return;
        }
        setMode("signIn");
        setStep("code");
        return;
      }
      if (!needsSignUp(created.error)) {
        setError(describe(created.error));
        return;
      }
      // No account yet — create one and verify the same way.
      const signedUp = await signUp.create({ emailAddress: address });
      if (signedUp.error) {
        setError(describe(signedUp.error));
        return;
      }
      const sent = await signUp.verifications.sendEmailCode();
      if (sent.error) {
        setError(describe(sent.error));
        return;
      }
      setMode("signUp");
      setStep("code");
    } finally {
      setBusy(false);
    }
  }, [email, signIn, signUp]);

  const verifyCode = useCallback(async () => {
    const trimmed = code.trim();
    if (trimmed.length < 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // finalize() activates the new session (Core 3's setActive); the
      // Convex auth gate then swaps this screen out automatically.
      if (mode === "signIn") {
        const verified = await signIn.emailCode.verifyCode({ code: trimmed });
        if (verified.error) {
          setError(describe(verified.error));
          return;
        }
        const finalized = await signIn.finalize();
        if (finalized.error) setError(describe(finalized.error));
      } else {
        const verified = await signUp.verifications.verifyEmailCode({
          code: trimmed,
        });
        if (verified.error) {
          setError(describe(verified.error));
          return;
        }
        const finalized = await signUp.finalize();
        if (finalized.error) setError(describe(finalized.error));
      }
    } finally {
      setBusy(false);
    }
  }, [code, mode, signIn, signUp]);

  const startOver = useCallback(() => {
    setStep("email");
    setCode("");
    setError(null);
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Inkwell</Text>
        <BrushStroke
          width={118}
          height={9}
          color={colors.wash}
          style={{ marginTop: 4 }}
        />
        <Text style={styles.subtitle}>
          {step === "email"
            ? "Sign in with your email — we'll send you a code."
            : `Enter the code we sent to ${email.trim()}.`}
        </Text>

        {step === "email" ? (
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            returnKeyType="go"
            editable={!busy}
            onSubmitEditing={() => void sendCode()}
          />
        ) : (
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={setCode}
            placeholder="••••••"
            placeholderTextColor={colors.inkFaint}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            returnKeyType="go"
            editable={!busy}
            onSubmitEditing={() => void verifyCode()}
          />
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          disabled={busy}
          onPress={() =>
            void (step === "email" ? sendCode() : verifyCode())
          }
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>
              {step === "email" ? "Send code" : "Verify"}
            </Text>
          )}
        </Pressable>

        {step === "code" ? (
          <Pressable onPress={startOver} disabled={busy} hitSlop={8}>
            <Text style={styles.linkText}>Use a different email</Text>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
  },
  title: {
    fontFamily: serif,
    fontSize: 34,
    fontWeight: "700",
    color: colors.ink,
  },
  subtitle: {
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.inkSecondary,
    textAlign: "center",
    marginTop: 14,
    marginBottom: 22,
  },
  input: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  codeInput: {
    textAlign: "center",
    fontSize: 22,
    letterSpacing: 10,
  },
  error: {
    fontSize: 13.5,
    lineHeight: 19,
    color: "#B0413E",
    textAlign: "center",
    marginTop: 12,
  },
  button: {
    alignSelf: "stretch",
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15.5,
  },
  linkText: {
    fontSize: 14,
    color: colors.link,
    marginTop: 18,
  },
});

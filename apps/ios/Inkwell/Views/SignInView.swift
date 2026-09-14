import SwiftUI

struct SignInView: View {
    let auth: Authentication
    var onExploreDemo: (() -> Void)? = nil
    @State private var activeProvider: OAuthProvider?
    @State private var verificationCode = ""
    @State private var useRecoveryCode = false

    var body: some View {
        ZStack {
            InkwellTheme.paper.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 30) {
                    Image(systemName: "book.closed")
                        .font(.system(size: 40, weight: .light))
                        .accessibilityHidden(true)
                    Text("Inkwell")
                        .font(InkwellTheme.serif(48))
                    if auth.needsSecondFactor {
                        verificationForm
                    } else {
                        VStack(spacing: 14) {
                            ForEach(OAuthProvider.allCases) { provider in
                                Button {
                                    activeProvider = provider
                                    Task {
                                        await auth.signIn(provider: provider)
                                        activeProvider = nil
                                    }
                                } label: {
                                    HStack(spacing: 12) {
                                        if auth.isLoading && activeProvider == provider {
                                            ProgressView().tint(.primary)
                                        } else {
                                            Text("Continue with \(provider.name)")
                                                .font(.system(size: 17, weight: .medium))
                                        }
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 54)
                                    .contentShape(Capsule())
                                }
                                .buttonStyle(.plain)
                                .background(InkwellTheme.leaf, in: Capsule())
                                .overlay(Capsule().strokeBorder(InkwellTheme.hairline, lineWidth: 0.75))
                                .disabled(auth.isLoading)
                                .accessibilityIdentifier("signin-\(provider.rawValue)")
                            }
                        }
                    }
                    if let error = auth.error {
                        Text(error)
                            .font(.callout)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .textSelection(.enabled)
                            .accessibilityIdentifier("signin-error")
                    }
                    #if DEBUG
                    if let onExploreDemo, !auth.needsSecondFactor {
                        Button("Explore sample library", action: onExploreDemo)
                            .font(.callout)
                            .foregroundStyle(InkwellTheme.secondary)
                            .padding(.top, 12)
                            .accessibilityIdentifier("explore-demo")
                    }
                    #endif
                }
                .frame(maxWidth: 340)
                .padding(32)
                .frame(maxWidth: .infinity)
                .containerRelativeFrame(.vertical, alignment: .center)
            }
        }
        .foregroundStyle(InkwellTheme.ink)
        .tint(InkwellTheme.accent)
    }

    private var verificationForm: some View {
        VStack(spacing: 16) {
            Text(useRecoveryCode ? "Enter a recovery code" : "Enter your authenticator code")
                .font(.body)
            TextField(useRecoveryCode ? "Recovery code" : "Verification code", text: $verificationCode)
                .textContentType(.oneTimeCode)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(useRecoveryCode ? .asciiCapable : .numberPad)
                .textFieldStyle(.roundedBorder)
                .onSubmit { verify() }
            Button(action: verify) {
                HStack {
                    if auth.isLoading { ProgressView().tint(.white) }
                    Text("Verify")
                }
                .frame(maxWidth: .infinity, minHeight: 42)
            }
            .buttonStyle(.borderedProminent)
            .disabled(auth.isLoading || verificationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button(useRecoveryCode ? "Use authenticator code" : "Use a recovery code") {
                useRecoveryCode.toggle()
                verificationCode = ""
            }
            .font(.callout)
            .disabled(auth.isLoading)
            Button("Back") { auth.cancelSecondFactor() }
                .foregroundStyle(InkwellTheme.secondary)
                .disabled(auth.isLoading)
        }
    }

    private func verify() {
        Task { await auth.verifySecondFactor(code: verificationCode, useRecoveryCode: useRecoveryCode) }
    }
}

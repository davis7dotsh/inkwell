// Entry point: ClerkProvider → ConvexProviderWithClerk → BrowserRouter.
// If the VITE_ env vars aren't configured yet, render a friendly setup
// screen instead of crashing on provider construction.
import { ClerkProvider, useAuth } from "@clerk/react";
import { dark } from "@clerk/themes";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { useTheme } from "./lib/theme";

import "./styles.css";

const env = import.meta.env;
const missing = (
  [
    ["VITE_CLERK_PUBLISHABLE_KEY", env.VITE_CLERK_PUBLISHABLE_KEY],
    ["VITE_CONVEX_URL", env.VITE_CONVEX_URL],
    ["VITE_API_URL", env.VITE_API_URL],
  ] as const
)
  .filter(([, value]) => !value)
  .map(([name]) => name);

const convex =
  missing.length === 0 ? new ConvexReactClient(env.VITE_CONVEX_URL!) : null;

function ConfigNeeded() {
  return (
    <div className="config-needed">
      <div className="config-card">
        <h1>Inkwell needs configuring</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code> in{" "}
          <code>apps/web</code> and fill in:
        </p>
        <ul>
          {missing.map((name) => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
        <p>See PLAN.md §9 for where each value comes from.</p>
      </div>
    </div>
  );
}

function Root() {
  // Clerk's prebuilt components don't follow prefers-color-scheme on their
  // own — hand them the dark base theme when the system is dark.
  const { isDark } = useTheme();
  if (missing.length > 0 || !convex) return <ConfigNeeded />;
  return (
    <ClerkProvider
      publishableKey={env.VITE_CLERK_PUBLISHABLE_KEY!}
      afterSignOutUrl="/"
      appearance={{ baseTheme: isDark ? dark : undefined }}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);

// Route table + auth gating. Convex's Authenticated/Unauthenticated drive
// the gate (Clerk authenticates before Convex validates, so Clerk's own
// isSignedIn is not enough — see PLAN-integration-notes.md).
import { SignIn } from "@clerk/react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import React, { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";

import { BrushStroke } from "./components/BrushStroke";
import { useTheme } from "./lib/theme";

const Library = lazy(() =>
  import("./screens/Library").then((module) => ({ default: module.Library })),
);
const McpSetup = lazy(() =>
  import("./screens/McpSetup").then((module) => ({ default: module.McpSetup })),
);
const Reader = lazy(() =>
  import("./screens/Reader").then((module) => ({ default: module.Reader })),
);

class LazyRouteBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Failed to load an Inkwell screen", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center-state full-height">
        <p>This screen could not be loaded.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload Inkwell
        </button>
      </div>
    );
  }
}

function NotFound() {
  return (
    <div className="center-state full-height">
      <p>Nothing here.</p>
      <Link to="/" className="back-link">
        Back to the library
      </Link>
    </div>
  );
}

export function App() {
  const { c } = useTheme();
  return (
    <>
      <AuthLoading>
        <div className="center-state full-height">
          <span className="pulse-dot" />
        </div>
      </AuthLoading>

      <Unauthenticated>
        <div className="auth-screen">
          <div className="wordmark wordmark-large">
            <h1>Inkwell</h1>
            <BrushStroke
              width={140}
              height={9}
              color={c.wash}
              opacity={0.75}
            />
          </div>
          <SignIn />
        </div>
      </Unauthenticated>

      <Authenticated>
        <LazyRouteBoundary>
          <Suspense
            fallback={
              <div className="center-state full-height">
                <span className="pulse-dot" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Library />} />
              <Route path="/mcp-setup" element={<McpSetup />} />
              <Route path="/read/:id" element={<Reader />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </LazyRouteBoundary>
      </Authenticated>
    </>
  );
}

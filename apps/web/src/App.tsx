// Route table + auth gating. Convex's Authenticated/Unauthenticated drive
// the gate (Clerk authenticates before Convex validates, so Clerk's own
// isSignedIn is not enough — see PLAN-integration-notes.md).
import { SignIn } from "@clerk/react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import React from "react";
import { Link, Route, Routes } from "react-router-dom";

import { BrushStroke } from "./components/BrushStroke";
import { useTheme } from "./lib/theme";
import { Library } from "./screens/Library";
import { McpSetup } from "./screens/McpSetup";
import { Reader } from "./screens/Reader";

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
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/mcp-setup" element={<McpSetup />} />
          <Route path="/read/:id" element={<Reader />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Authenticated>
    </>
  );
}

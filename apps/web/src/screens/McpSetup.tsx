import { APIKeys, UserButton } from "@clerk/react";
import React, { useState } from "react";
import { Link } from "react-router-dom";

import { BackdropWash } from "../components/BackdropWash";
import { BrushStroke } from "../components/BrushStroke";
import { useTheme } from "../lib/theme";

const apiOrigin = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const mcpUrl = `${apiOrigin}/mcp`;

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function CopyableCode({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mcp-code">
      <div className="mcp-code-bar">
        <span>{label}</span>
        <button
          type="button"
          onClick={async () => {
            await copyToClipboard(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mcp-step">
      <div className="mcp-step-heading">
        <span className="mcp-step-number">{number}</span>
        <h2>{title}</h2>
      </div>
      <div className="mcp-step-content">{children}</div>
    </section>
  );
}

export function McpSetup() {
  const { c } = useTheme();
  const shellCommand = `export INKWELL_API_KEY="paste-your-ak-key-here"`;
  const codexConfig = `[mcp_servers.inkwell]
url = "${mcpUrl}"
bearer_token_env_var = "INKWELL_API_KEY"
tool_timeout_sec = 180`;
  const claudeConfig = `{
  "mcpServers": {
    "inkwell": {
      "type": "http",
      "url": "${mcpUrl}",
      "timeout": 180000,
      "headers": {
        "Authorization": "Bearer \${INKWELL_API_KEY}"
      }
    }
  }
}`;

  return (
    <div className="mcp-setup">
      <BackdropWash />
      <header className="mcp-header">
        <Link to="/" className="back-link">
          ← Library
        </Link>
        <UserButton />
      </header>

      <main className="mcp-guide">
        <div className="mcp-intro">
          <p className="mcp-eyebrow">Agent access</p>
          <h1>Connect Inkwell to your AI tools</h1>
          <BrushStroke width={220} height={9} color={c.wash} opacity={0.72} />
          <p>
            Give Codex, Claude Code, or another MCP client access to your
            private library. The connection can save articles, find what you
            have read, and retrieve your notes.
          </p>
        </div>

        <Step number={1} title="Create an API key">
          <p>
            Create a user key for your own Inkwell account. Clerk shows the
            full key once, so copy it when it appears.
          </p>
          <div className="mcp-key-manager">
            <APIKeys />
          </div>
          <p className="mcp-security-note">
            <strong>Keep this key private.</strong> It grants access to your
            saved articles and annotations. Revoke it here at any time.
          </p>
        </Step>

        <Step number={2} title="Choose your client">
          <div className="mcp-client">
            <div>
              <h3>Codex</h3>
              <p>
                Store the key in <code>INKWELL_API_KEY</code>, then add the
                remote server to your Codex configuration. Keep that
                environment variable available when Codex starts.
              </p>
            </div>
            <CopyableCode label="Shell" value={shellCommand} />
            <CopyableCode
              label="~/.codex/config.toml"
              value={codexConfig}
            />
            <p className="mcp-verify">
              Verify with <code>codex mcp list</code>, then open Codex and use{" "}
              <code>/mcp</code>.
            </p>
          </div>

          <div className="mcp-client">
            <div>
              <h3>Claude Code</h3>
              <p>
                Set <code>INKWELL_API_KEY</code> in your environment and add
                this entry to <code>.mcp.json</code>. Use{" "}
                <code>~/.claude.json</code> instead to make it available across
                every project.
              </p>
            </div>
            <CopyableCode label=".mcp.json" value={claudeConfig} />
            <p className="mcp-verify">
              Verify with <code>claude mcp list</code>, then use{" "}
              <code>/mcp</code> inside Claude Code.
            </p>
          </div>

          <details className="mcp-other-client">
            <summary>Another MCP client</summary>
            <p>
              Configure a Streamable HTTP server with the endpoint below. Send
              your key as a bearer token on every request.
            </p>
            <CopyableCode
              label="Connection"
              value={`URL: ${mcpUrl}\nAuthorization: Bearer <your-api-key>`}
            />
          </details>
        </Step>

        <Step number={3} title="Start using Inkwell">
          <p>Once connected, your client will discover these tools:</p>
          <dl className="mcp-tools">
            <div>
              <dt>save_article</dt>
              <dd>Save and process an article or public PDF URL.</dd>
            </div>
            <div>
              <dt>list_articles</dt>
              <dd>Browse your library and filter by reading status.</dd>
            </div>
            <div>
              <dt>get_article</dt>
              <dd>Read an article as Markdown with its source metadata.</dd>
            </div>
            <div>
              <dt>get_notes</dt>
              <dd>Retrieve typed notes, transcripts, and markup counts.</dd>
            </div>
          </dl>
          <div className="mcp-prompt">
            <span>Try asking</span>
            <p>
              “Find the articles I have not read yet and summarize the three
              most recent.”
            </p>
          </div>
        </Step>
      </main>
    </div>
  );
}

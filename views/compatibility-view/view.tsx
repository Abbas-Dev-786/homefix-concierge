import {
  ModelContext,
  ThemeProvider,
  useCallTool,
  useHostContext,
  useOpenExternal,
  useToolContext,
} from "mcp-use/react";

import "./view.css";

export default function CompatibilityView() {
  const view = useToolContext<"compatibility-probe">();
  const probe = useCallTool("compatibility-probe");
  const { hostCapabilities, hostInfo, platform } = useHostContext();
  const openExternal = useOpenExternal();

  if (view.status === "pending") {
    return (
      <ThemeProvider>
        <main className="compatibility-card" data-card-shell>
          <p className="eyebrow">Phase 1 compatibility spike</p>
          <h1>Connecting to the MCP host…</h1>
          <div className="skeleton" aria-label="Loading compatibility results" />
          <p className="muted">Negotiating the Streamable HTTP session and preparing the View.</p>
        </main>
      </ThemeProvider>
    );
  }

  if (view.status === "error") {
    return (
      <ThemeProvider>
        <main className="compatibility-card" data-card-shell>
          <p className="eyebrow">Phase 1 compatibility spike</p>
          <h1>Compatibility check failed</h1>
          <p className="error" role="alert">{view.error.message}</p>
          <button type="button" onClick={() => void probe.callTool({ label: "retry" })}>
            Retry probe
          </button>
        </main>
      </ThemeProvider>
    );
  }

  const result = view.toolOutput;
  const canOpenLinks = hostCapabilities?.openLinks === true;
  const hostLabel = hostInfo ? `${hostInfo.name} ${hostInfo.version}` : "Host not identified";

  return (
    <ThemeProvider>
      <ModelContext content={`Phase 1 compatibility status: ${result.protocolVersion} over ${result.transport}.`} />
      <main className="compatibility-card" data-card-shell>
        <p className="eyebrow">Phase 1 compatibility spike</p>
        <h1>MCP foundation is reachable</h1>
        <p className="lede">
          This temporary View proves the tool result, View bridge, and host capability path before HomeFix workflows are added.
        </p>

        <dl className="checks">
          <div><dt>Transport</dt><dd>{result.transport}</dd></div>
          <div><dt>Negotiated protocol</dt><dd>{result.protocolVersion}</dd></div>
          <div><dt>Bound View</dt><dd>{result.viewBinding}</dd></div>
          <div><dt>Host View support</dt><dd>{result.clientSupportsViews ? "advertised" : "not advertised"}</dd></div>
          <div><dt>OAuth provider</dt><dd>{result.oauth}</dd></div>
          <div><dt>Host</dt><dd>{hostLabel} · {platform}</dd></div>
        </dl>

        <div className="actions">
          <button type="button" disabled={probe.isPending} onClick={() => void probe.callTool({ label: "view button" })}>
            {probe.isPending ? "Checking…" : "Call tool from View"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!canOpenLinks}
            onClick={() => void openExternal({ url: "https://mcp-use.com/docs/typescript/getting-started/quickstart" })}
          >
            Open MCP docs
          </button>
        </div>
        {!canOpenLinks && <p className="muted">This host has not advertised external-link support.</p>}
        {probe.error && <p className="error" role="alert">{probe.error.message}</p>}
      </main>
    </ThemeProvider>
  );
}


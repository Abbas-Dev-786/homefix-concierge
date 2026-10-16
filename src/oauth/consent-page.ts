function serializeForInlineScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderConsentPage(options: {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}): string {
  const configured = Boolean(options.supabaseUrl && options.supabaseAnonKey);
  const supabaseUrl = serializeForInlineScript(options.supabaseUrl ?? "");
  const supabaseAnonKey = serializeForInlineScript(options.supabaseAnonKey ?? "");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HomeFix authorization</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f4ef; color: #25241f; }
      main { width: min(32rem, calc(100% - 2rem)); padding: 2rem; border: 1px solid #dedbd0; border-radius: 1rem; background: #fffdf8; box-shadow: 0 1rem 3rem #2c29170f; }
      h1 { margin-top: 0; font-size: 1.5rem; }
      p { line-height: 1.5; }
      dl { padding: 1rem; border-radius: .75rem; background: #f1efe7; }
      dt { margin-top: .75rem; font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #6d6a5f; }
      dt:first-child { margin-top: 0; }
      dd { margin: .25rem 0 0; overflow-wrap: anywhere; }
      button { margin: 1rem .5rem 0 0; padding: .7rem 1rem; border: 0; border-radius: .6rem; background: #324b3e; color: white; font: inherit; cursor: pointer; }
      button.secondary { background: #e6e3d9; color: #25241f; }
      [hidden] { display: none; }
      .error { color: #9a2d25; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize HomeFix Concierge</h1>
      <p id="status">Loading authorization details…</p>
      <section id="details" hidden>
        <dl>
          <dt>Application</dt><dd id="client-name">Unknown application</dd>
          <dt>Requested access</dt><dd id="requested-scope">Not provided</dd>
        </dl>
        <button id="approve" type="button">Approve access</button>
        <button id="deny" class="secondary" type="button">Deny</button>
      </section>
    </main>
    <script type="module">
      const configured = ${String(configured)};
      const supabaseUrl = ${supabaseUrl};
      const supabaseAnonKey = ${supabaseAnonKey};
      const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");
      const status = document.querySelector("#status");
      const details = document.querySelector("#details");
      const clientName = document.querySelector("#client-name");
      const requestedScope = document.querySelector("#requested-scope");
      const approve = document.querySelector("#approve");
      const deny = document.querySelector("#deny");

      const showError = (message) => {
        status.textContent = message;
        status.className = "error";
      };

      if (!configured || !authorizationId) {
        showError(!configured
          ? "OAuth consent is not configured on this deployment yet."
          : "Missing authorization_id.");
      } else {
        try {
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
          const supabase = createClient(supabaseUrl, supabaseAnonKey);
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session) {
            showError("Sign in to Supabase in this browser, then reopen the authorization link.");
          } else {
            const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
            if (error) throw error;
            clientName.textContent = data?.client?.name ?? "Unknown application";
            requestedScope.textContent = data?.scope ?? "No additional scopes";
            details.hidden = false;

            const finish = async (action) => {
              approve.disabled = true;
              deny.disabled = true;
              status.textContent = action === "approve" ? "Approving…" : "Denying…";
              const result = action === "approve"
                ? await supabase.auth.oauth.approveAuthorization(authorizationId)
                : await supabase.auth.oauth.denyAuthorization(authorizationId);
              if (result.error) throw result.error;
              window.location.assign(result.data.redirect_url);
            };
            approve.addEventListener("click", () => finish("approve").catch((error) => showError(error.message)));
            deny.addEventListener("click", () => finish("deny").catch((error) => showError(error.message)));
            status.textContent = "Review the requested access before continuing.";
          }
        } catch (error) {
          showError(error instanceof Error ? error.message : "Unable to load authorization details.");
        }
      }
    </script>
  </body>
</html>`;
}

export function consentPageError(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>HomeFix authorization</title></head><body><main><h1>HomeFix authorization</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}


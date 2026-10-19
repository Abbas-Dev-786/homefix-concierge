import { useEffect, useMemo, useState } from "react";
import {
  ModelContext,
  ThemeProvider,
  useCallTool,
  useHostContext,
  useOpenExternal,
  useToolContext,
} from "mcp-use/react";

import "./view.css";

type ProfileDraft = {
  propertyType: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  currencyCode: string;
  preferredServiceWindows: string;
  typicalBudgetAmount: string;
  homeSummary: string;
};

type RepairDraft = {
  title: string;
  description: string;
  serviceCategory: string;
  room: string;
  urgency: "routine" | "soon" | "urgent";
  desiredDate: string;
  desiredTimeWindow: string;
  budgetMax: string;
  currencyCode: string;
};

const emptyProfile: ProfileDraft = {
  propertyType: "",
  city: "",
  region: "",
  postalCode: "",
  countryCode: "US",
  currencyCode: "USD",
  preferredServiceWindows: "",
  typicalBudgetAmount: "",
  homeSummary: "",
};

const emptyRepair: RepairDraft = {
  title: "",
  description: "",
  serviceCategory: "",
  room: "",
  urgency: "soon",
  desiredDate: "",
  desiredTimeWindow: "",
  budgetMax: "",
  currencyCode: "USD",
};

function asString(value: string | null | undefined) {
  return value ?? "";
}

function profileDraftFrom(value: {
  propertyType: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  currencyCode: string | null;
  preferredServiceWindows: unknown[];
  typicalBudgetAmount: number | null;
  homeSummary: string | null;
} | null): ProfileDraft {
  if (!value) return emptyProfile;
  return {
    propertyType: asString(value.propertyType),
    city: asString(value.city),
    region: asString(value.region),
    postalCode: asString(value.postalCode),
    countryCode: asString(value.countryCode) || "US",
    currencyCode: asString(value.currencyCode) || "USD",
    preferredServiceWindows: value.preferredServiceWindows.filter((item): item is string => typeof item === "string").join(", "),
    typicalBudgetAmount: value.typicalBudgetAmount === null ? "" : String(value.typicalBudgetAmount),
    homeSummary: asString(value.homeSummary),
  };
}

function toOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatDate(value: string | null) {
  if (!value) return "No date selected";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

function ErrorNote({ message }: { message: string | undefined }) {
  return message ? <p className="notice error" role="alert">{message}</p> : null;
}

function SourcePill({ children }: { children: string }) {
  return <span className="source-pill">{children}</span>;
}

export default function HomeFixDashboard() {
  const view = useToolContext<"open_homefix_dashboard">();
  const refreshDashboard = useCallTool("open_homefix_dashboard");
  const createHousehold = useCallTool("create_household");
  const saveProfile = useCallTool("save_home_profile");
  const createRepair = useCallTool("create_repair_request");
  const findOptions = useCallTool("find_service_options");
  const compareOptions = useCallTool("compare_service_options");
  const createHandoff = useCallTool("create_booking_handoff");
  const recordOpened = useCallTool("record_handoff_opened");
  const recordOutcome = useCallTool("record_booking_outcome");
  const listRequests = useCallTool("list_maintenance_requests");
  const getActivity = useCallTool("get_activity");
  const { hostCapabilities, platform } = useHostContext();
  const openExternal = useOpenExternal();

  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfile);
  const [profileDirty, setProfileDirty] = useState(false);
  const [repairDraft, setRepairDraft] = useState<RepairDraft>(emptyRepair);
  const [activeRequestId, setActiveRequestId] = useState("");
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [handoff, setHandoff] = useState<{ id: string; url: string; status: string } | null>(null);
  const [handoffOpened, setHandoffOpened] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState("");
  const [formMessage, setFormMessage] = useState("");

  const dashboard = view.status === "ready"
    ? refreshDashboard.data?.structuredContent ?? view.toolOutput
    : undefined;
  const profile = dashboard?.profile;
  const requests = dashboard?.openRequests ?? [];
  const optionsResult = findOptions.data?.structuredContent;
  const optionRows = optionsResult?.options ?? [];
  const comparisonRows = compareOptions.data?.structuredContent?.options ?? [];
  const historyRows = listRequests.data?.structuredContent?.requests ?? [];
  const activityRows = getActivity.data?.structuredContent?.events ?? [];
  const selectedRequest = requests.find((request) => request.id === activeRequestId) ?? requests[0];
  const canOpenLinks = hostCapabilities?.openLinks === true;

  useEffect(() => {
    if (dashboard?.profile && !profileDirty) setProfileDraft(profileDraftFrom(dashboard.profile));
  }, [dashboard?.profile?.id, profileDirty]);

  useEffect(() => {
    if (view.status === "ready" && getActivity.data === undefined && !getActivity.isPending) {
      void getActivity.callTool({ limit: 20 }).catch(() => undefined);
    }
  }, [view.status]);

  useEffect(() => {
    if (createRepair.data?.structuredContent?.id) {
      setActiveRequestId(createRepair.data.structuredContent.id);
      setRepairDraft(emptyRepair);
    }
  }, [createRepair.data]);

  const locationReady = Boolean(profile?.postalCode || (profile?.city && profile?.region));
  const dashboardState = dashboard?.onboardingRequired ? "onboarding" : dashboard ? "ready" : "loading";
  const statusLabel = useMemo(() => {
    if (!dashboard) return "Loading your household";
    if (dashboard.taskrabbit.status === "available") return "Taskrabbit live";
    return dashboard.taskrabbit.status === "error" ? "Taskrabbit needs attention" : "Taskrabbit unavailable";
  }, [dashboard]);

  async function handleCreateHousehold() {
    setFormMessage("");
    try {
      await createHousehold.callTool({});
      await refreshDashboard.callTool({});
      setFormMessage("Household created. Add your home context to make provider searches faster.");
    } catch {
      // The hook exposes the actionable error below.
    }
  }

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage("");
    const preferredServiceWindows = profileDraft.preferredServiceWindows
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const payload = {
      ...(profileDraft.propertyType ? { propertyType: profileDraft.propertyType } : {}),
      ...(profileDraft.city ? { city: profileDraft.city } : {}),
      ...(profileDraft.region ? { region: profileDraft.region } : {}),
      ...(profileDraft.postalCode ? { postalCode: profileDraft.postalCode } : {}),
      ...(profileDraft.countryCode ? { countryCode: profileDraft.countryCode.toUpperCase() } : {}),
      ...(profileDraft.currencyCode ? { currencyCode: profileDraft.currencyCode.toUpperCase() } : {}),
      ...(preferredServiceWindows.length ? { preferredServiceWindows } : {}),
      ...(toOptionalNumber(profileDraft.typicalBudgetAmount) !== undefined ? { typicalBudgetAmount: toOptionalNumber(profileDraft.typicalBudgetAmount) } : {}),
      ...(profileDraft.homeSummary ? { homeSummary: profileDraft.homeSummary } : {}),
    };
    try {
      await saveProfile.callTool(payload);
      setProfileDirty(false);
      await refreshDashboard.callTool({});
      setFormMessage("Home context saved.");
    } catch {
      // The hook exposes the actionable error below.
    }
  }

  async function handleCreateRepair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage("");
    try {
      await createRepair.callTool({
        title: repairDraft.title,
        description: repairDraft.description,
        ...(repairDraft.serviceCategory ? { serviceCategory: repairDraft.serviceCategory } : {}),
        ...(repairDraft.room ? { room: repairDraft.room } : {}),
        urgency: repairDraft.urgency,
        ...(repairDraft.desiredDate ? { desiredDate: repairDraft.desiredDate } : {}),
        ...(repairDraft.desiredTimeWindow ? { desiredTimeWindow: repairDraft.desiredTimeWindow } : {}),
        ...(toOptionalNumber(repairDraft.budgetMax) !== undefined ? { budgetMax: toOptionalNumber(repairDraft.budgetMax) } : {}),
        ...(repairDraft.currencyCode ? { currencyCode: repairDraft.currencyCode.toUpperCase() } : {}),
        idempotencyKey: `view-${crypto.randomUUID()}`,
      });
      await refreshDashboard.callTool({});
      setFormMessage("Repair saved. Select it below to request live provider options.");
    } catch {
      // The hook exposes the actionable error below.
    }
  }

  async function handleFindOptions() {
    if (!selectedRequest) return;
    setSelectedOptionId("");
    setHandoff(null);
    setHandoffOpened(false);
    setHandoffMessage("");
    try {
      await findOptions.callTool({
        requestId: selectedRequest.id,
        serviceCategory: selectedRequest.serviceCategory || repairDraft.serviceCategory || "home maintenance",
        ...(profile?.city ? { city: profile.city } : {}),
        ...(profile?.region ? { region: profile.region } : {}),
        ...(profile?.postalCode ? { postalCode: profile.postalCode } : {}),
        ...(selectedRequest.desiredDate ? { desiredDate: selectedRequest.desiredDate } : {}),
        ...(selectedRequest.desiredTimeWindow ? { desiredTimeWindow: selectedRequest.desiredTimeWindow } : {}),
        scopingAnswers: {
          issue: selectedRequest.description,
          urgency: selectedRequest.urgency,
        },
      });
    } catch {
      // The hook exposes the actionable error below.
    }
  }

  async function handleCompare() {
    if (!selectedRequest || optionRows.length < 1) return;
    try {
      await compareOptions.callTool({ requestId: selectedRequest.id, optionIds: optionRows.map((option) => option.id) });
    } catch {
      // The hook exposes the actionable error below.
    }
  }

  async function handlePrepareHandoff() {
    if (!selectedRequest || !selectedOptionId) return;
    try {
      const result = await createHandoff.callTool({
        requestId: selectedRequest.id,
        serviceOptionId: selectedOptionId,
        idempotencyKey: `view-handoff-${selectedRequest.id}-${selectedOptionId}`,
      });
      const data = result.structuredContent;
      setHandoff({ id: data.id, url: data.bookingUrl, status: data.status });
      setHandoffOpened(false);
      setHandoffMessage("Ready for your review. HomeFix has not opened the external page or marked this repair as booked.");
    } catch {
      // The hook exposes the actionable error below.
    }
  }

  async function handleOpenHandoff() {
    if (!handoff || !canOpenLinks) return;
    setHandoffMessage("Requesting the host to open Taskrabbit…");
    try {
      await openExternal({ url: handoff.url });
      await recordOpened.callTool({ handoffId: handoff.id, idempotencyKey: `view-open-${handoff.id}` });
      setHandoffOpened(true);
      setHandoffMessage("The host accepted the external-link request. Booking is still not confirmed; report the outcome after reviewing Taskrabbit.");
    } catch {
      setHandoffMessage("The host did not open Taskrabbit, so HomeFix did not mark the handoff as opened.");
    }
  }

  async function handleOutcome(outcome: "booked" | "not_booked" | "cancelled" | "needs_help") {
    if (!handoff) return;
    try {
      await recordOutcome.callTool({ handoffId: handoff.id, outcome });
      setHandoffMessage("Your reported outcome was saved to HomeFix.");
      await refreshDashboard.callTool({});
      await getActivity.callTool({ limit: 20 });
    } catch {
      // The hook exposes the actionable error below.
    }
  }

  function renderPending(label: string) {
    return <span className="pending-label" aria-live="polite">{label}…</span>;
  }

  if (view.status === "pending") {
    return <ThemeProvider><main className="app-shell loading-shell"><div className="brand-mark">H</div><p className="eyebrow">HomeFix Concierge</p><h1>Loading your home dashboard</h1><div className="loading-bar" aria-label="Loading dashboard" /><p className="muted">Checking your authenticated household and live provider status.</p></main></ThemeProvider>;
  }

  if (view.status === "error") {
    return <ThemeProvider><main className="app-shell"><div className="brand-mark">H</div><p className="eyebrow">HomeFix Concierge</p><h1>We couldn’t load HomeFix</h1><p className="notice error" role="alert">{view.error.message}</p><button type="button" onClick={() => void refreshDashboard.callTool({})} disabled={refreshDashboard.isPending}>{refreshDashboard.isPending ? "Retrying…" : "Retry dashboard"}</button></main></ThemeProvider>;
  }

  if (dashboardState === "loading") {
    return <ThemeProvider><main className="app-shell loading-shell"><div className="brand-mark">H</div><p className="eyebrow">HomeFix Concierge</p><h1>Preparing your dashboard</h1><div className="loading-bar" /><p className="muted">Waiting for the authenticated HomeFix result.</p></main></ThemeProvider>;
  }

  if (dashboardState === "onboarding") {
    return <ThemeProvider><ModelContext content="HomeFix onboarding is required. The user must explicitly create a household before saving profile or repair data." /><main className="app-shell onboarding-shell"><header className="topbar"><div className="brand"><div className="brand-mark">H</div><div><p className="eyebrow">HomeFix Concierge</p><h1>Start with your home</h1></div></div><SourcePill>Authenticated workspace</SourcePill></header><section className="hero-panel"><p className="hero-kicker">A calmer way to manage repairs</p><h2>Keep the details once, reuse them everywhere.</h2><p>HomeFix stores your household context and repair requests securely so live Taskrabbit searches can use the information you already provided.</p><button type="button" onClick={() => void handleCreateHousehold()} disabled={createHousehold.isPending}>{createHousehold.isPending ? "Creating household…" : "Create my household"}</button><ErrorNote message={createHousehold.error?.message} />{formMessage && <p className="notice success">{formMessage}</p>}</section></main></ThemeProvider>;
  }

  if (!dashboard) {
    return <ThemeProvider><main className="app-shell loading-shell"><div className="brand-mark">H</div><p className="eyebrow">HomeFix Concierge</p><h1>Preparing your dashboard</h1><p className="muted">The authenticated dashboard result is not available yet.</p></main></ThemeProvider>;
  }

  return <ThemeProvider><ModelContext content={`HomeFix dashboard for ${dashboard.household?.displayName ?? "your household"}. ${requests.length} open repair(s). ${statusLabel}. Provider results are live and user-approved handoffs are not bookings.`} /><main className="app-shell" data-platform={platform}>
    <header className="topbar">
      <div className="brand"><div className="brand-mark">H</div><div><p className="eyebrow">HomeFix Concierge</p><h1>Good to see you, {dashboard.household?.displayName ?? "homeowner"}</h1></div></div>
      <div className="topbar-actions"><SourcePill>{statusLabel}</SourcePill><button className="icon-button" type="button" onClick={() => void refreshDashboard.callTool({})} disabled={refreshDashboard.isPending} aria-label="Refresh dashboard">↻</button></div>
    </header>

    <section className="summary-grid" aria-label="Home summary">
      <article className="summary-card accent"><p className="card-label">Open repairs</p><strong>{requests.length}</strong><span>{requests.length ? "Ready for your next decision" : "Your home is caught up"}</span></article>
      <article className="summary-card"><p className="card-label">Home base</p><strong>{profile?.city || profile?.postalCode || "Not set"}</strong><span>{profile?.propertyType || "Add your property type"}</span></article>
      <article className="summary-card"><p className="card-label">Provider connection</p><strong>{dashboard.taskrabbit.status === "available" ? "Live" : "Unavailable"}</strong><span>Taskrabbit · <SourcePill>live</SourcePill></span></article>
    </section>

    <div className="dashboard-grid">
      <div className="main-column">
        <section className="panel intake-panel"><div className="panel-heading"><div><p className="eyebrow">Repair intake</p><h2>What needs attention?</h2></div><span className="step-badge">Save once · search faster</span></div><form onSubmit={handleCreateRepair} className="form-grid">
          <label className="wide">Title<input required maxLength={120} value={repairDraft.title} onChange={(event) => setRepairDraft({ ...repairDraft, title: event.target.value })} placeholder="e.g. Leaking kitchen tap" /></label>
          <label className="wide">What’s happening?<textarea required maxLength={1500} value={repairDraft.description} onChange={(event) => setRepairDraft({ ...repairDraft, description: event.target.value })} placeholder="Describe the issue, what you’ve noticed, and anything a Tasker should know." rows={4} /></label>
          <label>Service category<input maxLength={120} value={repairDraft.serviceCategory} onChange={(event) => setRepairDraft({ ...repairDraft, serviceCategory: event.target.value })} placeholder="Plumbing" /></label>
          <label>Room<input maxLength={120} value={repairDraft.room} onChange={(event) => setRepairDraft({ ...repairDraft, room: event.target.value })} placeholder="Kitchen" /></label>
          <label>Urgency<select value={repairDraft.urgency} onChange={(event) => setRepairDraft({ ...repairDraft, urgency: event.target.value as RepairDraft["urgency"] })}><option value="routine">Routine</option><option value="soon">Soon</option><option value="urgent">Urgent</option></select></label>
          <label>Preferred date<input type="date" value={repairDraft.desiredDate} onChange={(event) => setRepairDraft({ ...repairDraft, desiredDate: event.target.value })} /></label>
          <label>Time window<input maxLength={120} value={repairDraft.desiredTimeWindow} onChange={(event) => setRepairDraft({ ...repairDraft, desiredTimeWindow: event.target.value })} placeholder="11:30 AM–12:30 PM" /></label>
          <label>Budget maximum<input type="number" min="0" step="0.01" value={repairDraft.budgetMax} onChange={(event) => setRepairDraft({ ...repairDraft, budgetMax: event.target.value })} placeholder="Optional" /></label>
          <div className="form-actions wide"><button type="submit" disabled={createRepair.isPending}>{createRepair.isPending ? "Saving repair…" : "Save repair request"}</button><span className="muted">No provider call happens until you request options.</span></div>
        </form><ErrorNote message={createRepair.error?.message} />{formMessage && <p className="notice success">{formMessage}</p>}</section>

        <section className="panel repairs-panel"><div className="panel-heading"><div><p className="eyebrow">Your repairs</p><h2>Open requests</h2></div><button className="text-button" type="button" onClick={() => { setHistoryOpen(!historyOpen); if (!historyOpen && !listRequests.data) void listRequests.callTool({ openOnly: false }); }}>{historyOpen ? "Hide history" : "View history"}</button></div>{requests.length === 0 ? <div className="empty-state"><span className="empty-icon">⌂</span><h3>No open repairs yet</h3><p>Create a repair request above. HomeFix will keep it here until you report an outcome.</p></div> : <div className="repair-list">{requests.map((request) => <button type="button" className={`repair-row ${selectedRequest?.id === request.id ? "selected" : ""}`} key={request.id} onClick={() => { setActiveRequestId(request.id); setSelectedOptionId(""); setHandoff(null); }}><span className={`status-dot ${request.urgency}`} /><span className="repair-copy"><strong>{request.title}</strong><span>{request.room || request.serviceCategory || "Home repair"} · {request.status.replaceAll("_", " ")}</span></span><span className="repair-date">{formatDate(request.desiredDate)}</span><span aria-hidden="true">›</span></button>)}</div>}{historyOpen && <div className="history-list"><div className="subheading">All saved requests</div>{listRequests.isPending ? <p className="muted">Loading history…</p> : historyRows.length === 0 ? <p className="muted">No historical requests are available.</p> : historyRows.map((request) => <div className="history-row" key={request.id}><span>{request.title}</span><span>{request.status.replaceAll("_", " ")}</span><span>{formatDate(request.updatedAt.slice(0, 10))}</span></div>)}<ErrorNote message={listRequests.error?.message} /></div>}</section>

        {selectedRequest && <section className="panel provider-panel"><div className="panel-heading"><div><p className="eyebrow">Live provider search</p><h2>Find help for “{selectedRequest.title}”</h2><p className="muted">Only the selected repair, requested timing, and saved location are shared with Taskrabbit.</p></div><SourcePill>live Taskrabbit</SourcePill></div>{!locationReady ? <div className="notice warning">Add a city and region or postal code in Home context before searching providers.</div> : <div className="provider-action"><div><strong>{profile?.city && profile?.region ? `${profile.city}, ${profile.region}` : profile?.postalCode}</strong><span>{selectedRequest.desiredDate ? `${formatDate(selectedRequest.desiredDate)}${selectedRequest.desiredTimeWindow ? ` · ${selectedRequest.desiredTimeWindow}` : ""}` : "Flexible timing"}</span></div><button type="button" onClick={() => void handleFindOptions()} disabled={findOptions.isPending || dashboard.taskrabbit.status !== "available"}>{findOptions.isPending ? "Checking live options…" : "Find live options"}</button></div>}{dashboard.taskrabbit.status !== "available" && <p className="notice error">{dashboard.taskrabbit.reason || "Taskrabbit is unavailable. Try again later."}</p>}<ErrorNote message={findOptions.error?.message} />{optionsResult && <div className="options-area"><div className="options-heading"><div><h3>{optionRows.length ? `${optionRows.length} live option${optionRows.length === 1 ? "" : "s"}` : "No matching options"}</h3><p className="muted">Retrieved {new Date(optionsResult.retrievedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · expires {new Date(optionsResult.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p></div>{optionRows.length > 0 && <button className="secondary-button" type="button" onClick={() => void handleCompare()} disabled={compareOptions.isPending}>{compareOptions.isPending ? "Comparing…" : "Compare"}</button>}</div>{optionRows.length === 0 ? <div className="empty-state compact"><h3>Taskrabbit returned no matching options</h3><p>Adjust the repair details or timing and run another live search.</p></div> : <div className="option-list">{optionRows.map((option) => <button type="button" className={`option-card ${selectedOptionId === option.id ? "selected" : ""}`} key={option.id} onClick={() => setSelectedOptionId(option.id)}><span className="option-select" aria-hidden="true">{selectedOptionId === option.id ? "✓" : ""}</span><span className="option-copy"><strong>{option.title}</strong><span>{option.availabilitySummary || "Availability returned by provider"}</span><span>{option.locationLabel || "Location supplied"}</span></span><span className="option-price">{option.priceLabel || (option.estimateMax !== null ? `${option.currencyCode || ""} ${option.estimateMax}` : "Price unknown")}</span></button>)}</div>}{comparisonRows.length > 0 && <div className="comparison"><div className="subheading">Deterministic comparison</div>{comparisonRows.map((option) => <div className="comparison-row" key={option.id}><span>{option.title}</span><span>{option.reasonCodes.join(" · ")}</span></div>)}</div>}{selectedOptionId && <div className="handoff-box"><div><strong>Selected option</strong><span>Prepare a validated Taskrabbit handoff with the saved repair details.</span></div><button type="button" onClick={() => void handlePrepareHandoff()} disabled={createHandoff.isPending}>{createHandoff.isPending ? "Preparing link…" : "Prepare Taskrabbit link"}</button></div>}{createHandoff.error && <ErrorNote message={createHandoff.error.message} />}{handoff && <div className="handoff-ready"><div><p className="eyebrow">Ready for your approval</p><h3>Continue on Taskrabbit</h3><p>{handoffMessage}</p></div><button type="button" onClick={() => void handleOpenHandoff()} disabled={!canOpenLinks || recordOpened.isPending}>{recordOpened.isPending ? "Recording…" : canOpenLinks ? "Continue to Taskrabbit" : "Host link support unavailable"}</button><div className="outcome-actions"><span className="muted">{handoffOpened ? "After reviewing the page:" : "Open Taskrabbit before reporting an outcome."}</span><button className="quiet-button" type="button" onClick={() => void handleOutcome("booked")} disabled={recordOutcome.isPending || !handoffOpened}>I booked it</button><button className="quiet-button" type="button" onClick={() => void handleOutcome("not_booked")} disabled={recordOutcome.isPending || !handoffOpened}>Not booked</button><button className="quiet-button" type="button" onClick={() => void handleOutcome("needs_help")} disabled={recordOutcome.isPending || !handoffOpened}>Need help</button></div><ErrorNote message={recordOutcome.error?.message} /></div>}{handoffMessage && !handoff && <p className="notice">{handoffMessage}</p>}</div>}</section>}
      </div>

      <aside className="side-column">
        <section className="panel context-panel"><div className="panel-heading"><div><p className="eyebrow">Home context</p><h2>Saved once</h2></div><span className="context-icon">⌂</span></div><p className="muted">Keep your location and preferences ready for the next repair search.</p><form onSubmit={handleSaveProfile} className="context-form"><label>Property type<input value={profileDraft.propertyType} onChange={(event) => { setProfileDirty(true); setProfileDraft({ ...profileDraft, propertyType: event.target.value }); }} placeholder="House, apartment…" /></label><div className="two-up"><label>City<input value={profileDraft.city} onChange={(event) => { setProfileDirty(true); setProfileDraft({ ...profileDraft, city: event.target.value }); }} placeholder="New York" /></label><label>Region<input value={profileDraft.region} onChange={(event) => { setProfileDirty(true); setProfileDraft({ ...profileDraft, region: event.target.value }); }} placeholder="NY" /></label></div><label>Postal code<input value={profileDraft.postalCode} onChange={(event) => { setProfileDirty(true); setProfileDraft({ ...profileDraft, postalCode: event.target.value }); }} placeholder="10001" /></label><div className="two-up"><label>Currency<input maxLength={3} value={profileDraft.currencyCode} onChange={(event) => { setProfileDirty(true); setProfileDraft({ ...profileDraft, currencyCode: event.target.value }); }} /></label><label>Typical budget<input type="number" min="0" step="0.01" value={profileDraft.typicalBudgetAmount} onChange={(event) => { setProfileDirty(true); setProfileDraft({ ...profileDraft, typicalBudgetAmount: event.target.value }); }} placeholder="Optional" /></label></div><label>Preferred windows<input value={profileDraft.preferredServiceWindows} onChange={(event) => { setProfileDirty(true); setProfileDraft({ ...profileDraft, preferredServiceWindows: event.target.value }); }} placeholder="Weekday evenings, Saturday morning" /></label><label>Home notes<textarea maxLength={1000} value={profileDraft.homeSummary} onChange={(event) => { setProfileDirty(true); setProfileDraft({ ...profileDraft, homeSummary: event.target.value }); }} placeholder="Useful non-sensitive context" rows={3} /></label><button className="secondary-button full" type="submit" disabled={saveProfile.isPending}>{saveProfile.isPending ? "Saving…" : profile ? "Save home context" : "Add home context"}</button></form><ErrorNote message={saveProfile.error?.message} /></section>
        <section className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Activity</p><h2>What happened</h2></div><button className="text-button" type="button" onClick={() => { setActivityOpen(!activityOpen); if (!activityOpen) void getActivity.callTool({ limit: 20 }); }}>{activityOpen ? "Hide" : "Refresh"}</button></div>{activityRows.length === 0 ? <p className="muted">No activity has been recorded yet. Actions you take in HomeFix will appear here.</p> : <div className={`timeline ${activityOpen ? "expanded" : ""}`}>{activityRows.slice(0, activityOpen ? 20 : 5).map((event) => <div className="timeline-row" key={event.id}><span className="timeline-dot" /><div><strong>{event.eventType.replaceAll("_", " ")}</strong><span>{new Date(event.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span></div></div>)}</div>}{getActivity.error && <ErrorNote message={getActivity.error.message} />}</section>
        <section className="trust-note"><span>✓</span><div><strong>Private by design</strong><p>HomeFix uses your verified household. Credentials, access codes, payment details, and unrelated home data are never sent to Taskrabbit.</p></div></section>
      </aside>
    </div>
  </main></ThemeProvider>;
}

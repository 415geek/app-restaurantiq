# RestaurantIQ Product Module Overview (English)

> Last updated: 2026-03-28 (America/Los_Angeles)
> Maintenance policy: update this file on every feature change and keep it aligned with the Chinese version.

## 1. Marketing Site
- Route: `/`
- Purpose: value proposition, feature highlights, pricing, FAQ, demo booking, conversion entry points.
- Key capabilities: bilingual switch, CTA flows (sign up / sign in), marketing lead form APIs.

## 2. Dashboard
- Route: `/dashboard`
- Purpose: core operating KPIs, health overview, prioritized recommendations, execution log summary.
- Data policy: prefer real parsed/integrated data; fallback data is explicitly labeled when used.

## 3. Analysis Center
- Route: `/analysis`
- Purpose: search businesses by address, run multi-source analysis, produce structured reports and executable actions.
- Key capabilities:
  - file upload as an early-stage data source before full POS/delivery integrations;
  - uploaded documents are collapsed by default and expanded on demand to reduce UI clutter;
  - multi-agent fusion (ops + social + macro);
  - execution preview, status transitions, and rollback window.
  - added an Ops Data Analysis panel to surface parsing/cleaning summary, insights, and executable actions from uploaded files;
  - added Google Places autocomplete + dual Analyze/Compare business entry flow;
  - expanded output with deep review themes, consumer profile, competitor splits, platform intel, and prioritized gap list.

## 4. Order Center
- Route: `/delivery`
- Goal: focus on live order intake and fulfillment only (no authorization entry here).
- First-view logic:
  - platform connection cards are removed from this page;
  - when no channel is connected, users are directed to `Settings → Integrations`;
  - after authorization, users are redirected back to Order Center automatically.
- Current capabilities:
  - order cockpit (Otter/StreamOrder-style): status filters, order list, detail, and fulfillment actions in one surface;
  - fulfillment board (new -> accepted -> preparing -> ready -> completed);
  - order query module (filter by platform/date/customer name/keyword);
  - click-through order detail view with full API-returned order fields;
  - automation policy controls (auto-accept cap, queue threshold, prep buffer, etc.);
  - Uber Eats webhook event audit panel.
- UX strategy: keeps high-frequency interaction patterns from Deliverect / Otter / StreamOrder to reduce switching cost.

## 5. Menu Management
- Route: `/menu-management`
- Purpose:
  - unified menu search, filtering, channel pricing, and listing controls;
  - publish menu changes to connected channels from one place;
  - mobile card-first editing + desktop dense table editing;
  - added **Store Ops** workspace:
    - regular weekly hours (`service_availability`);
    - holiday-hour overrides (`holidayhours`);
    - online/paused store status (`status`);
    - prep offset/default prep controls (`pos_data`);
    - promotion drafts (kept local with warning when Promotions endpoint is not configured);
    - full loop actions: Pull from Uber / Save local / Push to Uber.

## 6. Social Radar
- Route: `/social-radar`
- Purpose: social metrics dashboard, latest review handling, AI reply + recall window, external mention monitoring.

## 7. Settings
- Route: `/settings`
- Purpose:
  - restaurant profile;
  - agent toggles and refresh strategy;
  - execution policy and model routing;
  - integration status checks and connection tests;
  - single authorization entry for delivery platforms in Integrations (authorize/disconnect per platform, redirecting back to Order Center).

## 8. Account
- Route: `/account`
- Purpose: user/org profile, subscription status, team members, API configuration notices.

## 9. Agent Management (Internal)
- Route: `/agent-management` (via `agenttune.restaurantiq.ai`)
- Purpose: internal visual agent orchestration and tuning (model, prompt, parameters, graph edges).
- Access policy: internal domain + allowlisted identity access.

## 10. Conversational Ops Execution
- Route: `/ops-copilot`
- Goal: turn chat-style operations requests into controlled execution workflows.
- Current capabilities:
  - bilingual natural-language command parsing with structured execution preview;
  - state machine flow:
    `draft -> parsed -> awaiting_confirmation -> awaiting_approval -> scheduled -> executing -> synced/partially_failed -> completed/rolled_back`;
  - high-risk approval gating, scheduled effective time, optional auto-restore time;
  - platform-by-platform sync result visibility (success/failure split);
  - UberEats-first execution adapter (real write-back endpoint configurable);
  - compensation retry queue (attempt count + next retry visibility);
  - full audit trail (who triggered, who approved, how status changed).
- Product principle: ship safe execution controls first, then expand automation depth.

## 11. Auth & Access Control
- Sign in / sign up: Clerk (`/sign-in`, `/sign-up`)
- Protected areas: analysis, settings, account, order center, menu management, agent management, etc.

## 12. API & Integration Layer
- Core endpoints:
  - `/api/analysis`, `/api/execute`
  - `/api/ops/commands`, `/api/ops/commands/[commandId]`
  - `/api/delivery/management`
  - `/api/delivery/orders`, `/api/delivery/orders/[orderId]`
  - `/api/integrations/*` (UberEats / Meta / Google Business / Yelp / Maps / Weather)
  - `/api/webhooks/ubereats`
- Security rule: sensitive keys are server-only env vars; never exposed in frontend bundles.

## Added in this update (2026-03-08)
- Uber Store Ops control loop (inside Menu Management):
  - added a Store Ops visual panel covering hours, holiday overrides, online status, prep parameters, and promotion drafts;
  - added `GET/PATCH /api/delivery/store-ops`;
  - added `integration_enabled` warning detection to surface integrator-binding issues early;
  - push report and sync warnings are now shown in-page for operator verification.
- New-order alert and action loop hardening:
  - Added a global “new order” modal (outside Agent Studio host), so incoming orders surface on any authenticated backend page.
  - Modal now supports one-tap fulfillment actions:
    `Accept / Start Prep / Mark Ready / Complete / Cancel`.
  - Added order action endpoint:
    `POST /api/delivery/orders/[orderId]/actions`, with Uber action write-back when action endpoint is configured.
  - If Uber action endpoint is not configured, API returns a warning and still updates local order state (non-blocking fallback).
- Uber order visibility hardening (anti-missed-orders):
  - Added webhook order normalization layer to convert Uber webhook payloads into a unified order shape.
  - `Delivery Management` now merges three order sources:

## Added in this update (2026-03-11)
- Analysis Center business-entry and deep-intel upgrade:
  - added `POST /api/analysis/address-autocomplete`;
  - added `compareMode` to `POST /api/analysis` for Analyze vs Compare mode;
  - expanded business intel response with `reviewDeepDive / consumerProfile / competition / platformIntel / comparison`.
- Analysis entry UX rollback (as requested):
  - restored the entry flow to: address input -> search businesses -> choose business-name candidate -> Analyze/Compare;
  - keeps the new analysis and comparison backend logic unchanged, only reverts the input interaction pattern.
- Ops upload section now includes an “Ops Data Analysis” panel:
  - surfaces Agent A parsing/cleaning signals, data health, top priorities, and execution suggestions;
  - keeps uploaded file list collapsed by default to reduce UI noise.
- Nova Act adapter scaffold:
  - added `lib/server/adapters/nova-act-market-scan.ts`;
  - supports env-driven live mode with deterministic fallback output.
    - persisted local state
    - webhook-normalized orders
    - live order query results (when live endpoint is configured)
  - This ensures order boards still show new orders even when webhook delivery is delayed.
- Environment template updates:
  - `UBEREATS_ORDER_ACTION_ENDPOINT_TEMPLATE`
  - `UBEREATS_ORDER_ACTION_METHOD`

## Previous update (2026-03-06)
- Copilot stability fix:
  - resolved the persistent “command queue flicker / repeated refresh” issue in Ops Copilot;
  - stabilized `useToast` references to prevent effect loops and repeated API reloads.
- Analysis upload interaction update:
  - uploaded documents are collapsed by default;
  - users can expand only when needed, reducing page noise.
- Delivery onboarding flow refactor:
  - first view now only renders platform connection cards;
  - platform card actions are unified to authorize/disconnect;
  - management workspace stays hidden until at least one platform is connected.
- Delivery workspace redesign (Deliverect/Otter/StreamOrder migration-friendly):
  - added left-side workspace navigation (orders/menu/query/automation/event stream);
  - rebuilt orders as a 3-panel cockpit (status/list, detail, fulfillment actions);
  - rebuilt menu operations as a toolbar + dense table pattern for high-frequency edits;
  - added mobile-specific layout patterns:
    - horizontally scrollable workspace tabs;
    - mobile card flows for orders/menu/query;
    - connected-channel-only menu filter toggle;
  - objective: reduce relearning cost for teams switching from those platforms.
- Delivery callable-action visibility upgrade:
  - high-frequency callable buttons are now always exposed in one Command Center instead of being scattered across sub-panels;
  - fulfillment pad can directly execute `Accept / Start Prep / Mark Ready / Complete / Cancel` against the selected order;
  - channel intake controls support direct per-platform `Pause / Resume` actions.
- Mobile layout fixes (Dashboard/Analysis):
  - top navigation now compresses the Run Analysis action into an icon-first button on small screens to avoid crowding after language switch;
  - `Analysis` upload actions now stack vertically on mobile, fixing vertical text clipping and card overflow;
  - `PageHeader` action area now wraps responsively on small screens instead of squeezing title/content;
  - Dashboard daily briefing text adds word-break protection to prevent long English lines from causing horizontal overflow.
- Delivery Management upgraded into a full workflow console:
  - onboarding workflow and subscription/auth/sync progression;
  - operational KPI section and platform connection center;
  - added order query and order detail view (platform raw fields);
  - retained and enhanced menu, intake, automation, and webhook-linked operations.
- Conversational Ops Execution (P0) added:
  - new `/ops-copilot` page;
  - natural-language command parsing plus structured execution preview;
  - approval/scheduling/execution/rollback state machine with audit log;
  - new backend APIs: `/api/ops/commands`, `/api/ops/commands/[commandId]`;
  - execution hardening:
    - UberEats platform adapter (requires `UBEREATS_MENU_MUTATION_ENDPOINT`);
    - persisted retry queue (`.runtime/ops-retry-queue/*.json`).

## Added in this update (2026-03-28)
- **LocationIQ / site-selection funnel (Business IQ) analysis engine V2.0**
  - Free quick assessment + paid deep-dive prompts upgraded to the V2.0 framework (5-dimension scorecard, fact→impact→action pattern, GO/CAUTION/NO-GO, upgrade hooks; paid themes include trade area/dayparts, competition whitespace, three-scenario revenue, risk matrix, 90-day plan, etc.).
  - Prompts live in `lib/funnel/iq-prompts-locationiq-v2.ts`; OpenAI direct path and n8n `RestaurantIQ - Analyze` / `RestaurantIQ - Full Report` **Validate+Prompt** nodes stay semantically aligned (including `response_format: json_object`).
  - Paid full report: n8n webhook payload matches `runFullReport` (`headline`, `reason`, `language`, `market_data`); response keys match the report UI / `fullSchema` (e.g. `executive_summary`, `risks[5]`).
  - Related APIs: `/api/funnel/analyze`, `/api/funnel/full-report`, and post-checkout full-report generation.

## Added in this update (2026-08-14)
- **LocationIQ payment fulfillment fix: deferred full-report generation**
  - The `/iq/success` return page and the Stripe webhook previously generated the full report synchronously before marking `paid`; under default function timeouts (~10-15s) the multi-minute generation was killed mid-flight, so paying users saw the report stay locked.
  - Both paths now pass `deferFullReportGeneration: true` (matching the access-code redemption path): `paid=true` is written immediately, then the report page generates via `/api/funnel/full-report` (`maxDuration: 300`) with a progress UI.
  - Files involved: `app/iq/success/page.tsx`, `app/api/funnel/stripe/webhook/route.ts`, `lib/funnel/iq-complete-purchase.ts` (existing parameter, unchanged).
- **Access-code unlock enhancements: built-in `TESTFREE` test code + accurate unlock errors**
  - `/api/funnel/redeem-access-code` now always accepts the built-in test code `TESTFREE` (case-insensitive) in addition to the env-configured `IQ_ACCESS_CODE`, so QA can unlock the paid report without Stripe.
  - When `reportId` is missing on the result page (analysis was not persisted), unlock/checkout now shows "Report was not saved — please rerun the analysis" instead of the misleading "Payment is temporarily unavailable".

## Added in this update (2026-08-15)
- **Paid full-report generation speedup (fixes 89% timeout)**
  - Explicit LLM client timeouts: MiMo 120s (tunable via `MIMO_TIMEOUT_MS`) with no auto-retry; OpenAI 120s with 1 retry. Previously the SDK default (10 min + auto-retries) let a single hung request eat the entire 300s serverless budget.
  - Browser-triggered lean generation (first report-page load) now uses the fast model: `mimo-v2-flash` when MiMo is primary (tunable via `MIMO_IQ_FULL_LEAN_MODEL`), 10K output cap, thinking off; prompts use the compact market-data digest instead of the full JSON blob.
  - "Retry generation" (quality mode) keeps the full `mimo-v2.5-pro` pipeline (deep market data + dual-model verification) unchanged.
- **Report quality upgrade: data dashboard + full provenance + auto professional tier**
  - New `ReportDataViz` dashboard: competitor traction (by review count, raw Google/Yelp values), ACS high-income household mix, revenue scenarios vs deterministic break-even/safe lines (D-4), and key stat tiles (population / median income / education / competitor counts / rating). Every chart value is read directly from `market_data_json` raw data — never LLM-generated numbers; missing data is labeled, never fabricated.
  - New "Data Provenance" appendix: per-source status, coverage, and fetch time for Google Places / Yelp / Foursquare / Census ACS / the D-4 finance model.
  - Tiered reports: the first generation is `standard` (fast); the page then silently regenerates `professional` (full market data + dual-model verification) in the background and auto-refreshes; a banner shows while upgrading.
  - Deep-research polling cap reduced from 300s to 75s (tunable via `DEEP_RESEARCH_TIMEOUT_MS`) so the professional pipeline fits the serverless budget; on timeout it degrades to standard web research.
- **Primary LLM engine switched to Anthropic Claude**
  - New Anthropic provider (official `@anthropic-ai/sdk`, default model `claude-opus-5`): once `ANTHROPIC_API_KEY` is set, the free quick assessment, paid full report, and dual-model cross-verification default to Claude; MiMo / OpenAI become the fallback chain.
  - Routing: primary is overridable via `IQ_PRIMARY_PROVIDER=anthropic|mimo|openai`; the fallback auto-selects a different configured provider. Also fixed the free-analysis path throwing before consulting the router when OpenAI was unconfigured (previously an exhausted OpenAI account 429'd the whole funnel).
  - Claude routes carry a 120s timeout and tiered `output_config.effort` (partial/lean low, full high, verify medium), with a 1.5x max_tokens headroom since thinking counts toward the budget.
  - New optional env vars: `ANTHROPIC_IQ_PARTIAL_MODEL` / `ANTHROPIC_IQ_FULL_MODEL` / `ANTHROPIC_IQ_FULL_LEAN_MODEL` / `ANTHROPIC_IQ_VERIFY_MODEL` / `ANTHROPIC_TIMEOUT_MS` (all defaulted).
- **New LLM routing probe**: `/api/health?probe=iq-llm` returns the resolved provider/model for partial and full generation (booleans and model names only — no secrets), to verify the Claude switch is live.
- **Fix repeated Claude full-report timeouts**: the Anthropic client now streams (long JSON generation is no longer cut off by a fixed request timeout), with a 240s overall budget (`ANTHROPIC_TIMEOUT_MS`) and no auto-retry; full-report effort lowered to medium (Opus 5 medium ≈ prior-gen high, much faster) with a 16K output cap.
- **Hard time budget across the paid-report pipeline (root-cause fix for repeated timeouts)**
  - New `lib/funnel/iq-deadline.ts`: the route establishes a wall-clock budget from its 300s maxDuration (20s reserved for finalization) and each stage trims itself against the remaining time. Deep research (up to 75s) runs only with ≥150s left; dual-model verification only with ≥90s left; under 25s the route returns a retryable message instead of hitting the serverless wall.
  - LLM calls now receive the remaining budget as a hard per-call timeout (the Anthropic client accepts a per-call timeout), plus duration/output-token logging (`[anthropic]`, `[funnel/full-report]`) for bottleneck attribution.
  - Fast path switched to `claude-sonnet-5` (`ANTHROPIC_IQ_FULL_LEAN_MODEL`) with **extended thinking disabled**: Opus 5 thinks by default and those tokens count toward max_tokens, which dominated first-load latency.
  - The "Retry generation" button now re-runs the fast path (it previously sent `quality: force`, so one tap triggered deep research + full generation + dual verification serially — a guaranteed timeout); professional depth still comes from the report page's background upgrade, which passes `quality: true` explicitly.
- **Fix fast-version "generation failed" (truncated output)**
  - Fast-path output cap raised 10K → 16K tokens: the full-report JSON does not fit in 10K, so it was cut off mid-object and failed to parse (surfacing as "generation failed" at ~130s).
  - New `lib/funnel/llm/json-repair.ts`: when a response is truncated at `max_tokens`, open structures are closed and the sections the model finished are salvaged instead of discarding the whole report (unit-verified across 6 truncation points).
  - Fallback order: with Claude primary, fall back to MiMo before OpenAI — an out-of-credit OpenAI account 429s instantly, which is no fallback at all.
- **Full-report failures are now observable (no longer swallowed)**
  - Previously every paid-report failure threw a bare `FULL_REPORT_GENERATION_FAILED` regardless of cause, so the UI showed only "generation failed" and production was undiagnosable. The provider's original error is now carried on the thrown error and returned in the `detail` field of the `/api/funnel/full-report` response (provider/model names and API error text only — never secrets).
  - The LLM router gained an `attempts` diagnostic: it records provider, model, and failure reason (timeout, unavailable model, unparseable JSON, quota 429, …) for both the primary and fallback legs and folds them into the error message. The router previously returned null for every failure, discarding both legs' reasons.
  - New live probe `/api/health?probe=iq-claude`: fires a 4-variant Claude call matrix in parallel (partial-path equivalent, fast full-report config, a thinking-on control, and the professional model) with trivial prompts, returning each variant's model, duration, stop_reason, output tokens, and raw error — enough to separate "model unavailable" from "parameter combination rejected" from "output truncated". It also reports whether fallback provider keys are configured.
  - New reproduction probe `/api/health?probe=iq-full-report&reportId=<id>` (`maxDuration=300`): runs the fast-path generation pipeline against a stored report's real `market_data_json`, returning duration/provider/model/report size on success and the **unmasked original error plus stack** on failure. The iq-claude matrix already proved the API and parameters are healthy, so only the real prompt can reproduce the fault.
  - The reproduction probe also writes its outcome to the new `iq_diagnostics` table (service-role writes, deny-all RLS, never client-readable): full-report generation routinely exceeds a 60s HTTP client limit, so persisting the result keeps the real error readable even after the caller has given up on the response.
  - New `/api/health?probe=iq-full-prompt&reportId=<id>`: runs the real full-report prompt (byte-for-byte the fast path's) against both Claude and the MiMo fallback, with output capped at 1.2K tokens so the answer returns inside an HTTP client timeout. Reports the prompt's component sizes (market_data / system / user / whitelist count) and each leg's outcome and raw error — separating "the input itself is the problem" from "generation is too long or too slow".
- **MiMo fallback failures are observable**: `runMimoJson` previously returned null for every failure (HTTP error, empty response, unparseable JSON), making it impossible to see why the fallback leg did not rescue a request. It now fills a `MimoDiagnostic` (model, maxTokens, duration, finish_reason, output tokens, text length, parse outcome, raw error), wired into the router's `attempts` summary.
- **`iq-full-prompt` accepts `&maxTokens=`** (capped at 8K, default 1.2K): measuring at two different output caps separates this ~30K-token prompt's fixed prefill cost from the per-token decode rate — the rate that determines whether a 16K-token full report can finish inside the route's budget at all.
- **Root-cause fix: a dead fallback model, and an output budget disconnected from the time left**
  - Measured on production (`probe=iq-full-prompt`, real report prompt ≈30K input tokens): `claude-sonnet-5` with thinking off took 21,994ms at a 1,200-token cap and 32,995ms at 2,400. That is **~9.2ms/token decode (≈109 tok/s)** with ~11s of fixed prefill and network cost.
  - Consequently a fixed 16K output cap means ~160s of pure decode, and with thinking on (the professional tier runs Opus with reasoning) it does not fit the 300s window at all — the call was aborted mid-generation and the whole report failed.
  - New `outputTokenBudget(remainingMs, {thinking})` derives the cap the remaining time can actually pay for (15s reserved for prefill; 10ms/token without thinking, 20ms/token with; floor 2,000, ceiling 16,000). Generation now always completes; if the model wanted more room the JSON is truncated at a known point and repaired.
  - Stage budget floors recomputed from the measurement: deep research 150s → **200s**, dual verify 90s → **120s**, generation floor 25s → **35s**.
  - **Fixed a completely dead MiMo fallback**: the fast path hardcoded `mimo-v2-flash`, which the API rejects with `400 Unsupported model`, so the fallback leg failed instantly on every paid report and only an out-of-credit OpenAI stood behind it — this is why a single primary miss killed the whole report. It now defaults to the same model as the non-lean route, overridable via `MIMO_IQ_FULL_LEAN_MODEL`.
  - New `/api/health?probe=iq-mimo-models` lists the models the account can actually call, so the replacement is a fact rather than a guess.
- **Removed duplicated model defaults (the duplication is what made an already-fixed router still look broken)**
  - `mimo-v2-flash` was the default for the free quick assessment (`MIMO_IQ_PARTIAL_MODEL`) as well as the fast full report, and is retired in both places; they now default to `mimo-v2.5` / `mimo-v2.5-pro`, confirmed callable for this account by `probe=iq-mimo-models` (`mimo-v2.5`, `mimo-v2.5-pro`).
  - New `RETIRED_MIMO_MODELS` guard: an env var still pointing at a retired model id is treated as unset and falls back to a valid default, so one stale Vercel variable cannot silently kill the fallback leg again.
  - New `resolveIqRouteResolved(task, {useFallback, fastModel})`: probes and diagnostics resolve the primary and fallback legs through it instead of each repeating model literals.
- **MiMo gains truncation repair; decode-rate constant refitted on three measurements**
  - MiMo had no truncation repair, so as the fallback leg a nearly complete report was discarded over its last few characters whenever output hit the cap (observed: `finish_reason=length` → `parsed=failed`). It now calls `repairTruncatedJson` on a length stop, matching the Anthropic client.
  - The decode rate is refitted across three measured points (700 / 1200 / 2400 token caps). Two runs at the same 2400 cap differ by ~2.4s, so the widest span (700→2400) is used, giving ~12.3ms/token, taken as **13ms/token** with headroom (26ms for thinking routes). Under-estimating this rate is precisely the failure mechanism: the budget buys more tokens than the time can decode and the call is aborted mid-generation.
  - `probe=iq-full-report` accepts `&budgetMs=` (max 240s): a smaller budget derives a smaller token cap, so the whole pipeline can be exercised and verified within an HTTP client timeout.
- **Reproduction probe gains background mode (`&defer=1`) and professional mode (`&quality=1`)**
  - A full-budget generation takes minutes — longer than any HTTP client will wait — and an aborted request kills the serverless function with it, which is why the two earlier reproduction attempts left no diagnostic row at all. It now uses Next.js `after()`: the response returns immediately, generation continues in the background, and the outcome is written to `iq_diagnostics` either way (mode, quality, budgetMs, duration, provider, model, report size, raw error).
  - `&quality=1` runs the non-lean professional path, so the Opus-with-thinking leg — the one that actually fails — can be verified against its budget.
- **The actual root cause, confirmed from a production diagnostic row: Claude finished normally but emitted unparseable JSON, and repair only ran on `max_tokens`**
  - The 09:57 row in `iq_diagnostics` reconstructs the user's failure: `anthropic/claude-sonnet-5: stop=end_turn out=15530 parsed=failed | mimo/mimo-v2-flash: no parseable JSON returned`, then `openai/gpt-4o: 429 no credits` → total failure after 201,590ms.
  - The key detail: `stop_reason=end_turn` means the model **completed normally** — it was not truncated — yet its JSON would not parse. Repair was gated inside the `stop_reason === 'max_tokens'` branch, so the recovery path never ran and a complete 15,530-token report was discarded over a formatting defect.
  - Fix: attempt repair on any parse failure, in both the Anthropic and MiMo clients, regardless of stop reason.
  - New `sanitizeJsonControlChars` escapes raw control characters (newlines, tabs) inside string literals. Long-form CJK prose produces these routinely, and since the document is structurally complete, bracket-closing repair does nothing for it — this is the transformation that actually recovers it. Repair also tries the text trimmed to its last `}`, covering markdown-fence-plus-embedded-newline, which defeated both paths. Verified across 9 cases (CJK newlines, tabs, truncation, fences, trailing prose, truncated nested arrays, no brace).
  - Incidentally confirms the decode-rate constant: 201,590ms / 15,530 tokens ≈ 13ms/token, matching the value configured.
- **The fallback leg no longer ignores the remaining budget**: a measured `budgetMs=68000` run actually took 148,449ms, because MiMo started a fresh 120s timeout after Claude had consumed its 68s. `runMimoJson` now accepts `timeoutMs`, and the router hands the fallback `total budget − elapsed`.

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
- **The professional tier's thinking decode rate is now measured, not assumed (the assumption was wrong)**
  - Background measurement: `claude-opus-5` (thinking on, effort medium) given a 240s budget actually took **296,334ms** — 56s over. The report itself generated fine (8,966 chars), but under the route's real 300s ceiling that is a failure.
  - Its derived cap was 8,653 tokens, so the per-token cost is *at most* ~34ms — and exactly that only if the run consumed its whole cap; if it stopped earlier the real rate is higher. The constant is therefore **40ms/token** rather than a value fitted to the optimistic reading. The previous 26ms/token was extrapolated as "double Sonnet" and was simply wrong.
  - Re-checked against the measured rates, every stage now fits: standard at full budget leaves 104s of margin, professional without deep research 42s, professional after 75s of research 32s, and professional with 160s left 25s.
  - `IqRouteAttempt` now records duration, output tokens, stop reason and maxTokens **on success as well** — token counts are what turn an observed wall-clock time into a per-token rate. They reach the diagnostic row via `_generation_attempts`.
- **Both tiers verified end to end, and the decode-rate model corrected accordingly**
  - Background runs (240s budget each): standard `claude-sonnet-5` took **180,450ms**, emitted 13,885 tokens with `stop=end_turn`, and produced a 17,697-char report; professional `claude-opus-5` took **194,023ms** and generated successfully. Both finished inside budget.
  - The decisive check: the standard run is the very shape that used to fail — `stop_reason=end_turn` with five figures of output tokens — and it now parses and yields a complete report.
  - Measured single-call rates: sonnet **13.0ms/token**, opus **17.2ms/token**. These correct the earlier "thinking doubles the rate" model: thinking tokens are ordinary output tokens billed against max_tokens; they do not make each token slower, they just spend budget on reasoning rather than report. The old 40ms/token constant came from dividing one run's *total* duration by a *single* call's cap — but the professional path issues a **second** generation (the competitor-grounding retry), so that total spanned two calls and inflated the rate roughly twofold.
  - Rates are now per model: `MS_PER_TOKEN_FAST=13`, `MS_PER_TOKEN_DEEP=19` (at the 16K ceiling a 1ms error costs 16s, so headroom matters).
  - **Retries are budgeted too**: `shouldRetryForCompetitorGrounding` and the completeness regen previously ignored remaining time entirely — one call fit, two did not, which is exactly how a professional run reached 296s. Each attempt now re-derives its cap from the time left, and a retry is skipped outright below 35s.
  - Re-checked margins: standard at full budget 61s, professional 29s, professional after deep research 22s. The professional cap also rises from 5,625 to 13,947 tokens — previously the over-estimated rate made the professional tier produce a *shorter* report than the standard one.
- **Professional tier verified**: 240s budget, actual **201,169ms** (39s margin), `claude-opus-5` emitting 11,840 tokens for a **13,047-char** report (4,440 before the rate correction). The measured single-call rate was 17.0ms/token, under the configured 19, so the margin is real; the retry was correctly skipped once the budget was spent.
- **Billed probes are now disabled by default**: `iq-claude`, `iq-full-prompt` and `iq-full-report` each spend real LLM credit per request, and `/api/health` is a public route — anyone holding a report id could have burned provider credit. They now require `IQ_DIAG_KEY` matched via `?key=`, and return 404 when the variable is unset. The read-only probes (`iq-supabase`, `iq-llm`, `iq-n8n`, `iq-mimo-models`) are unaffected.
## Added in this update (2026-08-18)
- **LocationIQ multi-agent analysis engine V3 (professional site-selection methodology)**
  - New `lib/funnel/agents/` engine: deterministic metrics layer → five specialist agents in parallel (market/demographics, competitive intel, site & access, financial modeling, risk) → decision matrix computed in code → partner-level synthesis → QA critic with one forced revision pass.
  - Deterministic metrics (`metrics.ts`, formula-derived, LLM may not alter numbers): trade-area demand pool (BLS CEX 2024 $3,945/household FAFH, income elasticity 0.8), saturation vs the 2.2-per-1k-residents US norm, fair-share revenue model (pool ÷ trade-area restaurant count × attractiveness multiplier capped 0.5–2.0x), 8% occupancy-ratio line with breakeven covers/day, Caltrans AADT traffic.
  - V2.0 five-dimension weights (traffic 25% / demographics 20% / competition 20% / access 20% / rent 15%) are computed and locked in code; `dashboard.overall_score` always equals the weighted composite; the free tier receives the computed-metrics digest too.
  - Financial model ships industry benchmarks: three-scenario method (pessimistic = revenue −20% & costs +5%), ramp curve (month 1 at 40–50%), prime cost (QSR 55–60%), revenue triangulation.
  - Backward compatible wiring: paid-report chain is multi-agent → n8n → single-call fallback; `IQ_ENGINE=legacy` reverts instantly.
- **Analysis engine switched to Claude (Anthropic SDK)**
  - New `lib/funnel/agents/llm.ts` provider layer: with `ANTHROPIC_API_KEY` set, Claude (default `claude-opus-5`) is primary and OpenAI is fallback; `IQ_LLM_PROVIDER` forces either; per-tier models via `ANTHROPIC_IQ_MODEL / _AGENT_MODEL / _FULL_MODEL`.
  - Handles Claude `refusal` stop reason, markdown-fence stripping, and one automatic JSON repair retry.
  - Fixes: the n8n failure fallback no longer loops back into the failing webhook; `gatherIqMarketDataFromGoogle` now populates `geocode.city/state` (unlocks Caltrans traffic and city-scoped commercial listings).
- **New diagnostic endpoint `/api/health/analyze`**: live connectivity probes for Anthropic / OpenAI / N8N (latency, reachability, actionable hints) to quickly triage "Failed to analyze location" incidents.

## Added in this update (2026-09-12)
- **Paid report now generates in the background, in stages (fixes the "89% then timeout" loop)**
  - Root cause: the whole pipeline ran inside one 300s HTTP request; a 188s Claude decode produced invalid JSON → retry hit the wall → 504; nothing after enrichment was persisted so Retry started over.
  - New `lib/funnel/iq-report-job.ts`: `enrich → draft → verify → finalize`, each stage in its own invocation (`POST /api/funnel/full-report/worker`, chained via `after()`) with a 250s budget; progress and the draft checkpoint live in `generation_state_json` (migration `0008`); Retry resumes from the failed stage; stalled jobs are re-kicked by the status endpoint.
  - `POST /api/funnel/full-report` returns 202 and enqueues; the page polls `GET /api/funnel/full-report/status` (real stage-based progress instead of a timer curve). Language previews and un-migrated databases fall back to the synchronous path automatically.
  - Claude runs with structured outputs (`output_config.format`, schema derived from the zod report schema in `lib/funnel/iq-report-output-schema.ts`), eliminating "output was not valid JSON"; `IQ_STRUCTURED_OUTPUT=false` disables.
  - Purchase fulfillment kicks the job immediately, so the report is often ready when the user lands on the page.
- **Email-me-when-ready**: the generation page accepts an email (`POST /api/funnel/full-report/notify`); finalize sends the report link via Resend (`RESEND_API_KEY`, `IQ_EMAIL_FROM`) so the user can leave.
- **Businesses at the exact address + their reviews (new data point)**: `lib/funnel/external-data/site-history.ts` identifies businesses operating/formerly operating at the address itself (Google Find Place + Nearby ≤45 m, Yelp ≤60 m), pulls Place Details / Yelp reviews, and extracts positive/negative themes, closure signals and lessons for the new operator into `market_data.site_history`; injected into paid prompt anchors, the competitor whitelist, and the multi-agent site/competition analysts; report `site_history` schema extended (prior_business_name/status, review_themes, lessons) and a new "Businesses at this address & their reviews" section renders on the report page.
- **Fix: "PDF won't download" on mobile**: the report page used to `fetch` the PDF into a Blob and click a synthetic `<a download>` — iOS Safari, the WeChat in-app browser and most Android WebViews ignore programmatic blob downloads (nothing happens, or a blank tab opens). It now sends a probe request to `/api/iq/report/[id]/pdf` first (`x-iq-pdf-probe: 1`; the server only runs the paid / report-ready checks and answers 204 without launching Chromium), then lets the browser itself navigate to the PDF URL — desktop browsers save the file in place, iOS opens the native PDF viewer with Share / Save to Files. Unpaid, not-ready and server failures still surface as readable in-page errors.

## Paid report 360° upgrade (R&D spec v1.0) · Phase 0 baseline (2026-09-12)
- New `qa/golden_set/millbrae_1711.json`: the R1–R8 defects exposed by the Millbrae report (id 5c361b95) frozen as a regression baseline (input + observed defects + the gate that must intercept each).
- New `npm run replay:golden -- millbrae_1711` (`scripts/replay-golden.ts`): replays the case through the current paid pipeline (nothing persisted), writes to `qa/out/`, and scans the output for R1–R8; exits 2 with a clear message when API keys are missing.
- New `npm run test:iq` (Node's built-in test runner via tsx) and a `npm run qa:gates` placeholder for later phases; dependencies added: `tsx` (dev) and `yaml` (parameter tables).

## 360° upgrade · Phase 1 data layer (2026-09-12)
- New `lib/iq/data/`: twelve data modules D1–D12 behind one contract `fetch(site, ctx) → DataResult{status: ok|partial|failed, data, source, fetched_at, license, cost_usd, coverage_note}`; every failure is written to `sources[]` as-is and **never replaced by an estimate**.
  - D1 Census Geocoder (fallback Google Geocoding + Census coordinates / FCC) → lat/lng + block / block group / tract / county / ZCTA; D2 ACS 5-year **queried at block group + tract** (B01003 / B11001 / B19013 / B19001 / B01001 / B25010 / B11003 / B08301 / B25064 / B25077 / B25003 / C16001 Chinese speakers + B02018 Chinese ancestry) with block-group geometry from TIGERweb — "ZIP has no ACS" (R2) can no longer happen; D3 LODES v8 WAC (`iq_lodes_wac`, `scripts/load-lodes.ts`); D4 Mapbox isochrones (walk 10 / drive 5·10·15), straight-line radii flagged `[直线半径]` without a token; D5 Overture Places loaded into `iq_poi` (`scripts/load_overture.py`, DuckDB over S3); D6 Google Places API (New) Nearby with the Pro field mask, **≤ 6 calls per report**, 30-day cache, $0 inside the free allowance (`GOOGLE_PLACES_BILLED=1` books $0.032/call); D7 review-growth snapshots (`iq_poi_snapshot`, `scripts/snapshot-reviews.ts`) → relative traffic tiers; D8 rent comps (user input + listing-page parsing + one web search), **no premium % below 3 comps**; D9 BART / Caltrain station table + Caltrans AADT; D10 BLS CEX 2023 food-away-from-home by income quintile; D11 development pipeline (one search, URL required); D12 user-input normalization (no CapEx → payback hidden).
- Parameter tables `lib/iq/params/{defaults,cuisine_taxonomy,hubs}.yaml` (Appendix A/B/C, zod-validated), `lib/iq/geo.ts` geometry helpers (isochrone × block-group area weighting by sampling), `lib/iq/model/schema.ts` (the `report_model.json` single-source-of-truth schema, Appendix D).
- Migration `0009_iq_360_data_layer.sql`: `iq_poi`, `iq_poi_snapshot`, `iq_lodes_wac`, `iq_cost_log`, plus report columns `report_model_json / narrative_json / report_tier / report_cost_usd`.
- Acceptance: `qa/e2e-data.test.ts` replays the Millbrae case offline — D2 returns tract-level Chinese ancestry and income, D5 ≥ 30 food POIs within 1 mi with ≥ 10 Chinese, D6 ≤ 6 calls, all 12 `sources[]` rows carry a status, data cost ≤ $0.10; degradation paths (no Mapbox / competitor sources down) asserted one by one. `npm run test:iq`: 99 passing. This sandbox has no outbound network, so the first production run should be checked against the `sources[]` table.

## 360° upgrade · Phase 2 trade-area engine (2026-09-12)
- `lib/iq/engines/trade-area.ts`: four fixed rings walk10 / drive5 / drive10 / drive15; block-group ACS metrics clipped by "isochrone × block-group area share" and summed (population, households, household-weighted median income, Chinese-speaking share, Chinese population, ages 25–44, families with children, household size, renter share, daytime jobs, restaurant / Chinese / cuisine demand); the primary ring follows the cuisine's `range_class` (everyday → drive5, regular → drive10, destination → drive15).
- Demand §2.3: `restaurant spend = households × CEX(income quintile) × region factor`; `Chinese spend = restaurant spend × [p_cn × 0.55 + (1 − p_cn) × 0.08]`; `cuisine_share` is not hand-picked — `lib/iq/engines/cuisine-share.ts` self-calibrates from the trade area's Chinese supply mix weighted by log review count (Laplace-smoothed, clamped 3%–50%).
- `lib/iq/engines/demand-huff.ts`: Huff capture `P_ij = A_j^α d_ij^−β / Σ A_k^α d_ik^−β`, `A = log(1 + reviews) × (rating / 4.2)`, β 2.0 / 1.5 / 1.1 by range class, L2 weight 0.5; lunch computed separately from walk10 jobs × out-rate × Chinese share × lunch ticket × 21 days against walk10 competitors only; outputs captured monthly demand, lunch/dinner split, by-ring stack, per-competitor diversion and the P distribution.
- Acceptance (`qa/e2e-report.test.ts`): all four Millbrae rings populated; `coverage_ratio = captured ÷ break-even` with printable intermediates; switching to 中式快餐 moves the primary ring to drive5, β = 2.0, and changes capture.

## 360° upgrade · Phase 3 competitor engine (2026-09-12)
- `lib/iq/engines/competitor.ts`: candidate pool = Overture ∪ Google; dedupe (normalized name + ≤ 100 m + same type, both ids kept, Google rating/status wins); three-layer sub-cuisine classifier (category mapping → CJK/Latin name keywords → batched LLM fallback in `lib/iq/narrative/llm.ts`, confidence < 0.6 → other_chinese); four competitive layers L1 same sub-cuisine / L2 other Chinese / L3 walk10 same-price occasion substitutes / L4 Asian grocery · boba · dim sum · Chinese school · Chinese bank anchors.
- Metrics: L1 density per 10k residents / per 10k Chinese, review-count HHI, price ladder, quality gap (avg < 4.0 opportunity / > 4.4 high bar), closure rate, benchmark revenue band (monthly new reviews × k=80 × ticket, `relative_tier_only` without history); U-shaped cluster score (0 → 30 / 1–3 → 60 / 4–8 → 85 / 9–15 → 60 / > 15 → 35, ±10 by coverage ratio).
- Void analysis requires **all three**: drive10 Chinese ≥ 3,000, density < 50% of hub median, L2 ≥ 4; otherwise only "supply is thin" may be written; hub medians precomputed monthly by `scripts/refresh-hubs.ts`.
- **Competitor guard (intercepts R1)**: ≥ 10 metro POIs of the sub-cuisine but 0 L1+L2 in drive10 → "fetch anomaly"; < 15 food POIs in drive10 with > 20,000 residents → "POI coverage anomaly"; D5 and D6 both down → guard fails; any trigger marks the report pre-check and blocks paid delivery.
- Acceptance: Millbrae L1 (Hunan) ≥ 1, L2 ≥ 15, L4 includes an Asian grocery; replaying with an emptied POI table trips the guard and never emits 空白 wording.

## 360° upgrade · Phase 4 scoring · finance reconciliation · confidence (2026-09-12)
- **The one scoring function** `lib/iq/engines/cuisine-fit.ts` (intercepts R5): six dimensions demand coverage 25 / audience fit 15 / competitive position 20 / access & traffic 15 / financial viability 15 / occasion & delivery 10, weights sum to 100, `total = Σ weight × score ÷ 100`; ≥ 75 GO / 60–74 CONDITIONAL GO / < 60 NO GO; dimensions lacking inputs score a neutral 50 with an explicit "unknown" driver, never a fabricated number; conditions come from the two weakest dimensions with numbers back-solved from the model (e.g. "negotiate rent to ≤ $X so occupancy cost ≤ 10%").
- Alternatives §4.2: the same address is re-scored for all 14 sub-cuisines in Appendix B (only competitor set, β, price tier and demand share change), returning the ranking and the user's cuisine rank; cannibalization §4.3 uses the same Huff model for existing stores.
- **Reconciled finance** `lib/iq/engines/finance.ts` (intercepts R4): `dine-in covers = seats × turns`, `delivery orders = covers × r/(1−r)`, `monthly revenue = (covers × ticket + delivery × delivery ticket) × days open`; occupancy rate removed; the three scenarios change only turns / delivery share / ticket, order counts are re-derived by the function with an assertion |Δ| < $1; sensitivity (rent +10%, turns −0.5, ticket −12.5%, delivery +15 pt) uses the same function; **no CapEx → `payback_months = null`** (intercepts R6).
- **Confidence** `lib/iq/engines/confidence.ts`: `Σ w_s × q_s` (ACS 20 / competitors 25 / traffic proxy 15 / rent comps 15 / daytime pop 10 / transit 5 / dev pipeline 5 / user inputs 5, q ∈ {0, 0.5, 1}); < 60 → pre-check tier.
- `lib/iq/pipeline.ts` `runReport360`: data layer → engines → `report_model.json` (zod-validated, Appendix D); replay with `npm run replay:golden -- millbrae_1711 --engine v360`. The risk register (`engines/risk.ts`) and audience segments (`engines/audience.ts`) fill templates only from model numbers.
- Acceptance (`qa/e2e-report.test.ts`): every displayed score = `score()`, weights = 100, scenario orders ↔ revenue reconcile, payback null without CapEx, 14-row alternatives table; `npm run test:iq`: 102 passing.

## 360° upgrade · Phase 5a narrative layer (2026-09-12)
- `lib/iq/narrative/templates.ts`: the 14-page information architecture (§5.2) and deterministic template sentences (model numbers + `[src:path]` only); `pageFragment` slices a read-only JSON fragment per page.
- `lib/iq/narrative/generate.ts`: Appendix E prompt per page (fast model for pages, Claude for the executive summary) producing `{title ≤ 28 chars with a judgment, body ≤ 120 chars, refs}`; `lib/iq/narrative/number-guard.ts` verifies every number in the prose ($ / % / 万 / orders / stores) exists in that page's fragment (±1 rounding), that cited paths exist, and the banned-word list (零竞争 / 空白 only when `void.is_void`; 保守估计 / 大约 never); one regeneration on failure, then template fallback with a `guard` tag. The summary's pre-lease conditions must be copied verbatim from `score.conditions`.
- `lib/iq/generate.ts` `generateReport360`: pipeline → narrative → QA gates → persist `report_model_json / narrative_json / report_tier / report_cost_usd` → `iq_cost_log`; new `POST/GET /api/iq/report360/[id]` (202 background generation; `?sync=1` + worker secret returns synchronously).

## 360° upgrade · Phase 6 QA gates and regression tests (2026-09-12)
- `lib/iq/qa/gates.ts` (`npm run qa:gates [model.json]`): ① schema (Appendix D) ② data integrity (confidence ≥ 60, competitor guard passed, D1/D2/D5 = ok) ③ sanity (Chinese share ≤ 100% and same order as the county, rent $1–$15/sf/mo, zero competitors in a populous ring is an anomaly) ④ reconciliation (scenarios re-derive, break-even = fixed ÷ contribution, weights = 100, total = Σ, no payback without CapEx, coverage_ratio consistent) ⑤ NumberGuard ⑥ banned wording; any failure → pre-check tier.
- `lib/iq/qa/gates.test.ts`: one failing case per original Millbrae defect R1, R2, R4, R5, R6, R8 is intercepted (R3 by the Phase 5b visual regression, R7 by the map page).
- Golden-set backtest: `qa/golden_set/backtest_bay_area.json` (6 venues operating ≥ 4 years + 6 permanently closed; labels re-verified via D6 `business_status`) and `scripts/backtest-golden.ts` (score AUC ≥ 0.75 required before shipping; needs network, cannot run in this sandbox).

## 360° upgrade · Phase 7 cost control and operations (2026-09-12)
- Variable cost budget ≤ $0.50 per paid report: data ≤ $0.10 (monthly Overture load, 12-month ACS / LODES caches, Google ≤ 6 calls + 30-day cache at $0 inside the free allowance, isochrones cached on a 100 m grid), LLM ≤ $0.25 (batched sub-cuisine classification at $0.002 per POI reused monthly; narratives ≤ 600 tokens per page ≈ $0.004, only the executive summary on Claude ≈ $0.03), search ≤ $0.06 (one query each for rent and pipeline), rendering ≈ $0.02. `CostLedger` itemizes every charge, `persistCostLog` writes `iq_cost_log`, and totals above $0.50 log an alert.
- Ops scripts: `scripts/load_overture.py` (monthly), `scripts/snapshot-reviews.ts` (monthly), `scripts/refresh-hubs.ts` (monthly), `scripts/load-lodes.ts` (yearly), `scripts/refresh-cex.ts` (yearly), `scripts/backtest-golden.ts` (every parameter change).
- Every degradation lands in `sources[]`: Google quota exhausted → Overture only, rating metrics 「未获取」, confidence lowered automatically; Mapbox exhausted → straight-line radii; LLM failure → template sentences; all of it appears in the page-14 sources table.
- "20 consecutive reports averaging ≤ $0.50 and P95 ≤ 90 s" must be verified in a networked environment by looping `replay:golden --engine v360`; the offline replay's data cost is $0.06.

## 360° upgrade · Phase 5b report information architecture and rendering (2026-09-12)
- New `/print/[reportId]` (`app/print/`): server-renders `report_model_json` + `narrative_json` as a **light, print-first 14-page document** (US Letter, 18 mm margins, footer = report id · data as of · page number), forced-light tokens (`prefers-color-scheme` has no effect), Noto Sans SC + Inter, Lucide line icons, no emoji; every page follows one structure: action title (with a judgment) → English subtitle → one core chart / table → ≤ 120-char interpretation → source chips (official stats / platform data / user input / model estimate / web search, status taken from `sources[]`). `?fixture=millbrae` previews the offline model outside production.
- Pages: cover / executive summary (verdict badge + three supports + three risks + break-even vs captured twin bars + pre-lease conditions) / trade-area map (SVG: four isochrone rings + L1/L2 competitors + L4 anchors + site; Overture and computed layers only, no Google basemap) / Esri-style four-ring table / audience / competitive landscape (L1–L4, price ladder, cluster-curve position, closure rate) / direct-competitor cards + benchmark band / category gap & alternatives / Huff capture (ring stack, lunch-dinner split, coverage gauge) / financial model (cost table, three scenarios, sensitivity waterfall, payback hidden without CapEx) / six-dimension score / risk matrix / pre-lease checklist & 90-day plan / method & sources (`sources[]` table + formulas). Missing values always render as 「未获取」.
- `lib/iq/render/pdf.ts`: server-side Chromium opens `/print`, waits for `window.__REPORT_READY__`, `page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true })`; `GET /api/iq/report/[id]/pdf` takes this path automatically whenever `report_model_json` exists (legacy template otherwise), replacing the dark browser-print PDF for good (R3). `/print` requires a paid row or `IQ_PRINT_TOKEN` in production.
- Visual regression (gate 7): `npx tsx scripts/smoke-print.ts` (needs `next dev -p 3111`) — measured 14 `h1.action-title`, 0 empty cells, every text node ≥ 4.5:1 contrast (SVG text included), no page overflow, PDF 1.4 MB / 14 pages / Letter, no tofu glyphs. To meet contrast, coral is used only as badge fill and key-number underline, and semantic colours use darker ink shades for text.

## 360° upgrade · automatic front-end integration and self-serve ops (2026-09-12)
- **Auto-generation**: as soon as the legacy paid report is stored (background finalize or sync path) the app POSTs `/api/iq/report360/:id`; the 360° engine generates and persists in its own invocation. The report page gains a "360° Professional Report" panel (`components/iq/Report360Panel.tsx`): auto-trigger, 6-second status polling, and once ready the score / verdict plus "Download 360° PDF", "Preview /print" and "Regenerate"; `IQ360_AUTO=false` disables the auto-trigger.
- **Auto-migration**: if writing `report_model_json` reveals migration 0009 is missing, `lib/iq/ops/migrate.ts` applies every migration file idempotently over `DATABASE_URL` and retries; without `DATABASE_URL` the panel says the database has not been upgraded yet.
- **Bootstrap mode**: when Overture is not loaded but Google Places returns ≥ 15 food POIs, the report is still delivered on the Google POI base and declares it in `meta.degradations` and on page 14 (`sources[]` still marks D5 failed); normal mode resumes automatically once Overture is loaded.

## 360° upgrade · Ops: data jobs on Vercel Cron (2026-09-12)
- New `GET|POST /api/iq/ops?task=migrate|lodes|hubs|snapshots|all&metro=sf-bay&state=ca&year=2022&counties=06081,…&dryRun=1&maxDetails=0&force=1` (`runtime nodejs`, `maxDuration 300`). Auth is either `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends it automatically once the `CRON_SECRET` env var exists on the project) or `x-iq-worker-secret` (`IQ_WORKER_SECRET`, or the worker secret derived from `SUPABASE_SERVICE_ROLE_KEY` — same as the full-report worker). Tasks run inline within the 300 s budget and return JSON: `{ ok, tasks: [{ task, ok, ms, cost_usd, result | error }], cost_usd, total_ms }`; `all` runs migrate → hubs → snapshots → lodes (one county) in order and never throws — a failing task only lands in `tasks[].error` (HTTP stays 200 with `ok:false`). A per-task cost summary is logged.
- The three scripts' core logic moved into importable functions (`lib/iq/ops/`), the scripts are now thin CLI wrappers with the same flags: `loadLodes({ state, year, counties, budgetMs, maxRows? })` (streams fetch + gunzip + readline, filters by county FIPS prefix, upserts `iq_lodes_wac` in batches of 1000; stops cleanly when the budget is nearly used and returns `counties_done / counties_remaining / truncated`; completed counties are recorded in `iq_market_cache(iq360_ops_progress / lodes:<state>:<year>)` so the next cron run with the same query string skips them; below `budgetMs < 120 s` it loads one county per call by default), `refreshHubs({ metro, dryRun })` → `{ hubs_done, cuisines_written, cost_usd, warnings }`, `snapshotReviews({ metro, maxDetails?, budgetMs })` → `{ places, rows_upserted, cost_usd, calls }`. Migrations reuse `runPendingMigrations` (`lib/iq/ops/migrate.ts`).
- `vercel.json` crons: `hubs` on the 1st at 09:00 UTC, `snapshots` on the 1st at 10:00 UTC, `lodes` (ca / 2022 / five Bay Area counties) every Sunday 11:00 UTC; function entry `app/api/iq/ops/route.ts: maxDuration 300`. **Vercel Hobby only allows once-a-day crons (with imprecise trigger times); the monthly / weekly schedules above need Pro.** On Hobby, switch them to daily (idempotent and no extra cost: hubs / lodes hit caches and the progress record) or trigger by hand with `curl -H "x-iq-worker-secret: …" https://app.restaurantiq.ai/api/iq/ops?task=all`.
- Env: `CRON_SECRET` (optional; without it the bearer path is disabled and only the worker secret is accepted), `DATABASE_URL` (required for `task=migrate`, Supabase → Settings → Database → URI), `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (writes), `GOOGLE_MAPS_API_KEY` (snapshots).
- Still off-Vercel: the monthly Overture load `scripts/load_overture.py` (DuckDB scan of S3 parquet, tens of minutes, memory-heavy) keeps running on a laptop / server; `scripts/refresh-cex.ts` and `scripts/backtest-golden.ts` also stay manual. One streaming pass over a state-level LODES file (CA ≈ 30 MB gz, a few hundred thousand rows) normally finishes the five Bay Area counties in 1–3 minutes; if a run exceeds its budget, the returned `counties_remaining` is picked up by the next weekly cron.
- Tests (`npm run test:iq`, no network / DB): `lib/iq/ops/lodes-loader.test.ts` (injected gzip stream + upsert: parsing, county filtering, batching, budget stop with `counties_remaining`, one-county mode, progress skip, maxRows, dry run), `auth.test.ts` (bearer / worker secret / reject), `run.test.ts` (param parsing, `all` order and budget slicing, error collection, skip after budget exhaustion).

## Runtime configuration table `iq_settings` (2026-09-12)
- New migration `0010_iq_settings.sql` and `lib/server/runtime-config.ts`: allow-listed keys (`GOOGLE_MAPS_API_KEY`, `MAPBOX_TOKEN`, `CRON_SECRET`, `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `CENSUS_API_KEY`, `IQ_PRINT_TOKEN`, `IQ360_AUTO`, `IQ_ENGINE`, `IQ_STRUCTURED_OUTPUT`, `RESEND_API_KEY`, `IQ_EMAIL_FROM`, `YELP_API_KEY`, `DATABASE_URL`) can live in `public.iq_settings` (RLS deny-all, service role only); each serverless instance loads them on start and **overrides** `process.env`, refreshing every 5 minutes — the operator can replace a broken key without touching the Vercel dashboard.
- Every entry point (free analysis, paid report + worker, 360° generation, ops, PDF, `/print`, Stripe webhook, health probe) calls `ensureRuntimeConfig()` first; when the table is missing or Supabase is not configured it silently keeps the deployment env.
- Note: Vercel Cron sends `Authorization: Bearer` from Vercel's own `CRON_SECRET` env var; the table value is only used for verification, so the same value must still be set on Vercel for scheduled runs to authenticate.

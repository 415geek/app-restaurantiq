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

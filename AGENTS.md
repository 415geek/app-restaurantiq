# 🤖 AI Agents Guidelines
<!-- n8n-as-code-start -->
<!-- n8nac-version: 1.5.5 -->

## 🎭 Role: Expert n8n Workflow Engineer

You are a specialized AI agent for creating and editing n8n workflows.
You manage n8n workflows as **clean, version-controlled TypeScript files** using decorators.

### 🌍 Context
- **n8n Version**: 2.14.2
- **Source of Truth**: `npx --yes n8nac skills` tools (Deep Search + Technical Schemas)

---

## 🚀 Workspace Bootstrap (MANDATORY)

Before using any `n8nac` workflow command, check whether the workspace is initialized.

### Initialization Check
- Look for `n8nac-config.json` in the workspace root.
- If `n8nac-config.json` is missing, or it exists but does not yet contain `projectId` and `projectName`, the workspace is not initialized yet.
- **NEVER tell the user to run `npx --yes n8nac init` themselves.** You are the agent — it is YOUR job to run the command.
- `npx --yes n8nac instance add` is the main setup command. It saves a new instance config, selects the active project, and activates that config in one flow. `npx --yes n8nac init` is the ergonomic alias.
- The explicit 2-step flow is still supported when you need to inspect projects before choosing one: first `npx --yes n8nac init-auth --host <url> --api-key <key>`, then `npx --yes n8nac init-project`.
- If the workspace already has saved instance configs, inspect them with `npx --yes n8nac instance list --json` before deciding whether to add a new one or switch the active config.
- Use `npx --yes n8nac instance select --instance-id <id>` or `npx --yes n8nac instance select --instance-name <name>` to switch saved configs non-interactively.
- Use `npx --yes n8nac instance delete --instance-id <id> --yes` or `npx --yes n8nac instance delete --instance-name <name> --yes` to remove stale saved configs non-interactively.
- If the user has already provided the n8n host and API key, prefer `npx --yes n8nac init-auth --host <url> --api-key <key>` when you still need to inspect the project list, or `npx --yes n8nac instance add --yes --host <url> --api-key <key> --project-id <id>|--project-name <name>|--project-index <n>` when the project selector is already known.
- If host or API key are missing, ask the user for them with a single clear question: "To initialize the workspace I need your n8n host URL and API key — what are they?" Then, once you have both values, run the appropriate command yourself.
- Do not run `n8nac list`, `pull`, `push`, or edit workflow files until initialization is complete.
- Never write `n8nac-config.json` by hand. Instance setup and switching must go through the documented `n8nac` commands so credentials, active selection, and AI context stay consistent.
- Do not assume initialization has already happened just because the repository contains workflow files or plugin files.

### Preferred Agent Command
- Single-flow setup: `npx --yes n8nac instance add` (or `npx --yes n8nac init`)
- Step 1 auth: `npx --yes n8nac init-auth --host <url> --api-key <key>`
- Step 2 project selection: `npx --yes n8nac init-project --project-id <id>|--project-name <name>|--project-index <n> [--sync-folder <path>]`
- Saved config management: `npx --yes n8nac instance list --json`, `npx --yes n8nac instance select --instance-id <id>|--instance-name <name>`, `npx --yes n8nac instance delete --instance-id <id>|--instance-name <name> --yes`
- `npx --yes n8nac init-project` can run interactively after `npx --yes n8nac init-auth`, or non-interactively when the project selector is known.

### Required Order
1. Check for `n8nac-config.json`.
2. If saved configs already exist: inspect them with `npx --yes n8nac instance list --json`. Reuse them with `npx --yes n8nac instance select` instead of creating duplicates whenever that satisfies the user request.
3. If initialization is missing and `N8N_HOST` / `N8N_API_KEY` are available: run `npx --yes n8nac init-auth --host <url> --api-key <key>` to discover projects, unless the project selector is already known and you can finish in one command with `npx --yes n8nac instance add --yes ...`.
4. If initialization is missing and credentials are absent: ask the user for the host URL and API key, then run the appropriate `n8nac` command yourself. **Do not ask the user to run the command.**
5. After credentials are saved, inspect the listed projects. If only one project exists, run `npx --yes n8nac init-project --project-index 1 --sync-folder workflows`. If multiple projects exist, ask the user which one to use, then run `npx --yes n8nac init-project --project-id <id> [--sync-folder <path>]`.
6. Only after initialization is complete, continue with workflow discovery, pull, edit, validate, and push steps.

---

## 🔄 GitOps & Synchronization Protocol (CRITICAL)

n8n-as-code uses a **Git-like sync architecture**. The local code is the source of truth, but the user might have modified the workflow in the n8n UI.

**⚠️ CRITICAL RULE**: Before modifying ANY existing `.workflow.ts` file, you MUST follow the git-like workflow:

### Git-like Sync Workflow

1. **LIST FIRST**: Check status with `npx --yes n8nac list`
   - `npx --yes n8nac list`: List all workflows with their sync status (lightweight — only reads metadata).
   - `npx --yes n8nac list --local`: List only local `.workflow.ts` files.
   - `npx --yes n8nac list --remote`: List only remote workflows.
   - Identify workflow IDs, filenames, and sync status.
   - Read `n8nac-config.json` to understand the active sync context. The config defines `syncFolder`, `instanceIdentifier`, and `projectName`; `n8nac` builds the full local path under the hood.
   - Always run `npx --yes n8nac` from the workspace root. Never construct sync paths manually.

2. **PULL IF NEEDED**: Download remote changes before editing
   - `npx --yes n8nac pull <id>`: Download workflow from n8n to local.
   - Required if workflow exists remotely but not locally, or if remote has newer changes.

3. **EDIT / CREATE LOCALLY**: Work on the local `.workflow.ts` file inside the active workflow directory.
   - For an existing workflow: edit the pulled local file.
   - For a brand-new workflow: create the file inside the active local workflow directory, never in the workspace root.
   - First try to discover that directory from existing local workflow paths via `npx --yes n8nac list --local`.
   - If there are no local workflows yet, run `npx --yes n8nac list` and use the directory portion of any reported `Local Path` as the active local workflow directory.
   - Do **not** guess the directory from the instance identifier alone. The active directory can include a project subdirectory such as `personal`.
   - Only if no workflow paths are available at all, inspect the directory created by initialization under the configured `syncFolder` and use its active project subdirectory.
   - After writing a new file, confirm it appears in `npx --yes n8nac list --local` before running `npx --yes n8nac push <filename>` with the full filename such as `slack-notification.workflow.ts`.

4. **PUSH**: Upload your changes explicitly
   - `npx --yes n8nac push <filename>`: Upload the local workflow file to n8n. This is the only public push form.
   - `npx --yes n8nac push <filename> --verify`: Push and immediately verify the live workflow against the local schema.

   > ⚠️ **CRITICAL — what `filename` means**:
   > - Use only the full workflow filename including the `.workflow.ts` suffix, for example `slack-notification.workflow.ts`.
   > - Do **not** omit the extension or pass a bare workflow name such as `slack-notification`.
   > - Do **not** pass a path. `n8nac` resolves the real local path from `n8nac-config.json`.
   > - Do **not** use the workflow title from n8n as a CLI argument.
   > - The remote source of truth remains the workflow ID; `push` simply starts from the local filename.

5. **VERIFY (strongly recommended)**: After any push, validate the live workflow
   - `npx --yes n8nac verify <id>`: Fetches the workflow from n8n and checks all nodes against the schema.
   - Detects: invalid `typeVersion` (e.g. 1.6 when schema only has 2.2), invalid `operation` values (e.g. 'post' vs 'create'), missing required params, unknown node types.
   - This catches the same errors n8n would display as "Could not find workflow" or "Could not find property option" **before** the user opens the workflow.

6. **INSPECT TEST PLAN (recommended for webhook/chat/form workflows)**: Determine whether and how the workflow can be tested
   - `npx --yes n8nac test-plan <id>`: Detects the trigger type, decides whether the workflow is HTTP-testable, and returns suggested endpoints plus an inferred payload.
   - Use `--json` when an agent needs structured output.
   - The payload is heuristic: treat it as a starting point, not as a guaranteed contract.
   - Skip this step for Schedule or generic polling triggers when the command reports them as non-testable.

7. **TEST (recommended for webhook/chat/form workflows)**: Execute the workflow
   - **⚠️ DEFAULT: ALWAYS activate then test with `--prod`.** This is the only flow that works without manual intervention in the n8n editor.
   - `npx --yes n8nac workflow activate <id>` then `npx --yes n8nac test <id> --prod`: **This is the standard sequence.** Activate the workflow first, then call the production webhook URL. Works immediately, no manual arm needed.
   - `npx --yes n8nac test <id>` (bare, no `--prod`): Only for workflows that are NOT activated AND the test URL has been manually armed in the n8n editor ("Listen for test event"). **Do NOT use this as the default path — it will fail silently without the manual arm step.**
   - **⚠️ MANDATORY RULE: By default, ALWAYS run `workflow activate <id>` before testing and ALWAYS pass `--prod`. Only use bare `test <id>` when the workflow is intentionally left inactive AND the test URL has been manually armed in the n8n editor; never use bare `test <id>` as the default path.**
   - Works for workflows whose first trigger is a **Webhook**, **Chat Trigger**, or **Form Trigger**.
   - Does NOT work for Schedule or generic polling triggers (those cannot be called via HTTP).

   ### ⚠️  Critical: Error Classification

   `n8nac test` classifies failures into three buckets:

   **Class A — Configuration gap** (exit 0, do NOT iterate):
   - Missing credentials, unset LLM model, missing environment variable.
   - These are NOT bugs in the workflow code — they are setup tasks the user must complete in the n8n UI.
   - When you see `⚠  Configuration gap detected (Class A)`, stop and inform the user what to configure.
   - **Do NOT re-push or re-edit the workflow** to try to fix a Class A error — you cannot fix credentials in code.

   **Runtime-state issue** (exit 0, do NOT edit code blindly):
   - Typical examples: the webhook test URL is not armed yet, or the production webhook is not registered even though the workflow was just activated.
   - For classic Webhook/Form triggers, `/webhook-test/...` usually requires a manual arm step in the n8n editor: click `Execute workflow` or `Listen for test event`, then retry the same request once.
   - There is no documented public n8n API in this project for arming test webhooks on your behalf, so treat this step as manual.
   - If `n8nac test --prod` still reports "webhook is not registered" after `npx --yes n8nac workflow activate <id>`, do not keep editing the workflow. Treat it as a publish/runtime-state issue and verify the workflow state in n8n.

   **Class B — Wiring error** (exit 1, fix and re-test):
   - Bad expression, wrong field name, HTTP error caused by the workflow logic.
   - These ARE fixable by editing the `.workflow.ts` file.
   - When you see `❌ Workflow execution failed (Class B)`, fix the wiring, push, and `n8nac test` again.

   > `validate` ≠ `test`: a workflow can pass static validation but still fail at runtime (Class A / runtime-state / Class B).
   > Always run `test` after `verify` for webhook-driven workflows before declaring the workflow done.

8. **RESOLVE CONFLICTS**: If Push or Pull fails due to a conflict
   - `npx --yes n8nac resolve <id> --mode keep-current`: Force-push local version.
   - `npx --yes n8nac resolve <id> --mode keep-incoming`: Force-pull remote version.

### Key Principles
- **Explicit over automatic**: All operations are user-triggered or ai-agent-triggered.
- **Point-in-time status**: `list` is lightweight and covers all workflows at once.
- **Pull before edit**: Always ensure you have latest version before modifying.
- **new workflows must be created in the active local workflow directory**: Do not write them in the repo root or an ad-hoc folder.
- **push always starts from the local filename**: Never invent sync paths in the CLI command and never use the workflow title as a CLI identifier.
- **inspect then test after push for webhook/chat/form workflows**: Run `npx --yes n8nac test-plan <id>` first, then activate and test with `--prod`. **ALWAYS activate the workflow first (`workflow activate <id>`), then test with `npx --yes n8nac test <id> --prod`. Never use bare `test <id>` — it requires a manual arm step in the n8n editor and will fail without it.** A Class A error is not a bug — tell the user. A runtime-state issue is also not a code bug — fix the state/arming problem, not the workflow code. A Class B error is fixable — iterate.

> `pull` and `resolve` always operate on **a single workflow ID**. `push` always starts from **a single local filename** in the active sync scope. `list` is the only command that covers all workflows at once.

If you skip the Pull step, your Push will be REJECTED by the Optimistic Concurrency Control (OCC) if the user modified the UI in the meantime.

---

## 🔬 MANDATORY Research Protocol

**⚠️ CRITICAL**: Before creating or editing ANY node, you MUST follow this protocol:

### Step 0: Pattern Discovery (Intelligence Gathering)
```bash
npx --yes n8nac skills examples search "telegram chatbot"
```
- **GOAL**: Don't reinvent the wheel. See how experts build it.
- **ACTION**: If a relevant workflow exists, DOWNLOAD it to study the node configurations and connections.
- **LEARNING**: extracting patterns > guessing parameters.

### Step 1: Search for the Node
```bash
npx --yes n8nac skills search "google sheets"
```
- Find the **exact node name** (camelCase: e.g., `googleSheets`)
- Verify the node exists in current n8n version

### Step 2: Get Exact Schema
```bash
npx --yes n8nac skills node-info googleSheets
```
- Get **EXACT parameter names** (e.g., `spreadsheetId`, not `spreadsheet_id`)
- Get **EXACT parameter types** (string, number, options, etc.)
- Get **available operations/resources**
- Get **required vs optional parameters**

### Step 3: Apply Schema as Absolute Truth
- **CRITICAL (TYPE)**: The `type` field MUST EXACTLY match the `type` from schema
- **CRITICAL (VERSION)**: Use HIGHEST `typeVersion` from schema
- **PARAMETER NAMES**: Use exact names (e.g., `spreadsheetId` vs `spreadsheet_id`)
- **NO HALLUCINATIONS**: Do not invent parameter names

### Step 4: Validate Before Finishing
```bash
npx --yes n8nac skills validate workflow.workflow.ts
```

### Step 5: Verify After Push
```bash
npx --yes n8nac verify <workflowId>
```
- **Catches runtime errors** that local validate misses: non-existent typeVersion, invalid operation values, missing required params.
- Tip: use `npx --yes n8nac push my-workflow.workflow.ts --verify` to do both in one command.

### Step 6: Inspect Webhook/Chat/Form Testability After Push
```bash
npx --yes n8nac test-plan <workflowId>
npx --yes n8nac test-plan <workflowId> --json
```
- Determines whether the workflow is HTTP-testable.
- Returns the trigger type, endpoints, and a suggested payload inferred from expressions.
- The suggested payload is heuristic. Review it before relying on it.
- For classic Webhook/Form triggers, the test URL often requires a manual arm step in the n8n editor before it will accept a request.

### Step 7: Test Webhook/Chat/Form Workflows After Push
```bash
# STANDARD sequence — ALWAYS activate first, then test with --prod:
npx --yes n8nac workflow activate <workflowId>
npx --yes n8nac test <workflowId> --prod

# Without activation — ONLY if the test URL was manually armed in n8n editor. Do NOT use as default.
npx --yes n8nac test <workflowId>
```
- **⚠️ DEFAULT RULE: ALWAYS activate the workflow first and prefer `test <id> --prod`. Use bare `test <id>` only when the workflow is intentionally left inactive _and_ you have manually armed the test URL in the n8n editor.**
- **Closes the dev cycle** for HTTP-triggered workflows.
- **Class A exit 0** — config gap (credentials, model, env var): inform user, do NOT re-edit code.
- **Runtime-state exit 0** — webhook test URL not armed / production webhook not registered: resolve the state issue, do NOT re-edit code.
- **Class B exit 1** — wiring error (bad expression, wrong field): fix, push, re-test.
- Skip this step for Schedule/polling triggers — they cannot be called via HTTP.

---

## 🗺️ Reading Workflow Files Efficiently

Every `.workflow.ts` file starts with a `<workflow-map>` block — a compact index generated automatically at each sync. Always read this block first before opening the rest of the file.

```
// <workflow-map>
// Workflow : My Workflow
// Nodes   : 12  |  Connections: 14
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ScheduleTrigger                  scheduleTrigger
// AgentGenerateApplication         agent                      [AI] [creds]
// OpenaiChatModel                  lmChatOpenAi               [creds] [ai_languageModel]
// Memory                           memoryBufferWindow         [ai_memory]
// GithubCheckBranchRef             httpRequest                [onError→out(1)]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ⚠️ Nodes flagged [ai_*] are NOT in the → routing — they connect via .uses()
// ScheduleTrigger
//   → Configuration1
//     → BuildProfileSources → LoopOverProfileSources
//       .out(1) → JinaReadProfileSource → LoopOverProfileSources (↩ loop)
//
// AI CONNECTIONS
// AgentGenerateApplication.uses({ ai_languageModel: OpenaiChatModel, ai_memory: Memory })
// </workflow-map>
```

### How to navigate a workflow as an agent

1. Read `<workflow-map>` only — locate the property name you need.
2. Search for that property name in the file (for example `AgentGenerateApplication =`).
3. Read only that section — do not load the entire file into context.

This avoids loading 1500+ lines when you only need to patch 10.

---

## 📝 Minimal Workflow Structure

```typescript
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
  name: 'Workflow Name',
  active: false
})
export class MyWorkflow {
  @node({
    name: 'Descriptive Name',
    type: '/* EXACT from search */',
    version: 4,
    position: [250, 300]
  })
  MyNode = {
    /* parameters from npx --yes n8nac skills node-info */
  };

  @node({
    name: 'Next Node',
    type: '/* EXACT from search */',
    version: 3
  })
  NextNode = { /* parameters */ };

  @links()
  defineRouting() {
    this.MyNode.out(0).to(this.NextNode.in(0));
  }
}
```

### AI Agent Workflow Example (CRITICAL — follow this pattern for LangChain nodes)

```typescript
import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : AI Agent
// Nodes   : 6  |  Connections: 1
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ChatTrigger                      chatTrigger
// AiAgent                          agent                      [AI]
// OpenaiModel                      lmChatOpenAi               [creds] [ai_languageModel]
// Memory                           memoryBufferWindow         [ai_memory]
// SearchTool                       httpRequestTool            [ai_tool]
// OutputParser                     outputParserStructured     [ai_outputParser]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ChatTrigger
//   → AiAgent
//
// AI CONNECTIONS
// AiAgent.uses({ ai_languageModel: OpenaiModel, ai_memory: Memory, ai_outputParser: OutputParser, ai_tool: [SearchTool] })
// </workflow-map>

@workflow({ name: 'AI Agent', active: false })
export class AIAgentWorkflow {
  @node({ name: 'Chat Trigger', type: '@n8n/n8n-nodes-langchain.chatTrigger', version: 1.4, position: [0, 0] })
  ChatTrigger = {};

  @node({ name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent', version: 3.1, position: [200, 0] })
  AiAgent = {
    promptType: 'define',
    text: '={{ $json.chatInput }}',
    hasOutputParser: true,  // REQUIRED when an output parser sub-node is connected
    options: { systemMessage: 'You are a helpful assistant.' },
  };

  @node({ name: 'OpenAI Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.3, position: [200, 200],
    credentials: { openAiApi: { id: 'xxx', name: 'OpenAI' } } })
  OpenaiModel = { model: { mode: 'list', value: 'gpt-4o-mini' }, options: {} };

  @node({ name: 'Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', version: 1.3, position: [300, 200] })
  Memory = { sessionIdType: 'customKey', sessionKey: '={{ $execution.id }}', contextWindowLength: 10 };

  @node({ name: 'Search Tool', type: 'n8n-nodes-base.httpRequestTool', version: 4.4, position: [400, 200] })
  SearchTool = { url: 'https://api.example.com/search', toolDescription: 'Search for information' };

  @node({ name: 'Output Parser', type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, position: [500, 200] })
  OutputParser = { schemaType: 'manual', inputSchema: '{ "type": "object", "properties": { "answer": { "type": "string" } } }' };

  @links()
  defineRouting() {
    // Regular data flow: use .out(0).to(target.in(0))
    this.ChatTrigger.out(0).to(this.AiAgent.in(0));

    // AI sub-node connections: ALWAYS use .uses(), NEVER .out().to() for these
    this.AiAgent.uses({
      ai_languageModel: this.OpenaiModel.output,   // single ref → this.Node.output
      ai_memory: this.Memory.output,               // single ref
      ai_outputParser: this.OutputParser.output,    // single ref
      ai_tool: [this.SearchTool.output],            // array ref → [this.Node.output, ...]
    });
  }
}
```

> **Key rule**: Regular nodes connect with `source.out(0).to(target.in(0))`. AI sub-nodes (models, memory, tools, parsers, embeddings, vector stores, retrievers) MUST connect with `.uses()`. Using `.out().to()` for AI sub-nodes will produce broken connections.

---

## 🚫 Common Mistakes to AVOID

1. ❌ **Wrong node type** - Missing package prefix causes "?" icon. Always use the EXACT `type` from `node-schema` (with full package prefix: `n8n-nodes-base.switch`, not `switch`).
2. ❌ **Outdated typeVersion** - Use highest version from schema
3. ❌ **Non-existent typeVersion** - e.g. `typeVersion: 1.6` when schema only has `[1, 1.1, 2, 2.2]`. Causes "Could not find workflow" in n8n. Always pick a value **from the exact array in `node-schema`**.
4. ❌ **Invalid operation/resource value** - e.g. `operation: 'post'` on Slack node when the valid string for that resource is `'create'`. n8n will show "Could not find property option". Always verify the exact string appears in the `options[].value` list returned by `npx --yes n8nac skills node-schema <node>`.
5. ❌ **Mismatched resource + operation** - Each `resource` value enables a different set of valid `operation` values. Combining an operation from the wrong resource causes "Could not find property option" in n8n.
6. ❌ **Guessing parameter structure** - Check if nested objects required
7. ❌ **Wrong connection names** - Must match EXACT node `name` field
8. ❌ **Inventing non-existent nodes** - Use `search` to verify
9. ❌ **Wrong `.uses()` syntax for tools** - `ai_tool` and `ai_document` are ALWAYS arrays: `ai_tool: [this.Tool.output]`. All other AI connection types (`ai_languageModel`, `ai_memory`, etc.) are single refs: `ai_languageModel: this.Model.output`. Never wrap single refs in an array.
10. ❌ **Connecting AI sub-nodes with `.out().to()`** — any node flagged `[ai_*]` in the NODE INDEX MUST use `.uses()`, never `.out().to()`. Doing so produces invisible/broken connections in n8n.
11. ❌ **Guessing fixedCollection values without checking** — Fields like `rules` (Switch/If) or `formFields` (Wait) expand into nested structures with specific valid option values. Always run `node-info <node>` first — the schema now shows the full internal structure and all valid values. Never invent operation names like `'contained'`.
12. ❌ **Inverting `value1`/`value2` in Switch/If rules** — `value1` is ALWAYS the expression being evaluated (e.g. `={{ $json.myField }}`). `value2` is ALWAYS the literal comparison value (e.g. `'auto_send_ok'`). Swapping them causes rules to never match.
13. ❌ **Wrong `formFields` structure for Wait (form) nodes** — `formFields` must use `{ values: [...] }` (flat array). Do NOT use `formFieldsUi.fieldItems` — that legacy structure causes "Could not find property option" in n8n.

---

## ✅ Best Practices

### Node Parameters
- ✅ Always check schema before writing
- ✅ Use exact parameter names from schema
- ❌ Never guess parameter names

### Expressions (Modern Syntax)
- ✅ Use: `{{ $json.fieldName }}` (modern)
- ✅ Use: `{{ $('NodeName').item.json.field }}` (specific nodes)
- ❌ Avoid: `{{ $node["Name"].json.field }}` (legacy)

### Node Naming
- ✅ "Action Resource" pattern (e.g., "Get Customers", "Send Email")
- ❌ Avoid generic names like "Node1", "HTTP Request"

### AI Tool Nodes

When an AI agent uses tool nodes:

- ✅ Search for the exact tool node first.
- ✅ Run `npx --yes n8nac skills node-info <nodeName>` before writing parameters.
- ✅ Connect tool nodes as arrays: `this.Agent.uses({ ai_tool: [this.Tool.output] })`.
- ❌ Do not assume tool parameter names or reuse stale node-specific guidance.

---

## 📚 Available Tools


### 🔍 Unified Search (PRIMARY TOOL)
```bash
npx --yes n8nac skills search "google sheets"
npx --yes n8nac skills search "how to use RAG"
```
**ALWAYS START HERE.** Deep search across nodes, docs, and tutorials.

### 🛠️ Get Node Schema
```bash
npx --yes n8nac skills node-info googleSheets  # Complete info
npx --yes n8nac skills node-schema googleSheets  # Quick reference
```

### 🌐 Community Workflows
```bash
npx --yes n8nac skills examples search "slack notification"
npx --yes n8nac skills examples info 916
npx --yes n8nac skills examples download 4365
```

### 📖 Documentation
```bash
npx --yes n8nac skills docs "OpenAI"
npx --yes n8nac skills guides "webhook"
```

### ✅ Validate
```bash
npx --yes n8nac skills validate workflow.workflow.ts
```

### 🔎 Verify Live Workflow (post-push)
```bash
npx --yes n8nac verify <workflowId>          # Fetch from n8n + validate against schema
npx --yes n8nac push my-workflow.workflow.ts --verify   # Push then verify in one step
```
Catches runtime errors (invalid typeVersion, bad operation values, missing required params) **before** the user notices them in the UI.

### 🧭 Inspect Webhook/Chat/Form Test Plan (post-push)
```bash
npx --yes n8nac test-plan <workflowId>         # Detect trigger + testability + suggested payload
npx --yes n8nac test-plan <workflowId> --json  # Structured output for agents
```
Use this first when an agent needs to know whether a workflow can be tested and what payload to try.

### 🧪 Test Webhook/Chat/Form Workflows (post-push)
```bash
npx --yes n8nac test <workflowId>              # Trigger test-mode URL, show result
npx --yes n8nac test <workflowId> --data '{"key":"value"}'  # Pass request body
npx --yes n8nac test <workflowId> --query '{"key":"value"}' # Explicit query params for GET/HEAD webhooks
npx --yes n8nac test <workflowId> --prod       # Use production URL instead
```
Closes the dev cycle for webhook/chat/form workflows. Exits 0 on success, Class A (config gap — inform user), or runtime-state issues such as an unarmed test webhook. Exits 1 only on Class B (wiring error — fix and re-test). Prefer `npx --yes n8nac test-plan` first when the payload is unclear. For GET/HEAD webhooks, prefer `npx --yes n8nac test --query <json>`; `--data` also maps to query params for backward compatibility.
If `npx --yes n8nac test` says the webhook is not registered, do not blindly rewrite the workflow. First decide whether the test URL needs manual arming in the editor or whether the production webhook is still unpublished.

### 🧾 Inspect Executions (debug what happened on the n8n server)
```bash
npx --yes n8nac execution list --workflow-id <id> --limit 5 --json    # Recent executions for one workflow
npx --yes n8nac execution get <executionId> --include-data --json      # Full execution detail and run data
```
Use this immediately after a webhook returns 2xx but the workflow still appears broken. A successful HTTP trigger only means n8n accepted the request; the execution can still fail later inside the workflow.

### 🔑 Credential Management (resolve Class A gaps without opening the n8n UI)
```bash
npx --yes n8nac workflow credential-required <id> --json            # List missing credentials (exit 1 if any missing)
npx --yes n8nac credential schema <type>                            # Discover required fields for a type
npx --yes n8nac credential list --json                              # List existing credentials as JSON
npx --yes n8nac credential create --type <type> --name <name> --file cred.json --json  # Create from file and return metadata
npx --yes n8nac credential delete <id>                              # Delete a credential
npx --yes n8nac workflow activate <id>                              # Activate workflow after credentials provisioned
```
**Full autonomous loop:** push workflow → `workflow credential-required <id> --json` (exit 1 = missing, act) → `credential schema <type>` → ask user for secret values → `credential create --file` → `workflow activate <id>` → `test <id>`. Workflow blocked by a Class A error? Use `credential schema <type>` to discover required fields, write them to a JSON file, then run `credential create` to provision the credential programmatically. If testing a classic Webhook/Form trigger via the test URL, expect a manual arm step in the n8n editor before the request will succeed. **Never pass secrets inline via --data** — use --file instead (keeps secrets out of shell history).
If `credential create` fails, read the returned validation message and change the payload before retrying. Never rerun the same failing command unchanged. If a subcommand is unfamiliar, run `npx --yes n8nac <subcommand> --help` instead of inventing flags.

---

> **When in doubt**: `npx --yes n8nac skills node-info <nodeName>` — the schema is always the source of truth.
<!-- n8n-as-code-end -->

## Learned User Preferences

- LocationIQ paid reports: expect address-specific competitors and revenue assumptions tied to retrieved market signals, not placeholder competitor labels or identical revenue bands across addresses.
- When scoping IQ report work, treat **server PDF export** as higher priority than web-only visual polish when those goals conflict (stakeholder direction: PDF-first relative to on-screen layout).

## Learned Workspace Facts

- If `N8N_IQ_FULL_REPORT_WEBHOOK_URL` or `N8N_FULL_REPORT_WEBHOOK_URL` is set, production paid full reports are produced by the n8n workflow; deploy prompt changes there, not only in repo TypeScript.
- `full_report_json` is reused until regeneration; use `POST /api/funnel/full-report` with `force: true` after prompt or data pipeline changes.
- IQ auth redirects and Clerk allow-list targets are documented in `docs/CLERK_REDIRECTS.md`; `NEXT_PUBLIC_APP_URL` drives absolute post-sign-in URLs; guest-paid reports attach to the signed-in user via `POST /api/iq/link-report` (triggered from the report page client when Clerk session exists).
- Paid IQ report PDFs are served from `GET /api/iq/report/{id}/pdf?lang=zh|en` (Puppeteer + `puppeteer-core` and `@sparticuz/chromium` on Vercel). The report UI should prefer downloading that response as a Blob and only fall back to `window.print()` if the API fails; local dev may need a working Chromium for that route.
- Premium IQ reports use Tavily Deep Research API (`TAVILY_API_KEY`) for McKinsey-style location analysis; default model is "pro" with 300s timeout; results stored in `market_data_json.deep_research`.
- The full-report route has OpenAI fallback when n8n workflow fails (Class A config gaps like missing credentials).
- ACS demographic data enrichment requires geocode from Google Maps API (`GOOGLE_MAPS_API_KEY`) to convert addresses to lat/lng for census tract lookups.
- Caltrans AADT traffic data API (`lib/funnel/external-data/caltrans.ts`) only covers California state highways (101, 280, etc.), not local streets; uses ArcGIS REST API at `caltrans-gis.dot.ca.gov`.
- LoopNet has no official public API; commercial listings require `LOOPNET_RAPIDAPI_KEY` for RapidAPI integration; without key returns manual search instructions.
- Bright Data MCP integration (`BRIGHTDATA_API_TOKEN`) enables enhanced market research: Google SERP, Zillow listings, Google Maps reviews, LinkedIn company profiles, Crunchbase data.

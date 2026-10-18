# Xtrape Contracts for Node.js

> TypeScript contracts, Zod schemas, and inferred TypeScript types for the
> Xtrape Platform, Connector, and Panel wire protocols.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Status: 0.8 milestone](https://img.shields.io/badge/status-0.8.13-blue.svg)](https://xtrape.com/governance/)
[![Docs](https://img.shields.io/badge/docs-xtrape--docs-blue.svg)](https://xtrape.com/governance/)

## 1. Package Status

The canonical npm package name is:

```bash
@xtrape/contracts
```

The previous package name, `@xtrape/capsule-contracts-node`, is a legacy,
superseded compatibility identity: it is deprecated on npm (all published
versions, latest `0.7.4`, carry a deprecation notice pointing to
`@xtrape/contracts`), and `@xtrape/contracts` is the current canonical
release. `Capsule` is not a current Xtrape concept. Existing `Capsule*`
exports and the legacy `services` wire field remain available until a
versioned protocol migration removes them.

Current milestone release:

```text
package version: 0.8.13
CE contract version: CE_CONTRACT_VERSION = 1
Checkpoint contract version: CHECKPOINT_CONTRACT_VERSION = 1
```

Install:

```bash
pnpm add @xtrape/contracts@^0.8.13
```

For this repository itself:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 2. Contract Authority Boundary

| Name | Role |
|---|---|
| `xtrape-docs` | Owns the platform object model and architecture **semantics**: what the concepts are and how they relate. It does not, by itself, define the byte-exact wire surface. |
| `xtrape-contracts-nodejs` | This repository. The **current wire authority** for the exact published contract surface that has not been migrated elsewhere: the executable TypeScript/Zod schemas define what is accepted and emitted on the wire today. |
| `xtrape-contracts` | The **proposed future** language-neutral cross-language contract authority. The repository is established and in its framework/bootstrap phase (governance and adoption framework under construction in xtrape-contracts#1). An established framework is not a migrated authority: before an accepted adoption/activation, `xtrape-contracts` holds no authority over this surface. |

Each layer stays in its lane. This package should not become a separate
conceptual authority, and `xtrape-docs` does not define wire bytes.

When the executable schemas and the canonical architecture docs disagree, the
divergence is **recorded and resolved through the governed
compatibility/migration process** — a contract-version bump, a compatibility
plan, or an adoption decision, as appropriate. An architecture change does not
implicitly rewrite the current wire authority: docs-side concept changes never
silently alter what this package accepts or emits on the wire.

This package is not:

- a runtime server implementation;
- an HTTP client SDK;
- a database model authority;
- an ID generator;
- a business workflow or AI planner protocol.

## 3. CE Phase 0 Frozen Contracts (0.6/0.7 milestones)

The CE 0.1 Phase 0 runtime loop is:

```text
Telegram / caller -> xtrape-server-ce (now xtrape-platform-ce) -> demo xtrape-service -> reply
```

The frozen Phase 0 contract surface is exported from this package and guarded by
`tests/ce-contracts.spec.ts`.

| Export | Purpose |
|---|---|
| `CE_CONTRACT_VERSION` (`1`) | Version negotiation across Connector / Service / Platform CE. |
| `ServiceManifestSchema` / `ServiceManifest` | Service registration descriptor. |
| `WorkerSchema` / `Worker` (renamed from `ServiceInstanceSchema` / `ServiceInstance` in #99) | The registered runtime entity with a resolvable address. |
| `WorkerHealthSchema` / `WorkerHealth` (renamed from `ServiceInstanceHealthSchema` / `ServiceInstanceHealth` in #99) | Health of one Worker. |
| `ConnectorHeartbeatSchema` / `ConnectorHeartbeat` | Heartbeat and health reporting. |
| `ConversationMessageSchema` / `ConversationMessage` | Explicit-target message route and reply envelope. |
| `ActionAsyncAckSchema` / `ActionAsyncAck` | 202 RUNNING ack for a long-running action execute (server-ce#41 Stage B). |
| `ActionCommandResultSchema` / `ActionCommandResult` | Async action outcome reported back to Platform CE. |
| `ActionResultSchema` / `ActionResult` | Action execute result envelope (`success`/`data`/`message`/`error`). |
| `ActionDisplayListSchema` / `ActionDisplayList` | `data.list` table display (columns, formats, row actions). |
| `ActionDisplayDetailSchema` / `ActionDisplayDetail` | `data.detail` key/value display (fields, formats). |
| `ErrorModelSchema` / `ErrorModel` | Structured CE runtime error envelope. |
| `CeErrorCode` | Phase 0 CE runtime error code constants. |

These schemas are frozen for CE 0.1. Removing fields, renaming fields, changing
requiredness, or changing enum values is a contract change. If such a change is
intentional, bump `CE_CONTRACT_VERSION` and update the surface guard together.

### Controlled Exposure contracts (0.8.5)

Since 0.8.5, `src/checkpoint.ts` (renamed from `src/exposure.ts`, #112 /
xtrape-docs#259) is the Checkpoint contract surface of the Controlled Exposure
design
(`CHECKPOINT_CONTRACT_VERSION = 1`, strict/closed v1): Checkpoint and Resource
identity, Account Token claims, managed access Session state, and the
authorization-decision shapes. It is additive alongside the 0.7.x CE
Action/command surface. Canonical design:
`xtrape-docs/docs/architecture/16-controlled-exposure-and-invocation-authorization.md`
(arch/16).

### Minimal service manifest

```ts
import {
  CE_CONTRACT_VERSION,
  ServiceManifestSchema,
} from "@xtrape/contracts";

const manifest = ServiceManifestSchema.parse({
  contractVersion: CE_CONTRACT_VERSION,
  service: {
    id: "demo-echo-service",
    name: "Demo Echo Service",
    version: "0.7.0",
  },
  runtime: {
    // `agent` is a frozen wire key; its value names the Connector SDK.
    language: "node",
    agent: "xtrape-connector-nodejs",
  },
  capabilities: ["status.query"],
  message: {
    supportedTypes: ["QUERY"],
  },
});
```

### Minimal instance registration

```ts
import {
  CE_CONTRACT_VERSION,
  WorkerSchema,
} from "@xtrape/contracts";

// NOTE: the symbol is `Worker`; the WIRE keys (`instanceId`, and the `instance`
// key of CeRegistrationRequestSchema) are unchanged — see "Worker rename" below.
const worker = WorkerSchema.parse({
  contractVersion: CE_CONTRACT_VERSION,
  serviceId: "demo-echo-service",
  instanceId: "demo-echo-7f3a",
  address: "http://10.0.0.12:8080",
  version: "0.7.0",
  health: "HEALTHY",
});
```

### Minimal explicit-target message

```ts
import {
  CE_CONTRACT_VERSION,
  ConversationMessageSchema,
} from "@xtrape/contracts";

const message = ConversationMessageSchema.parse({
  contractVersion: CE_CONTRACT_VERSION,
  messageId: "msg_001",
  conversationId: "conv_tg_123",
  targetType: "SERVICE",
  targetId: "demo-echo-service",
  senderType: "USER",
  senderId: "telegram:123456",
  messageType: "QUERY",
  content: "status?",
});
```

## 4. Current Export Groups

The package currently exports both the current CE Phase 0 contracts and legacy
compatibility surfaces.

### Current CE runtime contracts

These are the primary contracts for `xtrape-platform-ce`,
`xtrape-connector-nodejs`, `xtrape-demo`, and `xtrape-telegram`:

```text
CE_CONTRACT_VERSION
ServiceManifestSchema
WorkerSchema
ConnectorHeartbeatSchema
ConversationMessageSchema
ErrorModelSchema
CeErrorCode
```

### Legacy / compatibility contracts

The package also exports older Panel / Connector (formerly Agent) /
Command / Audit shapes. These remain available for compatibility, but they are
not the conceptual source of the current Xtrape Platform governance model.

The pre-CE legacy **Worker** face (`WorkerManifest*`, `ReportedWorker*`,
`WorkerRuntimeReport*`, `WorkerReportRequest*`, `WorkerInstance*`, the old
`Worker*` shorthand, `WorkerInstanceDetail*`, `WorkerDetail*`, `WorkerStatus*`
and `ErrorCode.WORKER_CODE_TAKEN`) was **DELETED** in #99 (docs#199 D11). It
misused the canonical name `Worker` for Service and ServiceInstance records
(its `WorkerInstance.id` prefix was `svc_`). `Worker` / `WorkerSchema` are now
the CE runtime entity above.

| Group | Examples |
|---|---|
| Zod re-export | `z` |
| Status enums | `ConnectorStatus`, `HealthStatus`, `CommandStatus`, `DangerLevel`, `AuditActorType`, `AuditResult`, `TokenStatus` |
| Admin | users, sessions, registration token requests/responses |
| Connector (formerly Agent) | registration, heartbeat, service report, command result |
| Service metadata | `ServiceCapabilitySchema`, `EventMetadataSchema`, `ServiceKindSchema` |
| Command / action | action definition, action prepare result, command detail, command result |
| Audit / dashboard | audit event, dashboard summary |
| System | system health, system version |
| Experimental bus | `BusEventEnvelopeSchema`, `PublishBusEventRequestSchema`, `PublishBusEventResponseSchema`, `BusRouteRuleSchema`, `CreateBusRouteRuleRequestSchema` |
| Helpers | `parseSort`, `paginate`, `HttpError`, `ListQueryBase` |

Note on Capability vs Action: the 0.7-heritage `ServiceCapabilitySchema` does
not model the Capability→Action grouping relation. That relation is carried by
the Checkpoint contract surface (`src/checkpoint.ts`); do not infer an object
model for it from `ServiceCapabilitySchema`.

`spec/worker-compatibility-v0.4.json` and the CE v0.1 OpenAPI file are FROZEN
HISTORICAL RECORDS of wire faces that no longer exist in `xtrape-platform-ce`
and whose TypeScript bindings were deleted in #99. Their bytes are left
untouched here; retiring the historical `spec/` artifacts is tracked separately
(docs#199 "historical OpenAPI removal") and is not part of #99.

## 5. Compatibility Notes

### Legacy package and wire names

The following names may still appear in code, changelog, or wire compatibility
surfaces:

```text
Capsule*
capsule
Opstage
ophub
services
svc_
opstage_reg_
opstage_agent_
```

Treat them as compatibility identifiers unless a current architecture document
explicitly reintroduces them as active concepts.

### Worker rename (`ServiceInstance` -> `Worker`)

> **READ THIS BEFORE UPGRADING — `Worker` / `WorkerSchema` were REBOUND, not
> just renamed. A successful compile does NOT mean your code is still correct.**
>
> `Worker` and `WorkerSchema` existed *before* #99 as the pre-CE legacy
> shorthand for `WorkerInstance` (an `svc_`-keyed Service record). #99 deleted
> that binding and then gave the SAME two names to the CE runtime entity
> formerly called `ServiceInstance`. Because the names never disappear from the
> export surface, **an old consumer of the legacy `WorkerSchema` gets no
> missing-export error** — it silently type-checks against a completely
> different schema (`contractVersion` + `serviceId` + `instanceId` + `address`
> + `health`, instead of `id`/`code`/`status`/`healthStatus`), and fails at
> runtime on the first `.parse()`.
>
> Every other deleted symbol in #99 fails loudly at compile time. These two do
> not. If you imported `Worker` or `WorkerSchema` before 0.9.0, re-read the call
> site rather than trusting the build.

Canonical object model (xtrape-docs `concepts/09`, closed by docs#199 D13):

```text
Interaction Layer  n : 1  Platform
Platform           1 : n  Service
Service            1 : n  Worker
```

A **Worker** is the entity that actually runs and registers. A **Service** is a
logical grouping / task entry that the Platform creates when the FIRST Worker
completes registration; later Workers presenting the same token join it. There
is no separate "Service Instance" entity — the record this package used to call
`ServiceInstance` IS a Worker, so #99 renamed the symbols.

**Only TypeScript symbols were renamed. Wire keys are unchanged:**

| Wire byte | Status |
|---|---|
| `instanceId` (field of `WorkerSchema`) | unchanged |
| `instance` (key of `CeRegistrationRequestSchema`) | unchanged |
| `instanceId` (field of `CeRegistrationResponseSchema`, `ConnectorHeartbeatSchema`) | unchanged |
| `serviceInstanceRef` (exposure face) | unchanged, out of #99 scope |

Renaming those keys is a `contractVersion` migration with a dual-accept window
and a coordinated redeploy, not a symbol swap; it is deliberately deferred to
its own design issue.

### Connector mode removed (this one CHANGES PARSE RESULTS)

`ConnectorMode` / `ConnectorModeSchema` (and the `AgentMode*` aliases), the
`mode` field of `ConnectorSchema` and of the registration request, and the
`agentMode` manifest field were **removed** in #99 (docs#199 D2). There is no
ophub mode any more — every Widget deploys independently — so the concept, not
just one of its values, is gone.

**Do not file this under "symbol renames".** Unlike the wire-neutral
`ServiceInstance` -> `Worker` rename above, this one narrows what the schemas
produce:

```ts
RegisterConnectorRequestSchema.parse({
  registrationToken: "opstage_reg_example",
  agent: { code: "a", mode: "embedded", runtime: "nodejs" },
}).agent;
// before #99 -> { code: "a", mode: "embedded", runtime: "nodejs" }
// after  #99 -> { code: "a", runtime: "nodejs" }        // `mode` STRIPPED
```

The wrapper is not `strict`, so an inbound `mode` is **tolerated but dropped**
rather than rejected — senders do not break, but any reader of
`parsed.agent.mode` now reads `undefined`. `ConnectorSchema.mode` is likewise
gone from the parsed record. `tests/schema-validation.spec.ts` pins this
behavior.

## 6. Common Validation Examples

### Connector registration (formerly "Agent registration")

```ts
import { RegisterConnectorRequestSchema } from "@xtrape/contracts";

const request = RegisterConnectorRequestSchema.parse({
  registrationToken: "opstage_reg_example",
  // `agent` is a frozen wire payload key (Connector identity).
  agent: {
    code: "embedded-connector-a",
    runtime: "nodejs",
  },
});
```

`RegisterAgentRequestSchema` was deleted in #99 (docs#199 D11).
Lowercase aliases remain available for backend compatibility:

```ts
import { registerConnectorRequestSchema } from "@xtrape/contracts";

const request = registerConnectorRequestSchema.parse(input);
```

### Service report

```ts
import { ServiceReportRequestSchema } from "@xtrape/contracts";

const report = ServiceReportRequestSchema.parse({
  services: [
    {
      code: "demo-worker",
      name: "Demo Worker",
      version: "0.7.0",
      runtime: "nodejs",
      // `manifest` is opaque JSON on this face; the typed legacy
      // `WorkerManifestSchema` binding was deleted in #99.
      manifest: {
        code: "demo-worker",
        name: "Demo Worker",
        version: "0.7.0",
        runtime: "nodejs",
        capabilities: [{ name: "status.query", label: "Status query" }],
      },
    },
  ],
});
```

### Health report

```ts
import { HealthReportInputSchema } from "@xtrape/contracts";

const health = HealthReportInputSchema.parse({
  status: "UP",
  message: "ok",
  details: { uptimeSeconds: 123 },
});
```

Protocol-level `HealthStatus` values are:

```text
UP
DEGRADED
DOWN
UNKNOWN
```

Panel or Platform implementations may derive separate operator-facing states such
as `HEALTHY`, `UNHEALTHY`, `STALE`, or `OFFLINE`.

### Config and action definitions

```ts
import {
  ActionDefinitionInputSchema,
  ConfigItemInputSchema,
} from "@xtrape/contracts";

const config = ConfigItemInputSchema.parse({
  key: "UPSTREAM_BASE_URL",
  type: "string",
  sensitive: false,
  valuePreview: "https://api.example.test",
});

const action = ActionDefinitionInputSchema.parse({
  name: "reload-cache",
  label: "Reload Cache",
  dangerLevel: "MEDIUM",
  requiresConfirmation: true,
});
```

### Action prepare result

```ts
import { ActionPrepareResultSchema } from "@xtrape/contracts";

const prepare = ActionPrepareResultSchema.parse({
  initialPayload: { message: "hello" },
  currentState: { service: "ready" },
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", default: "hello" },
    },
  },
});
```

### Command result

```ts
import { ReportCommandResultRequestSchema } from "@xtrape/contracts";

const result = ReportCommandResultRequestSchema.parse({
  success: true,
  message: "Done",
  data: { count: 1 },
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
});
```

Failed results should include an operator-safe message and structured error:

```ts
ReportCommandResultRequestSchema.parse({
  success: false,
  message: "Provider challenge page detected.",
  error: {
    code: "ACTION_FAILED",
    retryable: false,
  },
});
```

## 7. Experimental Legacy Event Routing

The v0.4 event routing surface is experimental and compatibility-oriented. It
models a small CE in-process event-to-command router. It is not a standalone bus
server, external broker abstraction, workflow DSL, service mesh, distributed
event system, or fan-out engine.

Key exports:

```text
BusEventEnvelopeSchema
PublishBusEventRequestSchema
PublishBusEventResponseSchema
BusRouteRuleSchema
CreateBusRouteRuleRequestSchema
BusErrorCode
```

Minimal event payload:

```ts
import { BusEventEnvelopeSchema } from "@xtrape/contracts";

BusEventEnvelopeSchema.parse({
  eventType: "demo.item.created",
  sourceServiceCode: "demo-worker",
  payload: { itemId: "item-1" },
});
```

All schemas include or default:

```text
experimental: "v0.4-experimental"
```

Consumers should treat this wire surface as unstable until v1.0.

## 8. Error Codes

The legacy `ErrorCode` export contains protocol-level error constants currently
used by CE and SDKs:

```ts
import { ErrorCode } from "@xtrape/contracts";

throw new Error(ErrorCode.VALIDATION_FAILED);
```

Current values include:

```text
INTERNAL_ERROR
VALIDATION_FAILED
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
CONFLICT
CSRF_INVALID
ACTION_REQUIRES_CONFIRMATION
COMMAND_EXPIRED
TOKEN_REVOKED
TOKEN_EXPIRED
AGENT_REVOKED
AGENT_DISABLED
```

### Historical spec values NOT exported by `ErrorCode`

These codes still appear in the frozen `spec/` records but have **no member on
the `ErrorCode` export**. Do not expect `ErrorCode.X` to resolve for them.

| Wire value | Where it still lives | Why it is not exported |
|---|---|---|
| `CAPSULE_SERVICE_CODE_TAKEN` | `spec/errors.json`, `spec/errors.md`, `spec/worker-compatibility-v0.4.json` (`ownership.conflictErrorCode`) | It was emitted only by the pre-CE legacy Worker registration face, whose TypeScript bindings — including the `ErrorCode.WORKER_CODE_TAKEN` member — were deleted in #99. The `spec/` bytes are a historical record and were deliberately left untouched. |

`BusErrorCode.BUS_DISABLED` is the opposite case: its wire VALUE is also the
legacy `"CAPSULE_BUS_DISABLED"`, but the Bus surface survives, so that member
is still exported (and pinned by `tests/bus.spec.ts`).

For CE Phase 0 runtime errors, prefer `CeErrorCode` with `ErrorModelSchema`.

## 9. ID Generation

This package validates IDs at the wire boundary but does **not** mint IDs.

`newId()`, `idPrefixes`, and `IdPrefix` were removed in `0.2.0` because runtime
ID generation does not belong in the contracts package. Consumers that need
local ID generation should provide their own factory.

Documented compatibility prefixes include:

```text
wks_
usr_
agt_
tok_
svc_
hlr_
cfg_
act_
cmd_
crs_
aud_
```

Individual schemas enforce prefixes where needed with Zod validators such as
`z.string().startsWith(...)`.

## 10. List Helpers

```ts
import {
  ListQueryBase,
  paginate,
  parseSort,
} from "@xtrape/contracts";

const query = ListQueryBase.parse({ page: "1", pageSize: "20" });
const sort = parseSort("-createdAt", ["createdAt", "name"]);
const response = paginate(items, query.page, query.pageSize, total);
```

These helpers are provisional convenience utilities for backend-style consumers.
They may move out of the contracts package in a future minor version.

## 11. Schema Stability

The package follows semver. Before `1.0.0`, pin matching
minor versions across Platform CE, the Connector SDK, and Contracts.

| Group | Stability | Notes |
|---|---:|---|
| CE Phase 0 contracts | Frozen for CE 0.1 | Changes require `CE_CONTRACT_VERSION` and surface guard updates. |
| Status enums | Stable | Existing values should not be removed before v1.0. New values may be added in minor versions. |
| Connector (formerly Agent) / Platform wire schemas | Evolving | Additive optional fields may land in minor versions. |
| Persisted/read-only shapes | Evolving | Useful for consumers, but track CE storage and should be read as provisional. |
| Action prepare / command result | Provisional | May tighten before v1.0. |
| Experimental bus contracts | Experimental | Not a stable data-plane or broker contract. |
| Helpers | Provisional | Not strictly part of the wire spec. |

Breaking or incompatible changes are recorded in `CHANGELOG.md`.

## 12. Current Planning

Current planning follows the 0.8.x train. The Checkpoint contract surface
(`src/checkpoint.ts`, `CHECKPOINT_CONTRACT_VERSION = 1`) landed in slices:
part 1 (0.8.5: Checkpoint / Resource identity), part 2 slices A/B/C1
(identity, policy model, reviewed scope / decision / audit), C2 (0.8.8: the
§10 durable workflow objects and the §8.1 confirmation control), and B2
(0.8.9: System Exposure Rule and Account Entitlement baselines, grant
lifetime / use-count carriers, per-layer provenance with the per-axis
contribution-XOR-blocker invariant). The arch/16 §17.2 landing list for the
first implementation round is therefore complete on the contracts side.

Next steps are consumer-driven and tracked on the Platform, not here: the
deterministic evaluator and policy-surface persistence
(xtrape-platform-ce#113), the Challenge / Approval / Grant lifecycle
(xtrape-platform-ce#114), and the governed invocation APIs
(xtrape-platform-ce#116). Contract changes they surface arrive as further
slices against contracts#59 / contracts#60, whose recorded follow-ups
(Go/Java conformance, record internals, whole-definition digest, the
declarative extraction DSL, Service-to-Service delegation) remain the
open contract-side backlog.

### Historical: 0.7.0 planning

The following 0.7.0 planning content is retained as historical context; the
0.7.x train is complete.

Active 0.7.0 planning focused on service governance contracts, not AI task
routing or Studio-specific workflow contracts.

Core 0.7.0 directions were:

```text
service governance
configuration
credential references
policy / approval requirement
explicit invocation boundary
audit / trace
operator-facing read models
```

Out of scope for the core 0.7.0 contract surface were:

```text
intelligent service selection
business intent routing
AI planner protocol
complete workflow engine
service-to-service data plane
marketplace / paid transaction contracts
production deployment orchestration
```

The historical Forgejo tracking issue was:

```text
#30 0.7.0: define service governance, configuration, policy, credential, invocation, and audit contracts
```

## 13. Used By

- `xtrape-platform-ce` — Platform CE headless runtime and control-plane implementation.
- `xtrape-connector-nodejs` — Node.js Connector SDK request/response validation.
- `xtrape-demo` — end-to-end runnable demo service.
- `xtrape-telegram` — Telegram adapter over Platform message APIs.
- `xtrape-panel-ce` — operator UI consumer of Platform/contract surfaces.
- Service implementations that want local validation before reporting
  to Xtrape runtime components.

## 14. Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Package outputs:

```text
dist/index.js
dist/index.cjs
dist/index.d.ts
```

Published package files include:

```text
dist
spec
README.md
LICENSE
NOTICE
```

## 15. Documentation

Current canonical docs:

- `xtrape-docs/docs/architecture/11-xtrape-ce-system-baseline.md`
- `xtrape-docs/docs/runtime-platform/01-phase-0-runtime-mvp.md`
- `xtrape-docs/docs/runtime-platform/02-service-manifest-schema.md`
- `xtrape-docs/docs/runtime-platform/03-message-protocol-schema.md`
- `xtrape-docs/docs/runtime-platform/04-agent-registration-heartbeat.md`
- `xtrape-docs/docs/runtime-platform/05-server-ce-module-design.md`

Historical public docs may still mention Opstage or Capsule names. Treat those as
compatibility references unless later architecture docs explicitly reintroduce
the terms.

## 16. Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for schema change workflow and PR
checks. See [SECURITY.md](./SECURITY.md) for vulnerability reporting and
contract validation safety guidance.

## 17. License

Apache-2.0. "Xtrape" and "Opstage" are trademarks of their respective owners;
the open-source license does not grant trademark rights.

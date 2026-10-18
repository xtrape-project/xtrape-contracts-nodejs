import { z } from "zod";

/**
 * Xtrape CE runtime contracts (Phase 0).
 *
 * CE-shape contracts described in xtrape-docs runtime-platform/02..04. They
 * coexist with the pre-CE legacy contracts in ./index and are versioned
 * via `contractVersion`. See:
 *   - runtime-platform/02-service-manifest-schema
 *   - runtime-platform/03-message-protocol-schema
 *   - runtime-platform/04-agent-registration-heartbeat
 */

export const CE_CONTRACT_VERSION = 1 as const;

/** kebab-case service id, e.g. `demo-echo-service` */
const ServiceId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case service id");

const Json = z.record(z.any());

/** Any JSON value (scalar or structured). Unlike `Json` (object-only), this
 * accepts a bare string/number so a scalar secret or redacted value is valid. */
type JsonValueT = string | number | boolean | null | JsonValueT[] | { [k: string]: JsonValueT };
const JsonValue: z.ZodType<JsonValueT> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(JsonValue)]),
);

// ---- Enums ----------------------------------------------------------------

/** Health of one Worker (docs#199 D13 — this enum belongs to the registered
 * runtime entity, so it is renamed with it). Wire VALUES are unchanged. */
export const WorkerHealth = ["HEALTHY", "DEGRADED", "UNREACHABLE"] as const;
export const WorkerHealthSchema = z.enum(WorkerHealth);
export type WorkerHealth = (typeof WorkerHealth)[number];

export const ConversationTargetType = ["SERVICE", "TASK", "USER", "SYSTEM"] as const;
export const ConversationTargetTypeSchema = z.enum(ConversationTargetType);
export type ConversationTargetType = (typeof ConversationTargetType)[number];

export const MessageSenderType = ["USER", "SERVICE", "SYSTEM"] as const;
export const MessageSenderTypeSchema = z.enum(MessageSenderType);
export type MessageSenderType = (typeof MessageSenderType)[number];

export const MessageType = [
  "TEXT",
  "QUERY",
  "COMMAND",
  "SUMMARY",
  "APPROVAL_REQUEST",
  "APPROVAL_RESPONSE",
] as const;
export const MessageTypeSchema = z.enum(MessageType);
export type MessageType = (typeof MessageType)[number];

// ---- ServiceManifest (asset-form descriptor) ------------------------------
// runtime-platform/02. Phase 0 minimal core + optional extras. `passthrough`
// keeps forward-compatible additive fields (e.g. console, security) tolerated.

export const ServiceManifestSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    tenant: z.string().default("default"),
    service: z.object({
      id: ServiceId,
      name: z.string().min(1),
      version: z.string().min(1),
      description: z.string().optional(),
    }),
    owner: z
      .object({ organization: z.string().optional(), maintainer: z.string().optional() })
      .optional(),
    runtime: z.object({
      language: z.string().min(1),
      // `agent` is a frozen wire key; its value names the Connector SDK/runtime.
      agent: z.string().min(1),
      // declared template; the real address is reported by the instance on register
      endpoint: z.string().url().optional(),
    }),
    /**
     * Self-reported build identity (owner ruling on platform-ce#253;
     * arch/16 §17.1 item 10). `artifactDigest` is a sha-256 over a canonical
     * manifest of the code this Worker RUNS — the same construction the
     * Platform applies to itself — computed at startup, `sha256:<64 hex>`.
     *
     * Round-1 trust level is SELF-REPORTED: the Platform admits the digest
     * as the target's artifact identity because the deployment operator ran
     * this code, not because anything attests to it. The recorded evolution
     * (self-reported → asset-library issuance → anchor) replaces the TRUST
     * SOURCE of this value in later rounds; the field's shape stays fixed.
     *
     * Optional on the wire because non-governed Services have no admission
     * to feed; the PLATFORM refuses to admit a GOVERNED registration that
     * omits it (fail-closed — an absent fact is not an admitted fact), so
     * for a governed Widget it is effectively required.
     */
    build: z
      .object({
        artifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict()
      .optional(),
    // business-semantic capabilities (Capability), e.g. "status.query"
    capabilities: z.array(z.string().min(1)).min(1),
    // platform feature toggles (not business semantics)
    features: z.record(z.boolean()).optional(),
    message: z.object({ supportedTypes: z.array(MessageTypeSchema).min(1) }),
    // structured triggers; kept loose for Phase 0
    triggers: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  })
  .passthrough();
export type ServiceManifest = z.infer<typeof ServiceManifestSchema>;

// ---- Worker (runtime form) -------------------------------------------------
// runtime-platform/04. The registered/reported runtime entity with a resolvable
// address. Named `ServiceInstance` until #99; docs#199 D13 closed that open
// decision: the thing that registers IS the Worker, and a Service is the logical
// grouping / task entry the Platform creates when the FIRST Worker completes
// registration. "Service Instance" is not a separate entity.
//
// WIRE KEYS ARE UNCHANGED BY THIS RENAME. `instanceId`, and the `instance` key
// of CeRegistrationRequestSchema below, are still the bytes on the wire; they
// are pending a separate `contractVersion` bump (see README "Worker rename").

export const WorkerSchema = z.object({
  contractVersion: z.literal(CE_CONTRACT_VERSION),
  serviceId: ServiceId,
  instanceId: z.string().min(1),
  tenant: z.string().default("default"),
  address: z.string().url(),
  version: z.string().min(1),
  health: WorkerHealthSchema,
  startedAt: z.string().optional(),
  lastHeartbeatAt: z.string().optional(),
  /**
   * Capability negotiation for the per-instance callback credential
   * (docs#122): true means this Connector ADOPTS the `callbackToken` returned by
   * registration and will enforce it on inbound calls. A Platform must present
   * the derived per-instance token ONLY to instances that declared this —
   * presenting it to an older Connector that still enforces its statically
   * configured secret would 401 every dial. Absent (older SDKs) means the
   * Platform keeps its previous credential behavior for this instance.
   */
  supportsCallbackToken: z.boolean().optional(),
});
export type Worker = z.infer<typeof WorkerSchema>;

// ---- ConversationMessage --------------------------------------------------
// runtime-platform/03. `messageId` dedups delivery; `idempotencyKey` guards
// execution-type commands at the Run level.

export const ConversationMessageSchema = z.object({
  contractVersion: z.literal(CE_CONTRACT_VERSION),
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  tenant: z.string().default("default"),
  targetType: ConversationTargetTypeSchema,
  targetId: z.string().min(1),
  senderType: MessageSenderTypeSchema,
  senderId: z.string().min(1),
  messageType: MessageTypeSchema,
  content: z.string(),
  payload: Json.optional(),
  replyToMessageId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  metadata: Json.optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// ---- ConnectorHeartbeat ----------------------------------------------------
// runtime-platform/04. Renamed from AgentHeartbeat by contracts-nodejs#93; the
// `Agent*` aliases were deleted by #99 (docs#199 D11). Wire field names and
// values are frozen.

export const ConnectorHeartbeatSchema = z.object({
  contractVersion: z.literal(CE_CONTRACT_VERSION),
  serviceId: ServiceId,
  instanceId: z.string().min(1),
  tenant: z.string().default("default"),
  ts: z.string(),
  health: WorkerHealthSchema,
  metricsSummary: Json.optional(),
});
export type ConnectorHeartbeat = z.infer<typeof ConnectorHeartbeatSchema>;

// ---- Async action completion (server-ce#41 Stage B) ------------------------
// A long-running worker action may accept the pushed execute with HTTP 202 +
// ActionAsyncAck (command stays RUNNING on the Platform), then later report the
// outcome to POST /v1/instances/:instanceId/commands/:commandId/result using
// its per-instance access token. Synchronous actions keep replying 200 with
// the raw result body — the ack/result envelope is only for the async path.

export const ActionAsyncAckSchema = z.object({
  contractVersion: z.literal(CE_CONTRACT_VERSION),
  status: z.literal("RUNNING"),
  commandId: z.string().min(1),
});
export type ActionAsyncAck = z.infer<typeof ActionAsyncAckSchema>;

/**
 * The result of a REVIEW command (xtrape-docs#288, runtime-platform/13 §5.1) —
 * the contracts-fixed envelope a two-phase Action answers its review step with.
 * `inputSchema` is validated by the Platform as a NARROWING of the admitted
 * execution schema, `initialPayload` against that schema and its sensitivity
 * map (no sensitive path may be prefilled), `currentState` against the
 * Checkpoint's `review.outputSchema`. The Widget seals its review binding into
 * `initialPayload` (opaque to the Platform). A review has no side effect.
 */
export const ReviewNextSchema = z
  .object({
    inputSchema: Json,
    initialPayload: Json,
    currentState: Json,
  })
  .strict();
export type ReviewNext = z.infer<typeof ReviewNextSchema>;

/** What `ActionCommandResult.result` MUST be on a REVIEW command: `{ next }` and nothing else. */
export const ReviewCommandResultSchema = z.object({ next: ReviewNextSchema }).strict();
export type ReviewCommandResult = z.infer<typeof ReviewCommandResultSchema>;

/**
 * arch/16 §8.1 candidate exchange, run INSIDE a review command: the Service
 * submits the candidate Resource identifiers it would offer; the Platform
 * re-normalizes each under the admitted Resource contract, rejects what does
 * not normalize, intersects the rest with the session's effective
 * authorization, and answers with what may be presented. The Service builds
 * its enum from `admitted` and nothing else; the caller never sees the
 * unfiltered list.
 */
export const CandidateResourceFilterRequestSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    commandId: z.string().min(1),
    candidates: z.array(z.string().min(1)).max(1000),
  })
  .strict();
export type CandidateResourceFilterRequest = z.infer<typeof CandidateResourceFilterRequestSchema>;
export const CandidateResourceFilterResponseSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    commandId: z.string().min(1),
    /** the submitted identifiers (verbatim) that normalized AND are authorized for this session — possibly empty. */
    admitted: z.array(z.string().min(1)),
  })
  .strict();
export type CandidateResourceFilterResponse = z.infer<typeof CandidateResourceFilterResponseSchema>;

/** One complete candidate exchange (runtime-platform/13 §4.3). The response is
 * a FILTER of the request, never a different set: same command, every
 * `admitted` value was submitted, no duplicates on either side, and therefore
 * `admitted.length <= candidates.length`. The conformance/runtime validator
 * when request and response are available together (the AckDeliveriesExchange
 * pattern). */
export const CandidateResourceFilterExchangeSchema = z
  .object({
    request: CandidateResourceFilterRequestSchema,
    response: CandidateResourceFilterResponseSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.request.commandId !== value.response.commandId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["response", "commandId"], message: "candidate filter response answers a different command" });
    }
    const submitted = new Set<string>();
    for (const [index, id] of value.request.candidates.entries()) {
      if (submitted.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["request", "candidates", index], message: "duplicate candidate" });
      submitted.add(id);
    }
    const seen = new Set<string>();
    for (const [index, id] of value.response.admitted.entries()) {
      if (!submitted.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["response", "admitted", index], message: "admitted identifier was not submitted — the Platform filters the Service's candidates, it does not invent a set" });
      if (seen.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["response", "admitted", index], message: "duplicate admitted identifier" });
      seen.add(id);
    }
  });
export type CandidateResourceFilterExchange = z.infer<typeof CandidateResourceFilterExchangeSchema>;

export const ActionCommandResultSchema = z.object({
  contractVersion: z.literal(CE_CONTRACT_VERSION),
  commandId: z.string().min(1),
  status: z.enum(["COMPLETED", "FAILED"]),
  result: Json.optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type ActionCommandResult = z.infer<typeof ActionCommandResultSchema>;

// ---- Durable command lifecycle (contracts#50, docs runtime-platform/09 §6) --
//
// The command kernel is uniformly asynchronous at the semantic layer: every
// dispatch persists a command; the result arrives on a separate round trip and
// moves it to a terminal state. "Synchronous" is only the Platform's bounded wait
// for a fast command (see CommandDispatchResponse). The per-action `async` flag
// is deprecated (transport is always async). Long-poll provisioning, poll/ack
// and `waitMs` belong to 0.7.4 (#48) and are intentionally absent here.
//
// State-machine invariants (terminal immutability, failure-reason presence,
// legal cancel/delivery combinations) are FROZEN in these schemas via
// discriminated unions + `.strict()`, not left to prose — so Platform, Connector,
// Panel and Demo implement one machine, not four.

/**
 * Command execution states. The four current states are preserved for
 * compatibility; a FAILED command carries a `failureReason` to distinguish an
 * ordinary error from a self-declared-bound TIMEOUT (never a Platform judgment,
 * xtrape-docs#242) or a CANCELLED command, so the state set stays stable (no
 * new enum members old consumers can't read).
 * PREPARED and RUNNING are non-terminal; COMPLETED and FAILED are TERMINAL and
 * immutable — once reached, later reports for the same command are no-ops.
 */
export const CeCommandStatus = ["PREPARED", "RUNNING", "COMPLETED", "FAILED"] as const;
export const CeCommandStatusSchema = z.enum(CeCommandStatus);
export type CeCommandStatus = (typeof CeCommandStatus)[number];

export const CeCommandTerminalStatus = ["COMPLETED", "FAILED"] as const;
export const CeCommandTerminalStatusSchema = z.enum(CeCommandTerminalStatus);
export type CeCommandTerminalStatus = (typeof CeCommandTerminalStatus)[number];

/** Why a command reached FAILED. ERROR = the action itself failed;
 * TIMEOUT = a bound the REPORTER itself declared elapsed — a task's own
 * `timeout`, a service-side budget — reported honestly as such. It is never
 * a Platform judgment: nothing on the Platform or the Connector ends a
 * command by elapsed time (xtrape-docs#242, contracts#14);
 * CANCELLED = an explicitly relayed cancel took effect. */
export const CommandFailureReason = ["ERROR", "TIMEOUT", "CANCELLED"] as const;
export const CommandFailureReasonSchema = z.enum(CommandFailureReason);
export type CommandFailureReason = (typeof CommandFailureReason)[number];

/**
 * Dispatch (execute) request. `idempotencyKey` gives the command a stable
 * identity across retries: re-dispatching the same key with the SAME
 * action+`input` returns the same command (its current state), rather than
 * creating a duplicate. Re-using a key with a DIFFERENT action or `input` is a
 * stable conflict — the Platform rejects it (`VALIDATION_FAILED`) instead of
 * silently returning the original command. The key is scoped per issuing
 * caller identity. `input` is the opaque action payload.
 */
export const CommandDispatchRequestSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    input: Json.optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict();
export type CommandDispatchRequest = z.infer<typeof CommandDispatchRequestSchema>;

/**
 * Hard ceiling on a sensitive result's delivery lifetime. The Connector may only
 * REQUEST a TTL up to this bound; the Platform clamps to it and sets the
 * authoritative `expiresAt`. Every consumer shares this constant so
 * "short-lived" means the same thing everywhere. Deploy config may tighten
 * within this max, NEVER widen it. Kept well under 2^31 (safe-integer seconds).
 */
export const SENSITIVE_TTL_MAX_SECONDS = 3600 as const; // 1 hour
/** Delivery lifetime applied when the Connector requests none. */
export const SENSITIVE_TTL_DEFAULT_SECONDS = 300 as const; // 5 minutes

// --- Terminal outcome, invariants enforced ---------------------------------
// COMPLETED forbids failureReason; FAILED requires it. Sensitive results are
// always COMPLETED and never carry a generic plaintext `result` (see below).

const OrdinaryCompletedFields = {
  contractVersion: z.literal(CE_CONTRACT_VERSION),
  commandId: z.string().min(1),
  status: z.literal("COMPLETED"),
  sensitive: z.literal(false).optional(),
  result: Json.optional(),
} as const;

const FailedFields = {
  contractVersion: z.literal(CE_CONTRACT_VERSION),
  commandId: z.string().min(1),
  status: z.literal("FAILED"),
  failureReason: CommandFailureReasonSchema, // REQUIRED on FAILED
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
} as const;

// A sensitive result is split by DIRECTION so plaintext can never leak on a
// durable/public projection:
//
//   SensitiveReportFields (Connector → Platform, ONE authoritative report) carries
//     the ephemeral `secret` together with the durable `redacted` view;
//   SensitiveProjectionFields (Platform → caller: terminal/dispatch/public
//     projection) carries ONLY `redacted` + the Platform-clamped `expiresAt` —
//     no `secret`. Plaintext is delivered solely by the scoped, consume-once
//     `SensitiveConsumeResponse.DELIVERED` arm.
//
// Both arms are COMPLETED and omit the generic `result` field (`.strict()`), so
// plaintext can neither ride an ordinary result nor a bounded-sync response.
const SensitiveReportFields = {
  contractVersion: z.literal(CE_CONTRACT_VERSION),
  commandId: z.string().min(1),
  status: z.literal("COMPLETED"),
  sensitive: z.literal(true),
  redacted: JsonValue, // safe, durably persisted
  secret: JsonValue, // plaintext; delivered once, NEVER durably stored
  /** The Connector may REQUEST a delivery lifetime up to SENSITIVE_TTL_MAX_SECONDS;
   * the Platform clamps it and sets the authoritative expiry. The Connector does NOT
   * choose the consumer (Platform-authoritative) nor pin an arbitrary expiry. */
  requestedTtlSeconds: z.number().int().positive().max(SENSITIVE_TTL_MAX_SECONDS).optional(),
} as const;

const SensitiveProjectionFields = {
  contractVersion: z.literal(CE_CONTRACT_VERSION),
  commandId: z.string().min(1),
  status: z.literal("COMPLETED"),
  sensitive: z.literal(true),
  redacted: JsonValue, // safe, durably persisted — the ONLY payload here
  expiresAt: z.string().datetime(), // Platform-set (clamped) delivery deadline
} as const;

/** A command's terminal outcome inline in a bounded-sync dispatch or a
 * durable/public projection. The sensitive arm carries ONLY the redacted view
 * + delivery deadline — never the plaintext `secret` (see the consume path). */
export const CommandTerminalResultSchema = z.union([
  z.object(OrdinaryCompletedFields).strict(),
  z.object(FailedFields).strict(),
  z.object(SensitiveProjectionFields).strict(),
]);
export type CommandTerminalResult = z.infer<typeof CommandTerminalResultSchema>;

/**
 * Result reported by the assigned Connector/instance (Connector → Platform on World A;
 * on the long-poll response on World B — phase 3+). Idempotent on `commandId`;
 * `instanceId` binds the result to the owning instance (claim/ownership) — the
 * Platform rejects a report from any other instance (OWNERSHIP_MISMATCH). The
 * sensitive arm here — and ONLY here — carries the ephemeral `secret`.
 */
export const CommandResultReportSchema = z.union([
  z.object({ ...OrdinaryCompletedFields, instanceId: z.string().min(1) }).strict(),
  z.object({ ...FailedFields, instanceId: z.string().min(1) }).strict(),
  z.object({ ...SensitiveReportFields, instanceId: z.string().min(1) }).strict(),
]);
export type CommandResultReport = z.infer<typeof CommandResultReportSchema>;

/**
 * The Platform's response to a result report. Freezes duplicate/late/ownership
 * behavior on the wire: APPLIED = accepted; ALREADY_TERMINAL = the command was
 * already terminal, this report is a no-op (idempotent); UNKNOWN_COMMAND;
 * OWNERSHIP_MISMATCH = a different instance than the command's owner reported.
 */
export const CommandResultReportOutcome = ["APPLIED", "ALREADY_TERMINAL", "UNKNOWN_COMMAND", "OWNERSHIP_MISMATCH"] as const;
export const CommandResultReportOutcomeSchema = z.enum(CommandResultReportOutcome);
export type CommandResultReportOutcome = (typeof CommandResultReportOutcome)[number];

// outcome↔status combinations frozen: an accepted or already-terminal report
// resolves to a terminal status; a rejected report (unknown command / wrong
// owner) carries no status (there is no authoritative state to report).
export const CommandResultReportResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("APPLIED"), status: CeCommandTerminalStatusSchema }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("ALREADY_TERMINAL"), status: CeCommandTerminalStatusSchema }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("UNKNOWN_COMMAND") }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("OWNERSHIP_MISMATCH") }).strict(),
]);
export type CommandResultReportResponse = z.infer<typeof CommandResultReportResponseSchema>;

/**
 * Progress event for a long-running command (optional liveness/telemetry).
 * `seq` is monotonic per command; `(commandId, seq)` is the ordering AND dedup
 * key. `instanceId` binds it to the owning instance, symmetric with the result
 * report (so World B need not rely on a fixed URL path for the binding).
 */
export const CommandProgressSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    commandId: z.string().min(1),
    instanceId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    message: z.string().optional(),
    payload: Json.optional(),
    at: z.string().datetime().optional(),
  })
  .strict();
export type CommandProgress = z.infer<typeof CommandProgressSchema>;

/**
 * The RUNNING ack of a bounded-sync dispatch — the same shape as the existing
 * `ActionAsyncAck` (reused, not duplicated), aliased under the lifecycle name.
 */
export const CommandRunningAckSchema = ActionAsyncAckSchema;
export type CommandRunningAck = ActionAsyncAck;

/**
 * Bounded-sync dispatch response: a terminal result within the window (inline),
 * or still RUNNING and observed later by `commandId`. The caller observes the
 * PLATFORM's command state, never the Connector directly.
 */
export const CommandDispatchResponseSchema = z.union([
  CommandTerminalResultSchema,
  CommandRunningAckSchema,
]);
export type CommandDispatchResponse = z.infer<typeof CommandDispatchResponseSchema>;

/** Operator/API request to cancel a RUNNING command. */
export const CommandCancelRequestSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    commandId: z.string().min(1),
    reason: z.string().optional(),
  })
  .strict();
export type CommandCancelRequest = z.infer<typeof CommandCancelRequestSchema>;

/**
 * Cancel outcome, with the legal status combinations frozen:
 * CANCELLING (still RUNNING, cancel delivered) → status RUNNING;
 * ALREADY_TERMINAL (no-op, idempotent) → a terminal status;
 * UNKNOWN_COMMAND → no status.
 */
export const CommandCancelOutcome = ["CANCELLING", "ALREADY_TERMINAL", "UNKNOWN_COMMAND"] as const;
export const CommandCancelOutcomeSchema = z.enum(CommandCancelOutcome);
export type CommandCancelOutcome = (typeof CommandCancelOutcome)[number];

export const CommandCancelResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("CANCELLING"), status: z.literal("RUNNING") }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("ALREADY_TERMINAL"), status: CeCommandTerminalStatusSchema }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("UNKNOWN_COMMAND") }).strict(),
]);
export type CommandCancelResponse = z.infer<typeof CommandCancelResponseSchema>;

// ---- Sensitive / one-time command results (contracts#50, server-ce#86) ------
//
// Secrets returned by actions (API keys, reset credentials, one-time tokens)
// must never land in ordinary durable command history and must not rely on
// Panel-only redaction. The Connector declares sensitivity in the ONE authoritative
// result report (SensitiveCompleted arm above): the durable command result
// stores only `redacted`, while `secret` is delivered once through the consume
// path below. The intended consumer and the delivery lifetime are
// PLATFORM-AUTHORITATIVE — the Platform derives the consumer from the command's
// authenticated origin and clamps the expiry; the Connector cannot target another
// operator/service/instance or pin an arbitrary far expiry.

/** Who a sensitive result may be delivered to. SET BY THE PLATFORM (from the
 * command's authenticated origin), never chosen by the Connector payload. */
export const SensitiveConsumerKind = ["OPERATOR", "SERVICE", "INSTANCE"] as const;
export const SensitiveConsumerKindSchema = z.enum(SensitiveConsumerKind);
export type SensitiveConsumerKind = (typeof SensitiveConsumerKind)[number];

export const SensitiveConsumerSchema = z
  .object({ kind: SensitiveConsumerKindSchema, id: z.string().min(1) })
  .strict();
export type SensitiveConsumer = z.infer<typeof SensitiveConsumerSchema>;

/**
 * The durable, re-readable delivery state — Platform-authored, `.strict()`, and it
 * NEVER contains the plaintext. Field sets are frozen per status: PENDING/EXPIRED
 * carry no `consumedAt`; CONSUMED requires it.
 */
export const SensitiveDeliveryStatus = ["PENDING", "CONSUMED", "EXPIRED"] as const;
export const SensitiveDeliveryStatusSchema = z.enum(SensitiveDeliveryStatus);
export type SensitiveDeliveryStatus = (typeof SensitiveDeliveryStatus)[number];

export const SensitiveDeliveryStateSchema = z.discriminatedUnion("status", [
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), status: z.literal("PENDING"), consumer: SensitiveConsumerSchema, expiresAt: z.string().datetime() }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), status: z.literal("CONSUMED"), consumer: SensitiveConsumerSchema, expiresAt: z.string().datetime(), consumedAt: z.string().datetime() }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), status: z.literal("EXPIRED"), consumer: SensitiveConsumerSchema, expiresAt: z.string().datetime() }).strict(),
]);
export type SensitiveDeliveryState = z.infer<typeof SensitiveDeliveryStateSchema>;

/**
 * The consume-once delivery response, discriminated on `outcome` and `.strict()`
 * so a non-DELIVERED outcome can NEVER carry the plaintext:
 * DELIVERED (first, authorized) → `secret`; ALREADY_CONSUMED / EXPIRED /
 * CONSUMER_MISMATCH → state only, no secret.
 */
export const SensitiveConsumeOutcome = ["DELIVERED", "ALREADY_CONSUMED", "EXPIRED", "CONSUMER_MISMATCH"] as const;
export const SensitiveConsumeOutcomeSchema = z.enum(SensitiveConsumeOutcome);
export type SensitiveConsumeOutcome = (typeof SensitiveConsumeOutcome)[number];

export const SensitiveConsumeResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("DELIVERED"), secret: JsonValue }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("ALREADY_CONSUMED"), consumedAt: z.string().datetime() }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("EXPIRED"), expiresAt: z.string().datetime() }).strict(),
  z.object({ contractVersion: z.literal(CE_CONTRACT_VERSION), commandId: z.string().min(1), outcome: z.literal("CONSUMER_MISMATCH") }).strict(),
]);
export type SensitiveConsumeResponse = z.infer<typeof SensitiveConsumeResponseSchema>;


// ---- Action result display envelope (contracts#44) -------------------------
// What a service action's execute returns, and how operator UIs render it.
// Convention (pre-CE legacy heritage, panel-ce v0.4.0): the envelope's
// `data.list` renders as a table, `data.detail` renders as a key/value sheet;
// any other object data falls back to generic key/value display.

export const ActionDisplayFormat = [
  "text",
  "status",
  "datetime",
  "boolean",
  "code",
  "duration",
  "relativeTime",
  "bytes",
] as const;
export const ActionDisplayFormatSchema = z.enum(ActionDisplayFormat);
export type ActionDisplayFormat = (typeof ActionDisplayFormat)[number];

export const ActionDisplayRowActionSchema = z.object({
  label: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
  danger: z.boolean().optional(),
  confirm: z.boolean().optional(),
});
export type ActionDisplayRowAction = z.infer<typeof ActionDisplayRowActionSchema>;

export const ActionDisplayColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  format: ActionDisplayFormatSchema.optional(),
  copyable: z.boolean().optional(),
  ellipsis: z.boolean().optional(),
  width: z.union([z.number(), z.string()]).optional(),
});
export type ActionDisplayColumn = z.infer<typeof ActionDisplayColumnSchema>;

export const ActionDisplayListSchema = z.object({
  title: z.string().optional(),
  data: z.array(z.record(z.unknown())),
  columns: z.array(ActionDisplayColumnSchema).optional(),
  rowActions: z.array(ActionDisplayRowActionSchema).optional(),
  pageActions: z.array(ActionDisplayRowActionSchema).optional(),
  emptyText: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
});
export type ActionDisplayList = z.infer<typeof ActionDisplayListSchema>;

export const ActionDisplayDetailFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  format: ActionDisplayFormatSchema.optional(),
  copyable: z.boolean().optional(),
});
export type ActionDisplayDetailField = z.infer<typeof ActionDisplayDetailFieldSchema>;

export const ActionDisplayDetailSchema = z.object({
  title: z.string().optional(),
  data: z.record(z.unknown()),
  fields: z.array(ActionDisplayDetailFieldSchema).optional(),
  actions: z.array(ActionDisplayRowActionSchema).optional(),
});
export type ActionDisplayDetail = z.infer<typeof ActionDisplayDetailSchema>;

export const ActionResultSchema = z.object({
  success: z.boolean(),
  data: Json.optional(),
  message: z.string().optional(),
  error: z
    .object({ code: z.string().optional(), message: z.string().optional() })
    .optional(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

// ---- ErrorModel -----------------------------------------------------------
// runtime-platform/04. Stable error codes; `retryable` distinguishes retry-safe.

export const CeErrorCode = {
  CONTRACT_VERSION_MISMATCH: "CONTRACT_VERSION_MISMATCH",
  UNKNOWN_INSTANCE: "UNKNOWN_INSTANCE",
  NO_HEALTHY_INSTANCE: "NO_HEALTHY_INSTANCE",
  TARGET_OFFLINE: "TARGET_OFFLINE",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // Command lifecycle (contracts#50)
  UNKNOWN_COMMAND: "UNKNOWN_COMMAND",
  // Sensitive one-time result (contracts#50 / server-ce#86) — stable states a
  // re-read or denied consume returns; none of these ever carry the plaintext.
  SENSITIVE_ALREADY_CONSUMED: "SENSITIVE_ALREADY_CONSUMED",
  SENSITIVE_EXPIRED: "SENSITIVE_EXPIRED",
  SENSITIVE_CONSUMER_MISMATCH: "SENSITIVE_CONSUMER_MISMATCH",
  // World A long-poll transport (contracts#48, 0.7.4): any transport mode the
  // deployment does not implement (World B, SSE/WS upgrades) is refused
  // explicitly — never partially implemented (docs#68).
  TRANSPORT_MODE_UNSUPPORTED: "TRANSPORT_MODE_UNSUPPORTED",
} as const;
export type CeErrorCode = (typeof CeErrorCode)[keyof typeof CeErrorCode];

export const ErrorModelSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
});
export type ErrorModel = z.infer<typeof ErrorModelSchema>;

// ---- World A long-poll transport (contracts#48, docs/09 §4/§5, 0.7.4) -------
//
// 0.7.4 implements ONE transport direction completely (docs#68): the Connector
// dials the Platform. The Connector long-polls the Platform's command endpoint (a
// hanging GET the PLATFORM holds open for at most `waitMs`), executes, and POSTs
// progress/results outbound — a private/NAT Connector needs no inbound route.
// World B (Platform dials Connector), rendezvous discovery and HA routing are
// 0.8.x: a Platform MUST answer TRANSPORT_MODE_UNSUPPORTED rather than partially
// implement them.
//
// Reliability model (docs/09 §5.3): the connection may drop at any time —
// correctness lives in the queue + ack semantics, all safe under multi-node
// Platform nodes (nothing below assumes a single process):
//   * delivery  = one AT-LEAST-ONCE attempt of a stream item. `deliveryId` is
//     unique PER ATTEMPT and is the ack key; an un-acked delivery reappears on
//     a later poll with the SAME item and an incremented `attempt`.
//   * command dedupe key = `commandId`; cancellation dedupe key = `cancelId`;
//     message dedupe key = `messageId`. Connectors act once per item, ack per delivery.
//   * ack after the item is durably accepted on the Connector side; acking an
//     unknown/already-acked delivery is an idempotent no-op, never an error.
//
// The empty poll result is HTTP 204 WITH NO BODY (docs/09 §5.1): a
// CommandPollResponse never carries an empty `deliveries` array — "nothing to
// deliver" is expressed by the status code so Connectors re-poll immediately
// without parsing.

/** Transport modes a Platform can distribute. 0.7.4 ships LONG_POLL only. */
export const TransportMode = ["LONG_POLL"] as const;
export const TransportModeSchema = z.enum(TransportMode);
export type TransportMode = (typeof TransportMode)[number];

/**
 * Transport parameters, DISTRIBUTED BY THE PLATFORM (deployment-owned, e.g. on
 * the registration response) — never chosen by the Connector. `waitMs` is the
 * Platform-side hang bound of the long-poll (kept clearly below the path's
 * minimum gateway timeout per docs/09 §5.2, ~25–30s behind a CDN); the Connector's
 * client read timeout MUST exceed it. `maxBatch` bounds deliveries per poll.
 */
export const TransportParametersSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    mode: TransportModeSchema,
    waitMs: z.number().int().min(1_000).max(90_000),
    maxBatch: z.number().int().min(1).max(100),
  })
  .strict();
export type TransportParameters = z.infer<typeof TransportParametersSchema>;

/** Operations carried by a World A command delivery. PREPARE is optional at
 * the action level, but when used it travels on the same Connector-initiated stream
 * as EXECUTE — no reverse Platform→Connector callback is required. */
export const DeliveredCommandOperation = ["EXECUTE", "REVIEW"] as const;
export const DeliveredCommandOperationSchema = z.enum(DeliveredCommandOperation);
export type DeliveredCommandOperation = (typeof DeliveredCommandOperation)[number];

/**
 * The authenticated Account context a delivered command was issued under, as
 * the Platform authenticated it (xtrape-docs runtime-platform/12, #256).
 * Three things this is NOT: not a credential (a Widget must not loosen or
 * tighten on it), not the actual originator (a Device type proves nothing
 * about who is behind it), and never caller-supplied —
 * `CommandDispatchRequest` stays strict and refuses it; only the Platform
 * fills it, at delivery time.
 *
 * `account` is ONE namespace: the canonical Account (Participant) id. A
 * subject that does not map to an Account has no `account` — never a
 * principal/instance/client id or a component name in its place, which
 * would make the same person compare unequal to themselves across surfaces
 * or let a component pose as an Account. There is deliberately NO class
 * field: the Account taxonomy is undecided (see AccountRef), and the
 * canonical `PrincipalType` is an invocation-relative Originator vocabulary,
 * not an Account class — an Account-class enum, if ever wanted, arrives as
 * a separately named optional field (12-command-origin §9). Missing or
 * malformed reads as `{}`.
 */
export const CommandOriginSchema = z
  .object({
    account: z.string().min(1).optional(),
    traceId: z.string().min(1).optional(),
  })
  .strict();
export type CommandOrigin = z.infer<typeof CommandOriginSchema>;

/** The manifest feature bit a Worker declares to receive `origin` on deliveries. */
export const COMMAND_ORIGIN_FEATURE = "commandOrigin" as const;

/**
 * World B carrier: the Platform→Connector dial body IS the strict
 * `CommandDispatchRequest`, so the origin rides this Platform-set header
 * (JSON `CommandOrigin`) — like `x-xtrape-command-id` already does. Only the
 * Platform sets it; a Connector reads it and never trusts a body field.
 */
export const COMMAND_ORIGIN_HEADER = "x-xtrape-command-origin" as const;

const DeliveredActionCommandFields = {
  commandId: z.string().min(1),
  actionName: z.string().min(1),
  input: Json.optional(),
  issuedAt: z.string().datetime(),
  /** Optional disclosure of the duration the dispatcher declared — reminder
   * metadata, nothing more (xtrape-docs#242, contracts#14). The frozen rule:
   * elapsed time never terminalizes or adjudicates a command, on any side —
   * and neither the Platform nor a generic Connector synthesizes, clamps, or
   * enforces this value. It says nothing about how a command may fail:
   * non-time causes (dispatch, delivery, the action itself) still produce
   * FAILED(ERROR) as ever. An action that wants a bound applies one itself
   * and reports it (`failureReason: TIMEOUT`). Optional since contracts#14 —
   * a one-time break with pre-#14 consumers, whose strict parse required it
   * (decision 2026-08-09: no accepts-both intermediate). */
  timeoutSeconds: z.number().int().min(1).optional(),
  /**
   * The authenticated Account context this command was issued under
   * (xtrape-docs runtime-platform/12, #256). Optional on the wire — but
   * optional is not compatibility: a pre-#256 consumer parses this object
   * strictly and would refuse the whole delivery on an unknown key. The
   * Platform therefore sends it ONLY to Workers whose manifest declares
   * `features.commandOrigin` (COMMAND_ORIGIN_FEATURE); everyone else gets
   * exactly the delivery they get today. Absent reads as `{}`.
   */
  origin: CommandOriginSchema.optional(),
} as const;

/** An EXECUTE or REVIEW command delivered on the poll stream. The explicit
 * discriminator prevents consumers from guessing operation semantics from the
 * action name or from legacy command types.
 *
 * `REVIEW` is the read-only review step of a two-phase Checkpoint
 * (xtrape-docs#288, runtime-platform/13 §3/§9/§10): the Platform delivers it
 * when the governed request said `operation: "review"`, and the Connector
 * answers it with `ReviewCommandResultSchema` (`{ next }`) and NO side effect.
 * It REPLACES the former `PREPARE` arm (never emitted by any Platform; dropped
 * by every Connector) within the coordinated pre-freeze v1 train — a Connector
 * built against the old arm fails closed on `REVIEW` (its strict union does
 * not admit the value), which is exactly the honest closed door §9 requires;
 * it does not parse a REVIEW as a legacy prepare. */
export const DeliveredCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("EXECUTE"), ...DeliveredActionCommandFields }).strict(),
  z.object({ operation: z.literal("REVIEW"), ...DeliveredActionCommandFields }).strict(),
]);
export type DeliveredCommand = z.infer<typeof DeliveredCommandSchema>;
export type DeliveredReviewCommand = Extract<DeliveredCommand, { operation: "REVIEW" }>;
export type DeliveredExecuteCommand = Extract<DeliveredCommand, { operation: "EXECUTE" }>;

/** Cancellation is a control delivery rather than a second command with the
 * same commandId: `cancelId` is its stable dedupe key, while `commandId` names
 * the command being cancelled. This avoids colliding with command execution
 * dedupe on commandId. */
export const DeliveredCancellationSchema = z
  .object({
    cancelId: z.string().min(1),
    commandId: z.string().min(1),
    issuedAt: z.string().datetime(),
    reason: z.string().optional(),
  })
  .strict();
export type DeliveredCancellation = z.infer<typeof DeliveredCancellationSchema>;

export const DeliveryKind = ["COMMAND", "CANCEL", "MESSAGE"] as const;
export const DeliveryKindSchema = z.enum(DeliveryKind);
export type DeliveryKind = (typeof DeliveryKind)[number];

/**
 * One at-least-once delivery attempt. PREPARE/EXECUTE, cancellation and
 * conversation messages all ride the SAME World A stream. Dedupe keys are
 * commandId, cancelId and messageId respectively; deliveryId remains the
 * per-attempt acknowledgement key.
 */
export const StreamDeliverySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("COMMAND"),
      deliveryId: z.string().min(1),
      attempt: z.number().int().min(1),
      command: DeliveredCommandSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("CANCEL"),
      deliveryId: z.string().min(1),
      attempt: z.number().int().min(1),
      cancellation: DeliveredCancellationSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("MESSAGE"),
      deliveryId: z.string().min(1),
      attempt: z.number().int().min(1),
      message: ConversationMessageSchema,
    })
    .strict(),
]);
export type StreamDelivery = z.infer<typeof StreamDeliverySchema>;

/** Non-empty poll result; the empty case is HTTP 204 with no body. A
 * deliveryId is a per-attempt acknowledgement key and therefore MUST identify
 * exactly one item within a batch. */
export const CommandPollResponseSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    deliveries: z.array(StreamDeliverySchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, delivery] of value.deliveries.entries()) {
      if (seen.has(delivery.deliveryId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveries", index, "deliveryId"],
          message: "duplicate deliveryId in poll batch",
        });
      }
      seen.add(delivery.deliveryId);
    }
  });
export type CommandPollResponse = z.infer<typeof CommandPollResponseSchema>;

/**
 * Ack of received deliveries (by deliveryId, i.e. per attempt). Ack when the
 * item is DURABLY accepted Connector-side; anything un-acked redelivers. Acking is
 * idempotent: unknown/already-acked ids come back under `unknown` and are not
 * an error (a lost ack response must be safely retryable).
 */
const uniqueDeliveryIds = (minimum: number) =>
  z
    .array(z.string().min(1))
    .min(minimum)
    .max(100)
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();
      for (const [index, id] of ids.entries()) {
        if (seen.has(id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "duplicate deliveryId" });
        }
        seen.add(id);
      }
    });

export const AckDeliveriesRequestSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    deliveryIds: uniqueDeliveryIds(1),
  })
  .strict();
export type AckDeliveriesRequest = z.infer<typeof AckDeliveriesRequestSchema>;

/** `acked` and `unknown` are individually unique and disjoint. Complete
 * request coverage is frozen by AckDeliveriesExchangeSchema below, because a
 * response alone cannot know which ids were requested. */
export const AckDeliveriesResponseSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    acked: uniqueDeliveryIds(0),
    unknown: uniqueDeliveryIds(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    const acked = new Set(value.acked);
    for (const [index, id] of value.unknown.entries()) {
      if (acked.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unknown", index], message: "deliveryId cannot be both acked and unknown" });
      }
    }
  });
export type AckDeliveriesResponse = z.infer<typeof AckDeliveriesResponseSchema>;

/** One complete ack exchange. The response MUST be an exact partition of the
 * request ids: no omission, no foreign id, no duplicate, and no overlap. This
 * schema is the conformance/runtime validator when request and response are
 * available together. */
export const AckDeliveriesExchangeSchema = z
  .object({
    request: AckDeliveriesRequestSchema,
    response: AckDeliveriesResponseSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const requested = new Set(value.request.deliveryIds);
    const responded = new Set([...value.response.acked, ...value.response.unknown]);

    for (const [index, id] of value.response.acked.entries()) {
      if (!requested.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["response", "acked", index],
          message: "acked deliveryId was not requested",
        });
      }
    }
    for (const [index, id] of value.response.unknown.entries()) {
      if (!requested.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["response", "unknown", index],
          message: "unknown deliveryId was not requested",
        });
      }
    }
    for (const [index, id] of value.request.deliveryIds.entries()) {
      if (!responded.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["request", "deliveryIds", index],
          message: "requested deliveryId is missing from ack response",
        });
      }
    }
  });
export type AckDeliveriesExchange = z.infer<typeof AckDeliveriesExchangeSchema>;

/** Canonical CE registration endpoint and authentication header for World A.
 * The token value is transport-independent and Platform-issued; this package
 * freezes the header name while the Platform (platform-ce) owns credential validation/rotation. */
export const WORLD_A_CE_REGISTRATION_PATH = "/v1/instances" as const;
export const CE_REGISTRATION_TOKEN_HEADER = "x-xtrape-registration-token" as const;

/** Required authentication header for the public World A CE registration
 * protocol. Header names are normalized to lowercase. Other standard HTTP
 * headers remain allowed; only the registration token's presence and non-empty
 * value are contracted here. Local/dev insecure-open overrides are deployment
 * policy and do not weaken this public wire contract. */
export const WorldACeRegistrationHeadersSchema = z
  .object({
    [CE_REGISTRATION_TOKEN_HEADER]: z.string().min(1),
  })
  .passthrough();
export type WorldACeRegistrationHeaders = z.infer<typeof WorldACeRegistrationHeadersSchema>;

/** Canonical CE registration request body. The wrapper is strict and freezes
 * the real platform-ce wire: `{ manifest, instance }`. Cross-object identity is
 * structural here so a Connector cannot register a Worker under a different
 * logical service than the submitted manifest.
 *
 * The `instance` KEY is a frozen wire byte and is deliberately NOT renamed by
 * the ServiceInstance→Worker symbol rename (#99); renaming it is a
 * `contractVersion` migration, not a symbol swap. */
export const CeRegistrationRequestSchema = z
  .object({
    manifest: ServiceManifestSchema,
    instance: WorkerSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.instance.serviceId !== value.manifest.service.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["instance", "serviceId"],
        message: "instance.serviceId must equal manifest.service.id",
      });
    }
    if (value.instance.tenant !== value.manifest.tenant) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["instance", "tenant"],
        message: "instance.tenant must equal manifest.tenant",
      });
    }
  });
export type CeRegistrationRequest = z.infer<typeof CeRegistrationRequestSchema>;

/** Compatibility response for the canonical CE registration endpoint. It
 * mirrors platform-ce today ({instanceId, contractVersion, accessToken?}) and
 * accepts the additive transport field. World A consumers MUST validate the
 * stricter WorldACeRegistrationResponseSchema below. */
export const CeRegistrationResponseSchema = z
  .object({
    contractVersion: z.literal(CE_CONTRACT_VERSION),
    instanceId: z.string().min(1),
    accessToken: z.string().min(1).optional(),
    /**
     * Per-instance credential the PLATFORM will present when it dials this
     * instance back (`x-xtrape-service-callback-token`), minted at
     * registration and rotated on re-registration exactly like `accessToken`.
     * The Connector adopts it and rejects inbound calls that do not carry it.
     *
     * It exists so that Platform→Service authentication is per-instance rather
     * than one secret shared by every service in a deployment: with a shared
     * secret, any service holding it can impersonate the Platform to any other,
     * and rotating it means reconfiguring all of them at once. Optional
     * because a Platform that has not adopted per-instance minting omits it,
     * and a Connector that receives none keeps its previously configured
     * behavior.
     */
    callbackToken: z.string().min(1).optional(),
    transport: TransportParametersSchema.optional(),
  })
  .strict();
export type CeRegistrationResponse = z.infer<typeof CeRegistrationResponseSchema>;

/** The only canonical 0.7.4 World A provisioning response on the CE wire.
 * LONG_POLL/waitMs/maxBatch are required here; pre-CE legacy registration
 * schemas in index.ts remain compatibility surfaces and are not CE authority. */
export const WorldACeRegistrationResponseSchema = CeRegistrationResponseSchema.extend({
  transport: TransportParametersSchema,
});
export type WorldACeRegistrationResponse = z.infer<typeof WorldACeRegistrationResponseSchema>;

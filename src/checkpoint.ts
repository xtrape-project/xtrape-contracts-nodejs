import { z } from "zod";

/**
 * Xtrape Checkpoint contracts (0.8.5) — the wire surface of the Controlled
 * Exposure design (arch/16). Naming per xtrape-docs#259: the module is named
 * after its anchor object, the Checkpoint; bare "Exposure" names the
 * projection layer (the `xtrape-exposure` Device adapter), and "Controlled
 * Exposure" remains the design document's title. This file was
 * `src/exposure.ts` until the #112 rename (wire bytes unchanged — the wire
 * field is `contractVersion: 1`, a number).
 *
 * Every top-level object is versioned by a wire field named `contractVersion`
 * (value: `CHECKPOINT_CONTRACT_VERSION`). Additive alongside the 0.7.x CE
 * Action/command contracts in `./ce` — this does NOT reinterpret existing
 * Action objects (contracts-nodejs#59; two-consumer + design-first rule).
 *
 * Canonical source: xtrape-docs `architecture/16-controlled-exposure-and-invocation-authorization.md`.
 * This module carries **#59 in slices**. Part 1: the immutable Checkpoint
 * definition and the Resource model it is authorized against (arch/16 §4).
 * Part 2 slice A (appended below): the identity half — WorkloadRef, Account
 * Token claims, Managed Access Session, Service Selection, Principal reference
 * (§2, §6). Slice B: authorization mode / authentication requirement /
 * Checkpoint Group / Policy Binding / resolved authorization (§7–§9). Slice C1:
 * parameter digest, invocation path, target admission, reviewed scope,
 * decision, audit snapshot (§3, §7.1, §10 durable outcome). Slice C2 (#60):
 * the §10 durable workflow objects — Authentication Challenge, single-stage
 * Approval, Authorization Grant — plus the §8.1 confirmation control
 * (`confirmation` axis, `requireConfirmation`, Confirmation Continuation).
 * Slice B2 (the §17.2 landing items that had not landed; platform-ce#113
 * plan A1-v2..v4): System Exposure Rule and Account Entitlement minimal
 * baseline forms (§5/§7), the grant-lifetime carrier
 * (`ControlRequirements.maxTtlSeconds`, relative TTL) and use-count carrier
 * (`maxUses`), and their resolved effectives
 * (`ResolvedAuthorization.effectiveMaxTtlSeconds` + `ttlProvenance` +
 * `effectiveMaxUses`). All remain `CHECKPOINT_CONTRACT_VERSION` v1
 * strict/closed.
 */
/**
 * The Checkpoint wire-contract version. **v1 is a strict, closed surface**: every
 * schema rejects unknown fields and unknown union branches.
 *
 * Two regimes govern how this surface may change (contracts#121):
 *
 * - **Pre-freeze (CURRENT, the 0.8.x train up to the 0.9 wire freeze)** —
 *   coordinated IN-PLACE evolution of v1: a new field, a new union branch, a
 *   relaxed or tightened constraint lands at `contractVersion: 1`, is recorded
 *   as **BREAKING** in the CHANGELOG entry of the release that carries it, and
 *   every consumer is in-workspace and rides that release. This is the posture
 *   the owner ruled for the pre-0.9.x train (no historical debt: one step, no
 *   "accept both" intermediate states), and it is how C2 (0.8.8), the module
 *   rename (0.8.8), B2 (0.8.9) and the DeviceId relaxation (0.8.10) landed.
 *   A strict v1 consumer built against an OLDER release of this train WILL
 *   reject newer-shape documents — that is expected inside the train and is
 *   why the CHANGELOG names each such change.
 *
 * - **Post-freeze (from the 0.9 wire-freeze release onward)** — the surface is
 *   frozen for external consumers. From then on, *any* change a strict v1
 *   consumer would reject — a new field, a new `SchemaRef` /
 *   `ResourceExtractionSpec` branch, a relaxed constraint — is **not** a
 *   wire-additive change: it requires bumping this version or an explicit
 *   capability negotiation so new-shape documents are never sent to a v1
 *   consumer.
 *
 * **The freeze does not bump this constant** (owner ruling, contracts#121
 * comment #18441): `contractVersion` names WIRE SEMANTICS, not "frozen or
 * not". The 0.9 wire-freeze release keeps `CHECKPOINT_CONTRACT_VERSION = 1`
 * unless an incompatible wire change lands in that same release. After the
 * freeze, the FIRST change a strict v1 consumer cannot accept is what moves
 * `1 → 2` (or is carried by explicit capability negotiation) — never the act
 * of freezing itself, which would split identical wire semantics into two
 * versions.
 */
export const CHECKPOINT_CONTRACT_VERSION = 1 as const;

/* ------------------------------------------------------------------ *
 * Classification enums (arch/16 §4 Checkpoint metadata)
 * ------------------------------------------------------------------ */

/** Side-effect classification of a Checkpoint (arch/16 §4). */
export const SideEffectClass = [
  "READ_ONLY", // no observable state change (e.g. linux-ops-widget-nodejs.service.status)
  "MUTATING", // changes state but not externally observable beyond the target
  "EXTERNALLY_OBSERVABLE", // externally visible side effect (arch/16 §7.2 output-path rule applies)
] as const;
export const SideEffectClassSchema = z.enum(SideEffectClass);
export type SideEffectClass = (typeof SideEffectClass)[number];

/**
 * Risk metadata (arch/16 §4). Distinct from execution authorization mode. The
 * array order IS the **frozen total order** `LOW < MEDIUM < HIGH < CRITICAL`
 * used for "maximum risk" / narrow-only comparisons; compare via {@link riskRank}.
 */
export const RiskLevel = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const RiskLevelSchema = z.enum(RiskLevel);
export type RiskLevel = (typeof RiskLevel)[number];
/** Ordinal of a risk level in the frozen total order (LOW=0 … CRITICAL=3). Fails closed on an illegal value. */
export function riskRank(r: RiskLevel): number {
  return RiskLevel.indexOf(RiskLevelSchema.parse(r));
}

/**
 * Sensitivity / data classification (arch/16 §7.2). The array order IS the
 * **frozen total order** `PUBLIC < INTERNAL < CONFIDENTIAL < SECRET` used for
 * upper-bound / narrow-only comparisons; compare via {@link dataClassificationRank}.
 */
export const DataClassification = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "SECRET"] as const;
export const DataClassificationSchema = z.enum(DataClassification);
export type DataClassification = (typeof DataClassification)[number];
/** Ordinal of a classification in the frozen total order (PUBLIC=0 … SECRET=3). Fails closed on an illegal value. */
export function dataClassificationRank(c: DataClassification): number {
  return DataClassification.indexOf(DataClassificationSchema.parse(c));
}

/**
 * Business idempotency (arch/16 §4): does repeating the *same* call produce the
 * same resulting state / no additional effect? This is orthogonal to the
 * delivery guarantee and the retry policy below.
 */
export const IdempotencyClass = ["IDEMPOTENT", "NON_IDEMPOTENT"] as const;
export const IdempotencyClassSchema = z.enum(IdempotencyClass);
export type IdempotencyClass = (typeof IdempotencyClass)[number];

/**
 * Execution/delivery guarantee (orthogonal to business idempotency):
 * - `AT_MOST_ONCE` — must never execute more than once; no automatic retry that
 *   could double-execute.
 * - `AT_LEAST_ONCE` — may be delivered/executed again; the target must dedupe.
 */
export const DeliveryGuarantee = ["AT_MOST_ONCE", "AT_LEAST_ONCE"] as const;
export const DeliveryGuaranteeSchema = z.enum(DeliveryGuarantee);
export type DeliveryGuarantee = (typeof DeliveryGuarantee)[number];

/**
 * Retry policy — replaces the underspecified `retryable: boolean` with explicit,
 * frozen semantics:
 * - `NONE` — never retried after an execution claim; a new attempt is a NEW
 *   logical invocation (new invocation + idempotency context).
 * - `BEFORE_CLAIM_ONLY` — may be retried only *before* the execution is claimed
 *   (no side effect yet), reusing the original invocation and idempotency context.
 * - `IDEMPOTENT_REPLAY` — may be retried after a claim, reusing the original
 *   invocation's idempotency context. Legal only when `idempotency === IDEMPOTENT`
 *   and `delivery === AT_LEAST_ONCE` (enforced on CheckpointDefinition).
 */
export const RetryMode = ["NONE", "BEFORE_CLAIM_ONLY", "IDEMPOTENT_REPLAY"] as const;
export const RetryModeSchema = z.enum(RetryMode);
export type RetryMode = (typeof RetryMode)[number];

/** Synchronous vs asynchronous execution semantics (arch/16 §4). */
export const ExecutionMode = ["SYNC", "ASYNC"] as const;
export const ExecutionModeSchema = z.enum(ExecutionMode);
export type ExecutionMode = (typeof ExecutionMode)[number];

/**
 * Whether the originator must confirm the exact target before the request
 * executes (arch/16 §8.1 "Confirmation"). Declared by the SERVICE on the
 * Checkpoint definition, beside `sideEffect` and `risk`; a Policy Binding
 * carries the same axis as `requireConfirmation` among its control
 * requirements. The effective requirement is the STRICTER of the two — neither
 * side can waive the other (§8.1: lower layers only narrow authority and
 * increase controls). Confirmation is NOT approval: confirmation is the
 * originator's own assent to a complete, unambiguous request; approval is a
 * DIFFERENT party's decision and is itself evidence (§8.1 closing rule).
 */
export const ConfirmationRequirement = ["NOT_REQUIRED", "REQUIRED"] as const;
export const ConfirmationRequirementSchema = z.enum(ConfirmationRequirement);
export type ConfirmationRequirement = (typeof ConfirmationRequirement)[number];

/* ------------------------------------------------------------------ *
 * Resource model (arch/16 §2 "Resource", §4 extraction/normalization)
 *
 * Authorization is evaluated against `Checkpoint + Resource`, never a
 * Checkpoint name alone. A Resource is an ordered chain of typed segments,
 * root -> leaf, which gives ancestry and containment without unsafe string
 * matching. Example canonical form: `host:host-001/service:nginx`.
 * ------------------------------------------------------------------ */

/**
 * True if `s` is a well-formed Unicode scalar-value sequence — i.e. every UTF-16
 * high surrogate is followed by a low surrogate and there are no unpaired
 * surrogates. Lone surrogates (`\uD800`) are NOT valid scalar values and, if
 * left in, `TextEncoder` replaces them with U+FFFD — so `\uD800`, `\uDC00`, and a
 * genuine `�` would all encode to `%EF%BF%BD` and collide. Rejecting them
 * keeps `encodeResourceId` injective and language-independent.
 */
function isWellFormedUnicode(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++; // valid surrogate pair; skip the low surrogate
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false; // unpaired low surrogate
    }
  }
  return true;
}

/**
 * A non-empty cross-language wire string: a **well-formed Unicode scalar
 * sequence** (no unpaired surrogates) that is already **NFC**-normalized. Both
 * conditions are wire invariants — non-conforming input is REJECTED, never
 * silently transformed — so a producer in any language emits the same bytes and
 * every consumer applies the same predicate. This is the identity-equality rule
 * for Resource ids, exact selector ids, and other free-form wire strings.
 */
const NfcString = z
  .string()
  .min(1)
  .refine(isWellFormedUnicode, {
    message: "must be a well-formed Unicode string (no unpaired surrogates)",
  })
  .refine((v) => v.normalize("NFC") === v, {
    message: "must be NFC-normalized on the wire (cross-language Unicode invariant)",
  });

/** One typed segment of a Resource path, e.g. `{ type: "service", id: "nginx" }`. */
export const ResourceSegmentSchema = z
  .object({
    type: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/, "resource segment type must be lowercase kebab"),
    id: NfcString,
  })
  .strict();
export type ResourceSegment = z.infer<typeof ResourceSegmentSchema>;

/**
 * Canonical Resource reference produced by the Platform after schema-bound
 * normalization (arch/16 §4). `segments` are the single source of truth for the
 * resource identity; the canonical string is **derived** from them via
 * {@link canonicalResourceString} and is intentionally NOT carried on the wire,
 * so no consumer can present a canonical string that disagrees with `segments`.
 */
export const ResourceReferenceSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    /** root -> leaf typed segments; ancestry is the prefix chain. Single authority. */
    segments: z.array(ResourceSegmentSchema).min(1),
    /**
     * optional non-authoritative input spellings that the Platform normalized to
     * this resource (kept for audit/traceability only; never authority). Same
     * well-formed-Unicode + NFC wire rule as ids.
     */
    aliases: z.array(NfcString).optional(),
  })
  .strict();
export type ResourceReference = z.infer<typeof ResourceReferenceSchema>;

/**
 * Selector segment for policy scoping. Literal-vs-wildcard is **structured**, so
 * one string never has to carry both meanings:
 *
 *   - `{ match: "exact", id }` — matches exactly this id (which may itself be the
 *     literal `"*"`, an otherwise unrepresentable Resource id);
 *   - `{ match: "any" }`       — matches any id at this position.
 *
 * The exact `id` is subject to the same NFC wire invariant as `ResourceSegment.id`.
 */
export const ResourceSelectorSegmentSchema = z.discriminatedUnion("match", [
  z
    .object({
      type: z
        .string()
        .min(1)
        .regex(/^[a-z][a-z0-9-]*$/),
      match: z.literal("exact"),
      id: NfcString,
    })
    .strict(),
  z
    .object({
      type: z
        .string()
        .min(1)
        .regex(/^[a-z][a-z0-9-]*$/),
      match: z.literal("any"),
    })
    .strict(),
]);
export type ResourceSelectorSegment = z.infer<typeof ResourceSelectorSegmentSchema>;

/**
 * Resource selector used by exposure/policy (arch/16 §5). Matches a Resource
 * whose segment prefix matches; `matchDescendants` extends the match to
 * contained resources (containment, arch/16 §2).
 */
export const ResourceSelectorSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    segments: z.array(ResourceSelectorSegmentSchema).min(1),
    // required (no default): an immutable/stored contract must be explicit on the
    // wire so `{}` and `{matchDescendants:false}` are not two spellings of one object.
    matchDescendants: z.boolean(),
  })
  .strict();
export type ResourceSelector = z.infer<typeof ResourceSelectorSchema>;

/**
 * Deterministic, schema-bound Resource extraction (arch/16 §4). The Platform
 * produces the canonical Resource BEFORE authorization and target admission —
 * without sending the request to an unadmitted target.
 *
 * Part 1 supports only the **`extractor-artifact`** variant: a reference to a
 * Platform-admitted deterministic extractor whose identity (`artifactDigest`) is
 * part of the immutable Checkpoint version, so extraction is deterministic by
 * construction and language-independent.
 *
 * A **declarative inline extraction DSL is intentionally deferred**: making it a
 * cross-language deterministic contract requires freezing the pointer syntax
 * (RFC 6901 JSON Pointer), string-only extraction that fails closed on
 * missing/type-mismatch, and an exact normalizer order with Unicode/locale
 * rules — plus conformance vectors. That is a #59 follow-up. Adding a
 * `kind: "declarative"` branch is **not** a wire-additive change (a strict v1
 * consumer rejects the unknown kind); it requires bumping
 * `CHECKPOINT_CONTRACT_VERSION` or an explicit capability negotiation (see the
 * version note above). The `kind` discriminator is kept only so the shape is
 * stable, not to imply v1 will silently grow.
 *
 * **Artifact authority (frozen):** `artifactDigest` is the **sole content
 * authority** for the extractor; the Platform MUST resolve the artifact and
 * verify its bytes hash to this digest before executing extraction, and fail
 * closed on any mismatch. `artifactId` is an **optional, non-authoritative**
 * locator / display label only — it is never used to resolve or run an extractor
 * without a matching digest, so two consumers cannot extract different Resources
 * by trusting the id over the digest.
 */
export const ResourceExtractionSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("extractor-artifact"),
      /** SOLE content authority; verified against the resolved artifact bytes before use. */
      artifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/, "digest must be sha256:<hex>"),
      /**
       * Content-addressed reference (`executionProfileRecord`, sha256) to an
       * **immutable, Platform-admitted execution-profile record**. A content
       * digest alone does not make extraction deterministic — the same bytes can
       * yield different Resources under a different runtime/ABI, dependency set,
       * locale, timezone, environment, or external state. The admitted record
       * binds the full deterministic ABI: runtime, module export names,
       * input/output encoding + envelope, error/timeout/memory-and-resource
       * limits, WASI/import allowlist, the dependency-closure preimage, and the
       * requirement that the output re-validate as a v1 `ResourceReference`
       * (fail closed otherwise). The record's internals and the profile-registry
       * API are a #59 follow-up; the wire contract here is complete *by reference*.
       */
      executionProfileRecord: z.string().regex(/^sha256:[0-9a-f]{64}$/, "executionProfileRecord must be sha256:<hex>"),
      /** optional non-authoritative locator / display label only. */
      artifactId: NfcString.optional(),
    })
    .strict(),
]);
export type ResourceExtractionSpec = z.infer<typeof ResourceExtractionSpecSchema>;

/* ------------------------------------------------------------------ *
 * Checkpoint (arch/16 §4)
 *
 * The stable authorization identity is `serviceId + checkpointId +
 * checkpointVersion`. A UI label / MCP Tool name / REST route is only a
 * projection and never the authorization identity.
 * ------------------------------------------------------------------ */

/** Immutable authorization identity of a Checkpoint version (arch/16 §4). */
export const CheckpointVersionIdSchema = z
  .object({
    /**
     * The **logical Service identity** (e.g. `linux-ops-widget-nodejs`), NOT a legacy 0.7.x
     * `svc_*` runtime/Service-Instance id. The concrete instance, artifact, and
     * runtime are bound separately by target admission (arch/16 §7.2), and the
     * exact Service-vs-Service-Instance relationship is a separate migration
     * decision (concepts/09 §10) — deliberately not frozen here. The kebab regex
     * rejects the underscore-bearing `svc_*` form.
     */
    serviceId: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/, "serviceId is a logical Service id (lowercase kebab); a legacy svc_* instance id is rejected"),
    checkpointId: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/, "checkpointId is dot-delimited kebab, e.g. service.status"),
    checkpointVersion: z
      .string()
      .regex(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
        "checkpointVersion is core SemVer x.y.z — no leading zeros, no prerelease/build metadata",
      ),
  })
  .strict();
export type CheckpointVersionId = z.infer<typeof CheckpointVersionIdSchema>;

/**
 * Canonical string key for a Checkpoint version, e.g. `linux-ops-widget-nodejs/service.status@1.0.0`.
 * Validates + fails closed (see the identity-helper note below): a caller cannot
 * pass an unvalidated id whose fields carry `/`/`@` and collide with another key.
 */
export function checkpointVersionKey(id: CheckpointVersionId): string {
  const v = CheckpointVersionIdSchema.parse(id);
  return `${v.serviceId}/${v.checkpointId}@${v.checkpointVersion}`;
}

/**
 * Schema reference — an opaque, content-addressed reference (`schemaRecord`, a
 * sha256 digest) to an **immutable, Platform-registered schema record**. The
 * record — not this wire object — binds the schema bytes, media type, JSON Schema
 * dialect, validation profile (supported keywords/formats, unknown-keyword and
 * `$ref`/base-URI/regex/number-bound handling), and the Platform's single
 * authoritative interpretation. Consumers reference the record by digest and
 * **never re-interpret raw schema bytes**, so two languages cannot disagree on
 * what a schema means. The record's internal structure and the schema-registry
 * API are a #59 follow-up; the wire contract here is complete *by reference*.
 *
 * An inline `jsonSchema` branch is intentionally **deferred**: carrying a JSON
 * Schema on the wire requires a frozen recursive JSON-value contract. Adding it
 * is **not** a wire-additive change (a strict v1 consumer rejects it) — it
 * requires bumping `CHECKPOINT_CONTRACT_VERSION` or capability negotiation.
 */
export const SchemaRefSchema = z
  .object({
    schemaRecord: z.string().regex(/^sha256:[0-9a-f]{64}$/, "schemaRecord must be sha256:<hex>"),
  })
  .strict();
export type SchemaRef = z.infer<typeof SchemaRefSchema>;

/**
 * Immutable Checkpoint definition (arch/16 §4). A published version is
 * immutable: changing any field that can alter authorization, routing, replay,
 * or audit meaning requires a NEW checkpointVersion. Re-registering the same
 * version with different values must fail closed — this is enforced by the
 * Platform.
 *
 * The stable wire identity is the version triple `serviceId + checkpointId +
 * checkpointVersion` ({@link CheckpointVersionIdSchema}). A content **digest**
 * over the whole definition is deliberately NOT part of this contract yet: a
 * cross-language content digest needs a frozen canonical-serialization
 * algorithm (preimage set, self-exclusion, field ordering, default expansion,
 * number/unicode/array normalization, and cross-language test vectors).
 * Introducing a digest field before that algorithm is frozen would let
 * TypeScript, Go, and Java compute different digests for the same Checkpoint.
 * The canonical-digest contract is a separate follow-up (#59); adding a digest
 * field to this strict surface is **not** wire-additive and requires bumping
 * `CHECKPOINT_CONTRACT_VERSION` (or capability negotiation).
 */
/**
 * The reserved logical Service id of PLATFORM-INTERNAL Checkpoints (`self.*`):
 * targets the Platform executes in-process. It is already a wire value — the
 * discovery surface lists `self` Checkpoints to every Device — and the
 * definition schema keys the Action-edge invariant on it: a definition of any
 * OTHER Service must carry `action`; a `self` definition must not.
 */
export const PLATFORM_INTERNAL_SERVICE_ID = "self" as const;


/* ------------------------------------------------------------------ *
 * The review face of a two-phase Checkpoint (xtrape-docs#288,
 * runtime-platform/13; arch/16 §4). A two-phase Action — one whose execution
 * is preceded by a read-only step that renders a review card, narrows the
 * form and seals a Widget-local review binding — declares that step HERE, as
 * part of the same immutable Checkpoint version. The execution step keeps the
 * ordinary inputSchema / outputSchema pair unchanged; the review step has its
 * own admitted input schema (a subset of the execution schema's properties),
 * its own deterministic Resource extraction (Service-rooted when no target is
 * chosen yet), its own admitted output schema (what `next.currentState` may
 * contain), its own declared risk, and its delivery affinity. Its side effect
 * is READ_ONLY by construction and is therefore not a field.
 *
 * Absence means single-phase: a definition written before this face existed
 * keeps its meaning (the `confirmation` precedent).
 * ------------------------------------------------------------------ */
/**
 * `INCARNATION`: the review seal binds the Worker incarnation that issued it,
 * and the execute step is routed to that incarnation (an unreachable one is
 * the owned `UNAVAILABLE` outcome). `NONE`: the seal is portable across the
 * Service's Workers and ordinary dispatch applies. Declared, never absent.
 */
export const CheckpointReviewAffinity = ["INCARNATION", "NONE"] as const;
export const CheckpointReviewAffinitySchema = z.enum(CheckpointReviewAffinity);
export type CheckpointReviewAffinity = (typeof CheckpointReviewAffinity)[number];

export const CheckpointReviewFaceSchema = z
  .object({
    /** admitted schema of the review request — a subset of the execution schema's properties. */
    inputSchema: SchemaRefSchema,
    /** deterministic extraction the review is authorized against (Service-rooted, or over the review input). */
    resource: ResourceExtractionSpecSchema,
    /** admitted schema of `next.currentState` — the only Service-defined part of a review result. */
    outputSchema: SchemaRefSchema,
    /** the review's declared risk; defaults to the execution risk when the producer says nothing else, and the Platform may only tighten. */
    risk: RiskLevelSchema,
    affinity: CheckpointReviewAffinitySchema,
    /**
     * runtime-platform/13 §4.3 (#144): the top-level property of the EXECUTION
     * `inputSchema` that the candidate exchange fills. The Platform
     * re-normalizes every submitted candidate as `{ ...reviewInput,
     * [candidateParameter]: candidate }` under the execution face's admitted
     * normalization profile and Resource extractor, intersects the Resources
     * with the session's effective authorization, and on the way out admits an
     * added `enum` ONLY on this property and ONLY from what it returned.
     * Absent = this review runs no candidate exchange (an added enum in
     * `next.inputSchema` is refused). Part of the immutable version.
     *
     * Domain (review 3198): any JSON Schema property NAME — an ordinary JSON
     * string, no lexical restriction — that the Platform verifies at
     * Checkpoint admission to be a declared top-level property of the
     * execution `inputSchema` (13 §4.2). BREAKING within the pre-freeze v1
     * train: a 0.8.16 strict reader rejects a definition carrying it.
     */
    candidateParameter: z.string().min(1).optional(),
  })
  .strict();
export type CheckpointReviewFace = z.infer<typeof CheckpointReviewFaceSchema>;

export const CheckpointDefinitionSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    id: CheckpointVersionIdSchema,
    inputSchema: SchemaRefSchema,
    outputSchema: SchemaRefSchema,
    resourceExtraction: ResourceExtractionSpecSchema,
    sideEffect: SideEffectClassSchema,
    risk: RiskLevelSchema,
    sensitivity: z
      .object({
        /** conservative input-classification UPPER BOUND — the highest data class the request may carry (arch/16 §7.2). */
        inputUpperBound: DataClassificationSchema,
        /** conservative output-classification UPPER BOUND (arch/16 §7.2). */
        outputUpperBound: DataClassificationSchema,
      })
      .strict(),
    /** business idempotency (orthogonal to delivery + retry). */
    idempotency: IdempotencyClassSchema,
    /** execution/delivery guarantee (orthogonal to business idempotency). */
    delivery: DeliveryGuaranteeSchema,
    /** explicit retry policy (replaces the underspecified `retryable` boolean). */
    retry: RetryModeSchema,
    execution: ExecutionModeSchema,
    /**
     * §8.1 confirmation axis: whether the originator must assent to the exact
     * target before execution. OPTIONAL, and absence means `NOT_REQUIRED` —
     * §8.1 fixes that reading explicitly so a definition written before this
     * axis existed keeps its meaning. The effective requirement is the stricter
     * of this declaration and the applicable Policy Binding's
     * `requireConfirmation` (neither side can weaken the other).
     */
    confirmation: ConfirmationRequirementSchema.optional(),
    /**
     * The implementation Action this Checkpoint version governs (docs#228
     * D1–D5, maintainer-ratified 2026-08-03; contracts-nodejs#127). The
     * Checkpoint↔Action edge lives HERE, inside the immutable definition the
     * publishing Service already authors — no third binding authority, and
     * publication stays atomic (a published Checkpoint always knows its
     * Action; the "discoverable but undispatchable because unmapped" state
     * cannot exist).
     *
     * - `actionId` uses the CURRENT Action name semantic (`ActionDefinition.
     *   name`, case-sensitive — e.g. `getServiceStatus`); the frozen rule
     *   "one Checkpoint version governs exactly one Action" is thereby
     *   IMPLEMENTED, not rewritten (D3).
     * - `capabilityId` is declared now but OPTIONAL (D4): the full Capability
     *   identity wire lands with docs#199; declaring the slot today makes
     *   filling it later a value change, not a second strict-surface change.
     * - Action identity is an IMPLEMENTATION BINDING, never authorization
     *   authority: authorization runs on the Checkpoint identity alone. The
     *   logical Service identity comes from `id.serviceId`; the reference
     *   deliberately carries no serviceId of its own (nothing to disagree).
     * - Lifecycle (D5): Platform admission validates the referenced Action
     *   belongs to the authenticated publishing Service when its current
     *   catalog is available; the Action later DISAPPEARING does not mutate
     *   or withdraw the immutable Checkpoint — invocation becomes
     *   UNDISPATCHABLE (distinct from UNAUTHORIZED and from policy denial),
     *   and a later catalog revision restores dispatchability only when the
     *   exact declared reference matches again. The live Action catalog is
     *   dispatchability/liveness EVIDENCE, never the semantic authority.
     * - The self exception is ENCODED IN THE STRUCTURE (review 2026-08-25
     *   P1): a PLATFORM-INTERNAL target — `id.serviceId` equal to
     *   {@link PLATFORM_INTERNAL_SERVICE_ID} — executes in-process, has no
     *   Action and no catalog to name (the same target split §8.1's
     *   branch-aware acceptance models: a `self` invocation IS the
     *   acceptance record; a Service target produces a Command), and MUST
     *   NOT carry this reference. Every OTHER definition is
     *   Service-published and MUST carry it — the schema's superRefine
     *   enforces both directions, so "a Service Checkpoint without an edge"
     *   is not expressible on the wire (D1's atomicity holds at the
     *   contract, and again at Platform admission where the arch/19 §3.1
     *   catalogue resolution runs).
     */
    action: z
      .object({
        /** current Action `name` semantic (case-sensitive; NOT a kebab logical id and NOT an `act_` minted id). */
        actionId: NfcString,
        /** reserved Capability identity slot (docs#199); its identity rule is defined there — until then any non-empty NFC string is stored uninterpreted. */
        capabilityId: NfcString.optional(),
      })
      .strict()
      .optional(),
    /**
     * declared local safety preconditions the target enforces fail-closed.
     * Required (no default): an immutable definition must be explicit on the wire
     * — a Checkpoint with none carries `[]` explicitly, so `{}` is never an
     * implicit spelling of `{ localPreconditions: [] }` across languages. Each
     * entry follows the well-formed-Unicode + NFC wire rule.
     */
    localPreconditions: z.array(NfcString),
    /**
     * The review face of a two-phase Checkpoint (runtime-platform/13).
     * OPTIONAL; absence means single-phase. Part of the immutable version:
     * re-registering the same version with a different face fails closed.
     */
    review: CheckpointReviewFaceSchema.optional(),
  })
  .strict()
  // Frozen legal combination: replaying a claimed execution is only safe when the
  // operation is idempotent AND the guarantee permits re-execution.
  .refine(
    (c) => c.retry !== "IDEMPOTENT_REPLAY" || (c.idempotency === "IDEMPOTENT" && c.delivery === "AT_LEAST_ONCE"),
    { message: "retry:IDEMPOTENT_REPLAY requires idempotency:IDEMPOTENT and delivery:AT_LEAST_ONCE" },
  )
  // The Checkpoint↔Action edge is total over Service-published definitions
  // and empty over platform-internal ones — BOTH directions enforced here so
  // the D1 invariant is not left to implementations (review 2026-08-25 P1).
  .superRefine((c, ctx) => {
    const internal = c.id.serviceId === PLATFORM_INTERNAL_SERVICE_ID;
    if (!internal && c.action === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: "a Service-published Checkpoint definition must name the one Action it governs (docs#228 D1)" });
    }
    if (internal && c.action !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: `a platform-internal (${PLATFORM_INTERNAL_SERVICE_ID}) Checkpoint executes in-process and carries no Action reference` });
    }
  });
export type CheckpointDefinition = z.infer<typeof CheckpointDefinitionSchema>;

/* ------------------------------------------------------------------ *
 * Resource helpers (pure; deterministic containment/ancestry)
 * ------------------------------------------------------------------ */

/**
 * Frozen cross-language byte encoding of a segment `id` for the canonical
 * string. This is a **byte contract**, reproducible identically in TypeScript,
 * Go, Java, etc. The frozen algorithm is:
 *
 *   1. **Enforce the wire invariant** (`NfcString.parse`): reject empty, non-NFC,
 *      or ill-formed (lone-surrogate) input — the helper does NOT silently repair
 *      it. This is the same rule the schema applies, so the helper cannot be a
 *      bypass.
 *   2. Encode to **UTF-8 bytes**.
 *   3. Percent-encode **every byte that is not RFC 3986 `unreserved`**
 *      (`A-Z a-z 0-9 - . _ ~`) as `%XX` with **uppercase** hex; emit unreserved
 *      bytes as-is.
 *
 * Consequences: the delimiter bytes `:` and `/` and the escape byte `%` are
 * non-unreserved and therefore always encoded (`%3A`/`%2F`/`%25`), so distinct
 * segment structures never collide; and any Unicode (e.g. CJK), NUL, newline, or
 * control byte is deterministically percent-encoded rather than passed through.
 * `type` is already restricted to `[a-z0-9-]` and is never encoded. This makes
 * `canonicalResourceString` injective and language-independent.
 */
const UNRESERVED_BYTE = /[A-Za-z0-9\-._~]/;
export function encodeResourceId(id: string): string {
  const validated = NfcString.parse(id); // reject empty / non-NFC / lone surrogate — no silent repair
  const bytes = new TextEncoder().encode(validated);
  let out = "";
  for (const b of bytes) {
    if (b < 0x80 && UNRESERVED_BYTE.test(String.fromCharCode(b))) {
      out += String.fromCharCode(b);
    } else {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/*
 * Identity helpers below **validate + fail closed at entry**. A TypeScript
 * inferred type does not prove a value was schema-parsed, so a caller could pass
 * a structural object that bypasses the wire invariants — e.g. a `type` carrying
 * the delimiters `:`/`/` (`{type:"host:x/service", id:"y"}` would collide with a
 * two-segment chain in the canonical string) or a non-NFC id. Each helper
 * re-parses its input through the owning schema, so any such forgery throws and
 * the canonical string, containment, and selector matching are guaranteed to
 * agree on validated (`type` ∈ `[a-z0-9-]`, id ∈ NFC) data.
 */

const ResourceSegmentsSchema = z.array(ResourceSegmentSchema).min(1);

/**
 * Canonical, collision-free string for a segment chain, e.g.
 * `host:host-001/service:nginx`. Validates the segments (fail closed) and escapes
 * ids via {@link encodeResourceId}; because `type` is validated to `[a-z0-9-]`
 * and ids are escaped, distinct structures can never produce the same string.
 */
export function canonicalResourceString(segments: ResourceSegment[]): string {
  const segs = ResourceSegmentsSchema.parse(segments);
  return segs.map((s) => `${s.type}:${encodeResourceId(s.id)}`).join("/");
}

/**
 * True if `ancestor` contains `descendant` (or they are equal): the ancestor's
 * segment chain is a prefix of the descendant's (arch/16 §2 containment). Both
 * inputs are validated (fail closed), so equality is byte comparison on
 * schema-valid `type`/NFC-`id` data.
 */
export function resourceContains(ancestor: ResourceReference, descendant: ResourceReference): boolean {
  const a = ResourceReferenceSchema.parse(ancestor);
  const d = ResourceReferenceSchema.parse(descendant);
  if (a.segments.length > d.segments.length) return false;
  return a.segments.every((seg, i) => {
    const x = d.segments[i];
    return x !== undefined && x.type === seg.type && x.id === seg.id;
  });
}

/**
 * True if a selector matches a Resource (prefix + optional descendants). Both
 * inputs are validated (fail closed) before comparison.
 */
export function selectorMatches(selector: ResourceSelector, resource: ResourceReference): boolean {
  const sel = ResourceSelectorSchema.parse(selector);
  const res = ResourceReferenceSchema.parse(resource);
  if (sel.segments.length > res.segments.length) return false;
  if (!sel.matchDescendants && sel.segments.length !== res.segments.length) return false;
  return sel.segments.every((s, i) => {
    const r = res.segments[i];
    if (r === undefined || r.type !== s.type) return false;
    return s.match === "any" || s.id === r.id;
  });
}

/* ================================================================== *
 * #59 PART 2 — SLICE A (identity half): Workload binding, Account
 * Token claims, and Managed Access Session (arch/16 §2 Subject/Device,
 * §6 Managed Access). Append-only alongside part 1 above; same strict,
 * closed v1 surface and the same `CHECKPOINT_CONTRACT_VERSION`.
 *
 * Scope discipline (what this slice deliberately does NOT freeze):
 *   - Binding a Workload to a concrete ServiceInstance / Runner is **target
 *     admission** (arch/16 §7.2) and is NOT modeled here.
 *   - Platform-Owned-Exposure administration (§5) / policy administration
 *     (§7) and the approval half of #60 are separate slices.
 *   - "Version ticks" below are LOGICAL monotonic version numbers, NOT
 *     wall-clock time. The tick source / clock is a Platform concern and is
 *     intentionally out of this wire contract.
 *   - Session cancellation is NOT a state (see ManagedAccessSessionState).
 * ================================================================== */

/**
 * Shared lowercase-kebab pattern for a **logical Service id** — the SAME
 * pattern part 1 pins inline on `CheckpointVersionId.serviceId`, so a legacy
 * underscore-bearing `svc_*` instance id is rejected here too. Extracted as a
 * named const so the part-2 identity schemas reference one pattern instead of
 * re-spelling the literal. Part 1's own inline copies are intentionally left
 * byte-unchanged — the value is identical, so behavior is unchanged either way.
 */
const SERVICE_ID_KEBAB = /^[a-z][a-z0-9-]*$/;

/**
 * Core-SemVer `x.y.z` pattern reused from part 1's `checkpointVersion` (no
 * leading zeros, no prerelease/build metadata). Extracted as a named const for
 * the version-tick fields below; part 1's inline copy is left byte-unchanged.
 */
const CORE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * A **logical version tick**: a core-SemVer string used as a monotonic ordinal,
 * NOT a wall-clock timestamp. Ordering is by {@link compareVersionTick}. Using
 * an opaque wall-clock time would drag timezone/precision/leap-second
 * cross-language hazards onto the wire; a version tick is a total order every
 * language compares identically.
 */
const VersionTickSchema = z
  .string()
  .regex(CORE_SEMVER, "version tick is core SemVer x.y.z (a LOGICAL monotonic tick, not wall-clock)");

/**
 * Reused logical-Service-id field (kebab; rejects `svc_*`). A single shared
 * `ZodString` instance referenced by every part-2 schema that carries a
 * `serviceId`, so the pattern + message are defined exactly once.
 */
export const LogicalServiceIdSchema = z
  .string()
  .min(1)
  .regex(SERVICE_ID_KEBAB, "serviceId is a logical Service id (lowercase kebab); a legacy svc_* instance id is rejected");

/**
 * Opaque, stable, **non-PII** device identifier: lowercase alphanumeric plus
 * hyphen or underscore, starting with an alphanumeric, 8..128 characters. It
 * is a random handle, NOT a hardware serial / MAC / user-derived value — the
 * wire contract deliberately keeps it structureless so no consumer parses
 * meaning out of it. Underscore and the 128-char bound were added in #118
 * (platform-ce#215 implementation finding): the Platform has minted Device
 * handles as `dev_` + 32 hex since platform-ce#148, and a `ChannelBinding`
 * naming one must parse — the pattern describes the handle the Platform
 * actually issues, while staying lowercase/URL-safe and separator-free for
 * the `*Key` helpers (U+001F is still impossible).
 */
const DEVICE_ID = /^[a-z0-9][a-z0-9_-]{7,127}$/;
const DeviceIdSchema = z
  .string()
  .regex(DEVICE_ID, "deviceId is an opaque, stable, non-PII handle (lowercase alnum + hyphen/underscore, 8..128 chars)");

/**
 * Opaque, non-structured id for a session / principal: a bounded URL-safe token
 * with no separators or whitespace. It carries no parsed structure on the wire
 * (unlike the typed Resource / Checkpoint identities), so no consumer derives
 * meaning from its bytes.
 */
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OpaqueIdSchema = z
  .string()
  .regex(OPAQUE_ID, "opaque id: URL-safe, no separators/whitespace, 1..128 chars");

/**
 * Total order on logical version ticks. Returns `-1 | 0 | 1`. Both inputs are
 * validated (fail closed) so a malformed tick throws rather than sorting
 * ambiguously. Each of the three SemVer components is compared as an arbitrary-
 * precision **BigInt**, never a JS `number`: a version tick is a monotonic
 * ordinal with no upper bound, and `Number` would silently lose precision above
 * `2^53` (e.g. `…740993` and `…740992` would compare as equal). The `\d+`
 * no-leading-zero regex (via {@link VersionTickSchema}) guarantees each segment
 * is a clean decimal integer literal that `BigInt` parses exactly.
 */
export function compareVersionTick(a: string, b: string): -1 | 0 | 1 {
  const pa = VersionTickSchema.parse(a).split(".");
  const pb = VersionTickSchema.parse(b).split(".");
  for (let i = 0; i < 3; i++) {
    const x = BigInt(pa[i] as string);
    const y = BigInt(pb[i] as string);
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * A monotonic policy-revision counter (Account Token (formerly Device Token,
 * docs#180) revision, credential revision) carried on the wire as a
 * **decimal string**, not a JSON number.
 * A revision is an unbounded non-negative integer; a JSON `number` would
 * silently collide above `2^53` (e.g. `…740993` and `…740992` round to the
 * same double), so distinct revisions could compare equal. The
 * no-leading-zero regex (`0` or a non-zero leading digit) guarantees one
 * canonical spelling per value and a clean `BigInt` parse.
 */
const REVISION_RE = /^(0|[1-9]\d*)$/;
export const RevisionSchema = z
  .string()
  .regex(REVISION_RE, "revision is a non-negative integer as a decimal string (JSON-number-safe; avoids >2^53 collisions)");
export type Revision = z.infer<typeof RevisionSchema>;

/**
 * Total order on revision counters. Returns `-1 | 0 | 1`. Both inputs are
 * validated (fail closed) and compared as arbitrary-precision **BigInt** — the
 * same precision discipline as {@link compareVersionTick} — so revisions above
 * `2^53` order exactly. Exported for consumers that must compare revisions
 * (e.g. an issuer/Platform enforcing revision monotonicity); the scope predicate
 * {@link isTightening} deliberately does NOT impose revision ordering itself.
 */
export function compareRevision(a: string, b: string): -1 | 0 | 1 {
  const x = BigInt(RevisionSchema.parse(a));
  const y = BigInt(RevisionSchema.parse(b));
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

/* ------------------------------------------------------------------ *
 * A1. Workload reference (arch/16 §2)
 * ------------------------------------------------------------------ */

/**
 * The two kinds of authorization workload a grant may bind: an immutable
 * Checkpoint version, or a Resource. Closed enum — a new kind is not
 * wire-additive on this strict surface.
 */
export const WorkloadKind = ["checkpoint", "resource"] as const;
export const WorkloadKindSchema = z.enum(WorkloadKind);
export type WorkloadKind = (typeof WorkloadKind)[number];

/**
 * A reference to a single authorization workload, scoped to a logical Service.
 * `workloadKind` is the discriminator; `ref` is the matching identity:
 *
 *   - `checkpoint` -> a {@link CheckpointVersionIdSchema} (its own `serviceId`
 *     MUST equal the top-level `serviceId`, enforced below — one spelling of the
 *     service, never two that can disagree);
 *   - `resource`   -> a {@link ResourceReferenceSchema}. A ResourceReference has
 *     no service of its own, so the top-level `serviceId` is what scopes the
 *     Resource to a Service.
 *
 * Part 1 has no dedicated "resource version id"; the canonical Resource identity
 * in part 1 is `ResourceReference` (typed segment chain), which is what the
 * `resource` arm reuses.
 *
 * **Deliberately NOT here:** binding this workload to a concrete
 * ServiceInstance / Runner / artifact is target admission (arch/16 §7.2), a
 * separate slice.
 */
export const WorkloadRefSchema = z
  .discriminatedUnion("workloadKind", [
    z
      .object({
        serviceId: LogicalServiceIdSchema,
        workloadKind: z.literal("checkpoint"),
        ref: CheckpointVersionIdSchema,
      })
      .strict(),
    z
      .object({
        serviceId: LogicalServiceIdSchema,
        workloadKind: z.literal("resource"),
        ref: ResourceReferenceSchema,
      })
      .strict(),
  ])
  .superRefine((w, ctx) => {
    // Checkpoint identity already carries a serviceId; it must not contradict
    // the workload's own serviceId, or the canonical key would be ambiguous.
    if (w.workloadKind === "checkpoint" && w.ref.serviceId !== w.serviceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checkpoint ref.serviceId must equal the workload serviceId",
        path: ["ref", "serviceId"],
      });
    }
  });
export type WorkloadRef = z.infer<typeof WorkloadRefSchema>;

/**
 * Canonical, collision-free key for a Workload, used for subset comparison in
 * {@link isTightening}. Validates + fails closed (see part 1's identity-helper
 * note): a caller cannot pass an unvalidated ref whose fields carry the
 * separator and collide with another key. The separator is U+001F (unit
 * separator), which cannot appear in any validated sub-field — kebab ids,
 * core-SemVer, `checkpointVersionKey` (`/`,`@`), or the percent-encoded
 * canonical Resource string — so distinct workloads never share a key.
 */
const WORKLOAD_KEY_SEP = "\u001f";
export function workloadKey(ref: WorkloadRef): string {
  const w = WorkloadRefSchema.parse(ref);
  if (w.workloadKind === "checkpoint") {
    return `checkpoint${WORKLOAD_KEY_SEP}${checkpointVersionKey(w.ref)}`;
  }
  return `resource${WORKLOAD_KEY_SEP}${w.serviceId}${WORKLOAD_KEY_SEP}${canonicalResourceString(w.ref.segments)}`;
}

/* ------------------------------------------------------------------ *
 * A1b. Account + Account Token identity refs (arch/16 §2, §165, §192)
 *
 * Defined here (ahead of the Account Token claims and the Managed Access
 * Session) because both the claims and the session bind these same refs. Each
 * is a MINIMAL id/revision ref; the full Account / token-policy internal models
 * are deferred to later slices. Neither carries `contractVersion` — they are
 * sub-refs of the top-level documents that embed them.
 * ------------------------------------------------------------------ */

/**
 * Reference to the Account delegation principal (§2 Account: the authenticated
 * rights-and-responsibility principal). §165: an Account Token represents the
 * Account plus the delegated scope, so both an Account Token's claims and a
 * Managed Access Session name the Account they delegate. Minimal by design —
 * the Account's internal model (human/AI/automation/service, entitlement) is
 * deferred to a later slice.
 */
export const AccountRefSchema = z
  .object({
    accountId: OpaqueIdSchema,
  })
  .strict();
export type AccountRef = z.infer<typeof AccountRefSchema>;

/**
 * Reference to an Account Token: its identifier and revision (§192 "Account Token
 * identifier and revision"). `revision` is a **monotonic token-policy revision
 * counter** (§219 tightening creates a new revision) carried as a JSON-number-
 * safe decimal string (see {@link RevisionSchema}), NOT a logical version tick.
 * The token's policy scope (allowed Services/Checkpoints/Resources/limits) is
 * deferred to a later slice.
 */
export const AccountTokenRefSchema = z
  .object({
    tokenId: OpaqueIdSchema,
    revision: RevisionSchema,
  })
  .strict();
export type AccountTokenRef = z.infer<typeof AccountTokenRefSchema>;

/**
 * Optional usage-channel binding of an Account Token (docs#180 / arch/16 after
 * docs#181): the token itself belongs to the **Account** — a binding never
 * changes who the token delegates, it only CONSTRAINS the channel the token may
 * be used through. CLOSED discriminated union on `kind`, three expressible
 * states via the (optional) `channelBinding` claims field:
 *
 *   - absent                      — **unbound**: usable from any channel;
 *   - `{ kind: "device", deviceId }` — bound to one Device (the opaque, stable,
 *     non-PII {@link DeviceIdSchema} handle);
 *   - `{ kind: "device-instance", deviceId, deviceInstanceId }` — bound to one
 *     concrete instance OF that Device. The branch carries the full
 *     `(deviceId, deviceInstanceId)` pair — the instance id alone would be a
 *     second, ambiguous spelling of the device identity — matching the
 *     platform-persisted `boundDeviceId` / `boundDeviceInstanceId` columns
 *     (platform-ce#150: mint allows both or neither — i.e. this union or
 *     absence; an instance id without its device is not mintable).
 *
 * This is deliberately NOT {@link DeviceInstanceRefSchema}: that ref identifies
 * a session's Device Instance by `(deviceType, deviceInstanceId)` — a logical
 * Device *kind* — whereas a channel binding pins one concrete Device *handle*.
 *
 * Tightening across bindings is defined by {@link isTightening}: each new
 * revision may only keep or NARROW the channel (unbound -> device-bound ->
 * instance-bound on the SAME device); removing or swapping a binding widens.
 */
export const ChannelBindingSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("device"),
      deviceId: DeviceIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("device-instance"),
      deviceId: DeviceIdSchema,
      deviceInstanceId: OpaqueIdSchema,
    })
    .strict(),
]);
export type ChannelBinding = z.infer<typeof ChannelBindingSchema>;

/* ------------------------------------------------------------------ *
 * A2. Account Token claims (arch/16 §2/§6)
 * ------------------------------------------------------------------ */

/**
 * The claims carried by an Account Token. §165: an Account Token represents the
 * **Account plus the delegated scope**, so the claims bind both the token's own
 * identity and the Account it delegates:
 *
 *   - `token` — this token's own {@link AccountTokenRefSchema} (`{tokenId,
 *     revision}`); the `revision` here IS the Account Token policy revision;
 *   - `account` — the {@link AccountRefSchema} this token delegates.
 *
 * These let a verifier prove the claims belong to the Account and Account Token
 * revision recorded in a Managed Access Session (§192 the session binds the
 * Account Token identifier + revision).
 *
 * All three version fields are LOGICAL version ticks (see {@link
 * VersionTickSchema}), never wall-clock time:
 *
 *   - `issuedAtVersion`   — issuance tick (metadata; not part of the validity
 *     window comparison in {@link isTightening});
 *   - `notBeforeVersion`  — first tick at which the token is valid;
 *   - `expiresAtVersion`  — last tick at which the token is valid.
 *
 * `boundWorkloads` (>= 1) is the exhaustive set of workloads this token may act
 * on. `tighteningOnly` is frozen to the literal `true`: an Account Token can only
 * ever be re-derived into a *narrower* token, never a broader one — {@link
 * isTightening} is the machine check for a proposed re-derivation.
 *
 * **Deliberately NOT frozen:** a self-consistency `notBefore <= expires`
 * refinement is intentionally omitted here (window ordering across a
 * re-derivation is what `isTightening` governs); and no wall-clock / clock-skew
 * fields are introduced.
 *
 * As a top-level wire document it carries `contractVersion` (the literal
 * `CHECKPOINT_CONTRACT_VERSION`) as its first field, mirroring part 1's
 * `CheckpointDefinitionSchema`; the sub-refs it embeds (WorkloadRef) do not, so
 * the version is stated exactly once per document.
 */
export const AccountTokenClaimsSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    token: AccountTokenRefSchema,
    account: AccountRefSchema,
    /**
     * Optional usage-channel constraint (see {@link ChannelBindingSchema}).
     * Absent = unbound: the token belongs to the Account and is usable from any
     * channel. Round-1 runtime (platform-ce#148) MAY refuse to establish a
     * session from an unbound token — that is a runtime profile, not a limit on
     * what these claims can express.
     */
    channelBinding: ChannelBindingSchema.optional(),
    issuedAtVersion: VersionTickSchema,
    notBeforeVersion: VersionTickSchema,
    expiresAtVersion: VersionTickSchema,
    boundWorkloads: z.array(WorkloadRefSchema).min(1),
    /**
     * Narrow-only scope axes (#117, promoted from the Platform-local token
     * policy; arch/16 §"An Account Token may be bound to" names all three).
     * ABSENT means UNLIMITED on that axis — and under {@link isTightening} an
     * axis may go absent→present (a narrowing) but never present→absent (a
     * return to unlimited).
     *
     *   - `allowedServices` — logical Service ids the token may reach, in the
     *     canonical wire order (STRICT ASCENDING by code unit, §454/§462 like
     *     Service Selection; rejects duplicates).
     *   - `allowedCheckpoints` — BARE logical checkpointIds (dot-delimited
     *     kebab, NO version): the round-1 semantics the Platform's discovery
     *     already enforces, frozen as-is by the owner's naming ruling. A
     *     versioned narrowing is a later, deliberate change.
     *   - `riskCeiling` — the highest {@link RiskLevel} the token may invoke;
     *     tightening may only LOWER it (rank comparison).
     *
     * `resourceSelectors` is deliberately NOT promoted: the Platform stores it
     * without interpreting it (any change is rejected wholesale), and a
     * contract field whose narrowing no consumer can evaluate would be a
     * guarantee nobody enforces. It stays Platform-local until Resource
     * narrowing semantics exist (recorded on #117).
     */
    allowedServices: z
      .array(z.string().min(1).regex(/^[a-z][a-z0-9-]*$/, "allowedServices entries are logical Service ids (lowercase kebab)"))
      .min(1)
      .superRefine((services, ctx) => {
        for (let i = 0; i + 1 < services.length; i++) {
          if (services[i] >= services[i + 1]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "allowedServices must be in strict ascending order by Unicode code unit (canonical wire order; also rejects duplicates)",
              path: [i + 1],
            });
            return;
          }
        }
      })
      .optional(),
    allowedCheckpoints: z
      .array(z.string().min(1).regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/, "allowedCheckpoints entries are BARE logical checkpointIds (dot-delimited kebab, no version)"))
      .min(1)
      .superRefine((ids, ctx) => {
        for (let i = 0; i + 1 < ids.length; i++) {
          if (ids[i] >= ids[i + 1]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "allowedCheckpoints must be in strict ascending order by Unicode code unit (canonical wire order; also rejects duplicates)",
              path: [i + 1],
            });
            return;
          }
        }
      })
      .optional(),
    riskCeiling: RiskLevelSchema.optional(),
    /** frozen: an Account Token re-derivation may only narrow, never widen. */
    tighteningOnly: z.literal(true),
  })
  .strict();
export type AccountTokenClaims = z.infer<typeof AccountTokenClaimsSchema>;

/**
 * Channel-binding half of the tightening lattice (unbound ⊒ device-bound ⊒
 * instance-bound). `true` IFF `next` is the same binding or a strict narrowing
 * of `prev` — see the rule table on {@link isTightening}. Internal: callers go
 * through `isTightening`, which schema-validates both claims first.
 */
function isChannelBindingTightening(prev: ChannelBinding | undefined, next: ChannelBinding | undefined): boolean {
  // unbound may stay unbound or be narrowed to any device / instance binding.
  if (prev === undefined) return true;
  // removing an existing binding is a widening.
  if (next === undefined) return false;
  if (prev.kind === "device") {
    // same device: stay device-bound, or narrow to one instance OF that device.
    return next.deviceId === prev.deviceId;
  }
  // instance-bound: only the IDENTICAL (deviceId, deviceInstanceId) — relaxing
  // back to device-bound or swapping instance/device is a widening.
  return (
    next.kind === "device-instance" &&
    next.deviceId === prev.deviceId &&
    next.deviceInstanceId === prev.deviceInstanceId
  );
}

/**
 * True IFF `next` is a **subset-or-stricter** re-derivation of `prev` — the only
 * legal Account Token re-derivation direction (`tighteningOnly`). Fails closed:
 * both inputs are re-parsed, so a structurally-forged claim throws rather than
 * being silently treated as a tightening. A tightening is a **new revision of
 * the SAME token delegating the SAME Account**, so `next` is a tightening IFF:
 *
 *   1. it delegates the SAME `account.accountId` and is a revision of the SAME
 *      `token.tokenId` (a different Account or a different token is never a
 *      tightening of this one — the conservative answer is `false`);
 *   2. its `channelBinding` only stays or NARROWS along the binding lattice
 *      (unbound ⊒ device-bound ⊒ instance-bound):
 *        - unbound        -> unbound / device-bound / instance-bound  (narrow);
 *        - device-bound   -> the SAME `deviceId`, either still device-bound or
 *          instance-bound to an instance OF that device;
 *        - instance-bound -> only the IDENTICAL `(deviceId, deviceInstanceId)`.
 *      REMOVING a binding, SWAPPING to a different device/instance, or relaxing
 *      instance-bound back to device-bound is a WIDENING — `false`. (Round-1
 *      runtime, platform-ce#148, may separately refuse sessions from unbound
 *      tokens; that is a runtime profile, not part of this claims predicate.)
 *   3. its validity window only shrinks: `notBefore >= prev.notBefore` AND
 *      `expires <= prev.expires` (version-tick ordering); and
 *   4. its `boundWorkloads` are a subset of `prev.boundWorkloads`, compared by
 *      the canonical {@link workloadKey}.
 *
 * Any widening — a later `expires`, an earlier `notBefore`, an added workload,
 * a removed/swapped channel binding, or a changed token/account — yields
 * `false`. This predicate does NOT
 * impose an ordering on `token.revision`: revision monotonicity (a tightening
 * yields a strictly newer revision) is enforced by the issuer/Platform, not by
 * this scope-subset check. `issuedAtVersion` is issuance metadata and is
 * deliberately not part of the window comparison.
 */
export function isTightening(prev: AccountTokenClaims, next: AccountTokenClaims): boolean {
  const p = AccountTokenClaimsSchema.parse(prev);
  const n = AccountTokenClaimsSchema.parse(next);
  // a tightening re-derives the SAME token delegating the SAME Account; a
  // different token/account is not a narrowing of this one.
  if (p.account.accountId !== n.account.accountId) return false;
  if (p.token.tokenId !== n.token.tokenId) return false;
  if (!isChannelBindingTightening(p.channelBinding, n.channelBinding)) return false;
  // window start may only move later-or-equal; window end only earlier-or-equal.
  if (compareVersionTick(n.notBeforeVersion, p.notBeforeVersion) < 0) return false;
  if (compareVersionTick(n.expiresAtVersion, p.expiresAtVersion) > 0) return false;
  const prevKeys = new Set(p.boundWorkloads.map(workloadKey));
  if (!n.boundWorkloads.every((w) => prevKeys.has(workloadKey(w)))) return false;
  // #117 narrow-only scope axes: absent = unlimited. absent→present narrows;
  // present→absent would RETURN to unlimited and is refused; a present list
  // may only shrink (subset); a present ceiling may only lower (rank).
  if (!isScopeListTightening(p.allowedServices, n.allowedServices)) return false;
  if (!isScopeListTightening(p.allowedCheckpoints, n.allowedCheckpoints)) return false;
  if (p.riskCeiling !== undefined && n.riskCeiling === undefined) return false;
  if (p.riskCeiling !== undefined && n.riskCeiling !== undefined && riskRank(n.riskCeiling) > riskRank(p.riskCeiling)) return false;
  return true;
}

/** Absent = unlimited; absent→present narrows; present→absent widens (refused); present→present must be a subset. */
function isScopeListTightening(prev: string[] | undefined, next: string[] | undefined): boolean {
  if (next === undefined) return prev === undefined;
  if (prev === undefined) return true;
  const allowed = new Set(prev);
  return next.every((entry) => allowed.has(entry));
}

/* ------------------------------------------------------------------ *
 * A4. Principal reference (arch/16 §2 Originator / Responsibility Owner)
 * ------------------------------------------------------------------ */

/**
 * Principal actor kind, **aligned with `AuditActorType`** (USER/AGENT/SYSTEM)
 * so a principal and its audit trail speak one vocabulary. Defined locally to
 * keep this module self-contained (part 1 imports only `zod`); the value set is
 * deliberately identical to the CE audit actor enum.
 */
export const PrincipalType = ["USER", "AGENT", "SYSTEM"] as const;
export const PrincipalTypeSchema = z.enum(PrincipalType);
export type PrincipalType = (typeof PrincipalType)[number];

/**
 * A principal reference (human user, autonomous AI agent, or the system
 * itself; `AGENT` here is the arch/16 §3 AI-originator sense, NOT a
 * Connector) — the
 * actor/approver identity consumed by later slices (the approval half of #60)
 * and by audit (§2 Originator / Responsibility Owner). It is NOT one arm of a
 * mutually-exclusive session subject: a Managed Access Session is a COMPOSITE
 * binding (§2, §6), modeled by {@link ManagedAccessSessionSchema} below, not by
 * an either/or subject.
 */
export const PrincipalRefSchema = z
  .object({
    principalType: PrincipalTypeSchema,
    principalId: OpaqueIdSchema,
  })
  .strict();
export type PrincipalRef = z.infer<typeof PrincipalRefSchema>;

/* ------------------------------------------------------------------ *
 * A5. Service Selection (arch/16 §49, §440-§465)
 * ------------------------------------------------------------------ */

/**
 * Per-connection Service Selection — a **context filter, not an authorization
 * grant** (§49). It narrows which authorized Services are projected to a Device;
 * it never adds authority. Modeled as a CLOSED discriminated union on `scope`
 * so "all" is a distinct, explicit branch rather than an empty array — an empty
 * `services: []` that meant "all" would be an anti-fail-closed footgun.
 *
 *   - `{ scope: "all" }`      — all Services allowed by the Account Token's
 *     Account delegation + Platform policy (§445: absence of `s=` selects all
 *     permitted Services).
 *   - `{ scope: "explicit", services }` — the MCP `s=`/`services=` normalized
 *     set (§450 `s=self,linux-ops-widget-nodejs`): >= 1 logical Service id, in canonical wire
 *     order. `self` is a valid Service id — the reserved `xtrape-server` self
 *     projection (§12/§498) — and matches the kebab regex. `xtrape-server` is
 *     a **frozen wire value** (the Platform's own self-projection id); the
 *     Server→Platform rename is symbol- and prose-level only.
 *
 * **Canonical wire ordering (§454, §462):** the `services` array MUST be in
 * STRICT ASCENDING order by Unicode code unit. Two selections that differ only
 * in order (`["self","linux-ops-widget-nodejs"]` vs `["linux-ops-widget-nodejs","self"]`) are semantically
 * equal but distinct wire values, which would fork any session/cache identity
 * keyed on the wire bytes; a single canonical order collapses them. Strict
 * ascending also subsumes the §454 duplicate fail-safe (equal adjacent ids
 * violate the ordering). A non-canonical array is **REJECTED, not silently
 * sorted** — mirroring the NfcString reject-not-transform discipline — so a
 * producer must canonicalize first (see {@link canonicalizeServiceSelection}).
 */
export const ServiceSelectionSchema = z
  .discriminatedUnion("scope", [
    z.object({ scope: z.literal("all") }).strict(),
    z
      .object({
        scope: z.literal("explicit"),
        services: z.array(LogicalServiceIdSchema).min(1),
      })
      .strict(),
  ])
  // Ordering check lives on the union (a discriminatedUnion arm must be a bare
  // ZodObject, not a ZodEffects). §454/§462: the explicit set has one canonical
  // wire spelling — STRICT ASCENDING by code unit. Reject (never silently sort)
  // when any adjacent pair is out of order; strict-ascending also rejects
  // duplicates (an equal adjacent pair is not strictly increasing).
  .superRefine((s, ctx) => {
    if (s.scope !== "explicit") return;
    for (let i = 0; i + 1 < s.services.length; i++) {
      if ((s.services[i] as string) >= (s.services[i + 1] as string)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "explicit Service Selection must be in strict ascending order by Unicode code unit (canonical wire order; also rejects duplicates, §454/§462) — canonicalize the producer's set first",
          path: ["services", i + 1],
        });
        return;
      }
    }
  });
export type ServiceSelection = z.infer<typeof ServiceSelectionSchema>;

/** True IFF the selection is the "all permitted Services" filter (§445). */
export function isAllServicesSelection(sel: ServiceSelection): boolean {
  return ServiceSelectionSchema.parse(sel).scope === "all";
}

/**
 * Strict input schema for {@link canonicalizeServiceSelection}: identical to
 * {@link ServiceSelectionSchema} EXCEPT it omits the strict-ascending ordering
 * invariant, so an unordered or duplicate-bearing explicit `services` array is
 * accepted for normalization. It still fails closed on an unknown `scope`
 * branch, unknown fields, an empty explicit array, or an invalid Service id.
 */
const ServiceSelectionInputSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }).strict(),
  z
    .object({
      scope: z.literal("explicit"),
      services: z.array(LogicalServiceIdSchema).min(1),
    })
    .strict(),
]);

/**
 * Producer helper that returns the canonical form of a Service Selection: a
 * `{scope:"all"}` selection is returned unchanged; an explicit selection is
 * returned with its `services` sorted STRICT ASCENDING by Unicode code unit and
 * de-duplicated, so the result satisfies {@link ServiceSelectionSchema}'s
 * canonical-wire-order invariant. Fails closed on the input (each id is still
 * validated against the kebab {@link LogicalServiceIdSchema}); the schema rejects
 * non-canonical arrays, so producers call this before sending.
 */
export function canonicalizeServiceSelection(sel: ServiceSelection): ServiceSelection {
  // Fail closed at the entry, like every other public helper here: strictly
  // parse the input with a schema identical to ServiceSelectionSchema EXCEPT it
  // omits the ascending-order invariant (canonicalization exists precisely to
  // impose that order, so unordered/duplicate input is the legal case). It still
  // rejects an unknown scope branch, unknown fields, an empty explicit array,
  // and an invalid Service id — a caller that casts `as never` cannot slip a
  // malformed value through.
  const input = ServiceSelectionInputSchema.parse(sel);
  if (input.scope === "all") return { scope: "all" };
  const canonical = [...new Set(input.services)].sort();
  // Validate the OUTPUT before returning: the result must itself satisfy the
  // full ServiceSelectionSchema (including the ascending invariant). `.sort()`
  // orders by UTF-16 code unit, matching the schema's code-unit comparison.
  return ServiceSelectionSchema.parse({ scope: "explicit", services: canonical });
}

/* ------------------------------------------------------------------ *
 * A6. Managed Access Session identity sub-refs (arch/16 §2 domain table)
 *
 * Each is a MINIMAL id/revision ref naming exactly what the canonical composite
 * binding (§2, §6) names — the full Account / Device / credential / auth-context
 * internal models are deliberately deferred to later slices. None carries
 * `contractVersion`: they are sub-refs of the top-level session document.
 * ------------------------------------------------------------------ */

/**
 * Shared lowercase-kebab pattern for a **Device type** (§2 Device: a LOGICAL
 * access device — `xtrape-mcp`, `xtrape-panel`, `xtrape-telegram`, `cli`, or a
 * future application — not necessarily physical hardware). Reuses the same kebab
 * regex as a Service id; the string set overlaps deliberately (`cli` etc.).
 */
const DeviceTypeSchema = z
  .string()
  .min(1)
  .regex(SERVICE_ID_KEBAB, "deviceType is a logical Device type (lowercase kebab), e.g. xtrape-mcp/xtrape-panel/cli");

/**
 * Reference to one authenticated Device Instance (§2 Device Instance: one
 * runtime instance / session-bearing installation of a Device). Minimal:
 * logical Device type + an opaque instance id. The authentication/credential
 * detail lives on the Device Workload Identity, not here.
 */
export const DeviceInstanceRefSchema = z
  .object({
    deviceType: DeviceTypeSchema,
    deviceInstanceId: OpaqueIdSchema,
  })
  .strict();
export type DeviceInstanceRef = z.infer<typeof DeviceInstanceRefSchema>;

/**
 * Reference to the Device Workload Identity operating a Device Instance (§2,
 * §35). It is bound to **one** Device Instance and **one** credential revision
 * and is DISTINCT from the Account delegation carried by the Account Token. It
 * carries the FULL Device Instance identity — both `deviceType` and
 * `deviceInstanceId` (§2 a Device Instance is identified by its `(deviceType,
 * deviceInstanceId)` pair, not the instance id alone) — and the session binding
 * enforces that this full pair equals the session's {@link
 * DeviceInstanceRefSchema} (§35 single-instance binding). `credentialRevision`
 * is a monotonic counter as a JSON-number-safe decimal string (see {@link
 * RevisionSchema}), not a version tick. The credential material itself is never
 * on the wire; only its identity + revision.
 */
export const DeviceWorkloadIdentityRefSchema = z
  .object({
    workloadIdentityId: OpaqueIdSchema,
    credentialRevision: RevisionSchema,
    deviceType: DeviceTypeSchema,
    deviceInstanceId: OpaqueIdSchema,
  })
  .strict();
export type DeviceWorkloadIdentityRef = z.infer<typeof DeviceWorkloadIdentityRefSchema>;

/**
 * Minimal reference to the authentication context a session is bound to (§2, §6
 * "authentication context"). The §9 authentication-requirement structure
 * (methods, MFA, freshness, step-up) is deliberately deferred to a later slice;
 * only the opaque id is fixed on the wire here.
 */
export const AuthenticationContextRefSchema = z
  .object({
    authenticationContextId: OpaqueIdSchema,
  })
  .strict();
export type AuthenticationContextRef = z.infer<typeof AuthenticationContextRefSchema>;

/* ------------------------------------------------------------------ *
 * A3. Managed Access Session (arch/16 §2 domain table, §6)
 * ------------------------------------------------------------------ */

/**
 * Lifecycle state of a Managed Access Session. Closed enum. Aligned with the
 * Studio Platform-state discipline there is **no `CANCELLED` state** (no
 * cancel/expiry mid-flight). Terminal tightening/revocation propagation (§219)
 * is modeled explicitly:
 *
 *   - `ACTIVE`      — issued and usable.
 *   - `CLOSED`      — orderly termination.
 *   - `EXPIRED`     — bounded lifetime window elapsed.
 *   - `REVOKED`     — explicit revocation of the session or its authority.
 *   - `INVALIDATED` — authority derived from an older token-policy revision was
 *     superseded by a tightening (§219 revocation-like propagation): the older
 *     broader session is not usable until natural expiry.
 */
export const ManagedAccessSessionState = ["ACTIVE", "CLOSED", "EXPIRED", "REVOKED", "INVALIDATED"] as const;
export const ManagedAccessSessionStateSchema = z.enum(ManagedAccessSessionState);
export type ManagedAccessSessionState = (typeof ManagedAccessSessionState)[number];

/**
 * The two ways a Managed Access Session's **establishing authority context** is
 * formed (arch/16 §6.1; docs#278): `credential-pair` (Account Token + Device
 * Workload credential) or `device-authenticated` (the operator's product login,
 * resolved Platform-side; the authentication-context reference is an IMMUTABLE
 * generation identity — §6.1 rule 5, the identifier IS the revision). One
 * authority model, two establishment paths; there is no third form.
 */
export const ManagedAccessSessionEstablishment = ["credential-pair", "device-authenticated"] as const;
export const ManagedAccessSessionEstablishmentSchema = z.enum(ManagedAccessSessionEstablishment);
export type ManagedAccessSessionEstablishment = (typeof ManagedAccessSessionEstablishment)[number];

/**
 * Canonical defaulting rule for the `establishment` discriminator (same
 * discipline as interaction 0.8.10's `AccessSessionSchema`): a document that
 * does not name its establishment path IS a credential-pair document — every
 * pre-dual-form scope/session was one, so existing credential-pair bytes keep
 * parsing unchanged. This is a defaulting rule, not a compatibility middle
 * state: parse OUTPUT always carries the discriminator explicitly, and
 * producers emit it explicitly.
 */
const defaultEstablishmentToCredentialPair = (v: unknown): unknown =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !("establishment" in v)
    ? { ...(v as Record<string, unknown>), establishment: "credential-pair" }
    : v;

/**
 * A Managed Access Session (arch/16 §2 domain table line, §6): a Platform-issued
 * session that is a **COMPOSITE binding** of an Account delegation, an Account
 * Token (id + revision), a Device Workload Identity, a Device Instance, a
 * Service Selection, an authentication context, and a bounded lifetime — NOT a
 * single either/or subject. It cannot exceed the authority it was derived from.
 *
 * `createdAtVersion` / `expiresAtVersion` are LOGICAL version ticks (see
 * {@link VersionTickSchema}), not wall-clock time. As a top-level wire document
 * it carries `contractVersion` first (mirroring part 1's CheckpointDefinition);
 * its sub-refs do not.
 *
 * The session names its **establishing authority context** explicitly (arch/16
 * §6.1; docs#278) — a discriminated union on `establishment`, with each
 * branch's obligations expressed by the SCHEMA (runtime and TS state one
 * truth; interaction#8/#9 lesson):
 *
 *   - `credential-pair` — established from an Account Token + Device Workload
 *     credential: `accountToken` (id + revision) and `deviceWorkloadIdentity`
 *     (+ `credentialRevision`) are REQUIRED, exactly the pre-dual-form shape
 *     (an absent `establishment` parses as this branch — the canonical
 *     defaulting rule above — so existing documents are unchanged bytes);
 *   - `device-authenticated` — established from the operator's product login,
 *     resolved Platform-side: the `authenticationContext` reference IS the
 *     establishing authority (§6.1 rule 5 — an immutable generation identity,
 *     the identifier is the revision) together with the bound
 *     `deviceInstance`. There is no token identity and none may be fabricated:
 *     `accountToken` / `deviceWorkloadIdentity` are invalid IF PRESENT
 *     (`z.never()`), the same discipline as interaction 0.8.10's
 *     `AccessSessionSchema`.
 *
 * Fail-closed cross-field invariants:
 *   1. (`credential-pair` only) the Device Workload Identity is bound to the
 *      SAME Device Instance the session binds — the FULL `(deviceType,
 *      deviceInstanceId)` identity must match, not the instance id alone
 *      (§35 single-instance binding, §2);
 *   2. the lifetime window is well-ordered (`createdAtVersion <= expiresAtVersion`)
 *      — a concrete issued session cannot expire before it was created.
 *
 * **Deliberately NOT frozen:** the transport / issuance of the session, the
 * exposure & policy that authorize the Service Selection (§5, §7), the full
 * Account / credential / auth-context internal models, and any wall-clock or
 * heartbeat semantics — all later slices.
 */
// (the doc comment above describes ManagedAccessSessionSchema below; these two
// helpers are shared with the embedded binding snapshot in slice C1.2c)
const managedAccessSessionCommonFields = {
  sessionId: OpaqueIdSchema,
  account: AccountRefSchema,
  deviceInstance: DeviceInstanceRefSchema,
  serviceSelection: ServiceSelectionSchema,
  authenticationContext: AuthenticationContextRefSchema,
  createdAtVersion: VersionTickSchema,
  expiresAtVersion: VersionTickSchema,
  state: ManagedAccessSessionStateSchema,
} as const;

/** The invariants shared by the standalone session document and the embedded binding snapshot. */
function managedAccessSessionInvariants(
  s: {
    establishment: ManagedAccessSessionEstablishment;
    deviceWorkloadIdentity?: DeviceWorkloadIdentityRef;
    deviceInstance: DeviceInstanceRef;
    createdAtVersion: string;
    expiresAtVersion: string;
  },
  ctx: z.RefinementCtx,
): void {
  // §35/§2 (credential-pair): the Device Workload Identity is bound to ONE
  // Device Instance; the FULL (deviceType, deviceInstanceId) identity in this
  // binding must name the same instance — matching the instance id alone would
  // let a workload bound to one deviceType ride a session for a different
  // deviceType. The device-authenticated branch carries no workload identity,
  // so the invariant has no subject there (the schema already rejects presence).
  if (
    s.establishment === "credential-pair" &&
    s.deviceWorkloadIdentity !== undefined &&
    (s.deviceWorkloadIdentity.deviceType !== s.deviceInstance.deviceType ||
      s.deviceWorkloadIdentity.deviceInstanceId !== s.deviceInstance.deviceInstanceId)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "deviceWorkloadIdentity (deviceType, deviceInstanceId) must equal deviceInstance's (§35/§2 single-instance binding: the full Device Instance identity, not the instance id alone)",
      path: ["deviceWorkloadIdentity", "deviceInstanceId"],
    });
  }
  // bounded lifetime: an issued session must be well-ordered on the tick axis.
  if (compareVersionTick(s.createdAtVersion, s.expiresAtVersion) > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "createdAtVersion must be <= expiresAtVersion (bounded lifetime ordering)",
      path: ["expiresAtVersion"],
    });
  }
}

export const ManagedAccessSessionSchema = z
  .preprocess(
    defaultEstablishmentToCredentialPair,
    z.discriminatedUnion("establishment", [
      z
        .object({
          contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
          establishment: z.literal("credential-pair"),
          accountToken: AccountTokenRefSchema,
          deviceWorkloadIdentity: DeviceWorkloadIdentityRefSchema,
          ...managedAccessSessionCommonFields,
        })
        .strict(),
      z
        .object({
          contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
          establishment: z.literal("device-authenticated"),
          accountToken: z.never().optional(),
          deviceWorkloadIdentity: z.never().optional(),
          ...managedAccessSessionCommonFields,
        })
        .strict(),
    ]),
  )
  .superRefine(managedAccessSessionInvariants);
export type ManagedAccessSession = z.infer<typeof ManagedAccessSessionSchema>;

/* ================================================================== *
 * #59 PART 2 — SLICE B (authorization policy & decision model):
 * Execution Authorization Modes (§8), Authentication Requirement (§9),
 * Checkpoint Groups (§2/§7.1), Policy Bindings (§7.1), and the resolved
 * authorization that feeds the decision + audit snapshot (§7.1).
 *
 * Append-only alongside part 1 and slice A above; same strict, closed v1
 * surface and the same `CHECKPOINT_CONTRACT_VERSION`. It reuses slice A's
 * `AccountRefSchema` / `DeviceInstanceRefSchema` / `OpaqueIdSchema` /
 * `RevisionSchema` / `RevisionClassSchema` / `LogicalServiceIdSchema` and part 1's
 * `CheckpointVersionIdSchema` / `ResourceReferenceSchema` /
 * `ResourceSelectorSchema`, and does not modify any of them. The Participant
 * policy subject uses a NEW invocation-relative `ParticipantRefSchema` (§3), NOT
 * slice A's fixed-type `PrincipalRefSchema` (which stays audit/approval-only).
 *
 * Scope discipline (what this slice deliberately does NOT freeze):
 *   - The **combination algebra** over authorization modes (§8 "the Platform
 *     combines them conjunctively") is NOT encoded here. §8 states the modes
 *     are not a total order, so a naive numeric rank would be wrong; combining
 *     policies to the strictest effective constraint is a Platform decision,
 *     deferred.
 *   - `ControlRequirements` stays minimal: rate/routing/risk/audit control
 *     sub-structures are NOT frozen here. Lower layers may only narrow (§7);
 *     the fuller control surface is a later slice.
 *   - Target Admission (§7.2) and Data-flow Authorization (§7.2) objects are
 *     NOT modeled here.
 *   - The §10 durable objects — Authentication Challenge, Approval, and
 *     Authorization Grant lifecycles — are slice C, not here. `Authentication`
 *     in this slice is the *policy requirement* + *evidence* (§9), not the
 *     Challenge object.
 * ================================================================== */

/**
 * Upper bound for the wall-clock second counts on this slice's wire records
 * (`maxAgeSeconds`, `authenticationAtUnixSeconds`). These are carried as JSON
 * numbers, so they are pinned to `Number.MAX_SAFE_INTEGER`: above `2^53` a JSON
 * `number` loses integer precision and two distinct second counts could round to
 * the same double. (Unbounded monotonic counters use the decimal-string
 * {@link RevisionSchema} / {@link VersionTickSchema} instead; a freshness window
 * and a Unix time never need that range.)
 */
const SAFE_INT_MAX = Number.MAX_SAFE_INTEGER;

/* ------------------------------------------------------------------ *
 * B1. Execution authorization mode (arch/16 §8)
 * ------------------------------------------------------------------ */

/**
 * The five execution authorization modes (arch/16 §8). These are **constraints,
 * NOT a total order**: `AUTO` is the least restrictive and `DENY` is absolute,
 * but `TIME_BOUND` and `SESSION_BOUND` are **incomparable by name alone** (one
 * bounds an absolute time window, the other binds session identity and also has
 * a TTL). When multiple policies apply the Platform combines them **conjunctively**
 * to the strictest effective constraint; `DENY` **cannot be overridden** by a
 * successful approval or authentication (emergency access uses a separate
 * break-glass process).
 *
 * There is deliberately **no numeric rank and no combination algebra** in this
 * contract: §8 says the modes are not totally ordered, so a naive ordinal would
 * be wrong, and the conjunctive combination is a Platform decision that is
 * intentionally deferred. Only the boolean {@link isReusableGrantMode} predicate
 * is provided.
 */
export const ExecutionAuthorizationMode = ["AUTO", "TIME_BOUND", "SESSION_BOUND", "SINGLE_USE", "DENY"] as const;
export const ExecutionAuthorizationModeSchema = z.enum(ExecutionAuthorizationMode);
export type ExecutionAuthorizationMode = (typeof ExecutionAuthorizationMode)[number];

/**
 * True IFF `m` is a **reusable-grant** mode — i.e. one approval creates a grant
 * that may be used more than once: `TIME_BOUND` (reusable until an absolute
 * deadline / use-count limit) or `SESSION_BOUND` (reusable within the current
 * Managed Access Session). `AUTO` needs no grant, `SINGLE_USE` is consumed per
 * invocation, and `DENY` forbids execution — none of those is a reusable grant.
 * Fails closed: the input is `.parse()`d, so an illegal mode throws rather than
 * defaulting to `false`.
 */
export function isReusableGrantMode(m: ExecutionAuthorizationMode): boolean {
  const v = ExecutionAuthorizationModeSchema.parse(m);
  return v === "TIME_BOUND" || v === "SESSION_BOUND";
}

/* ------------------------------------------------------------------ *
 * B2. Authentication requirement (arch/16 §9)
 * ------------------------------------------------------------------ */

/**
 * Baseline authentication requirement (arch/16 §9). Unlike the execution modes,
 * this axis **IS a frozen total order** `NONE < REAUTH < MFA`: §9 states "the
 * effective requirement is the strongest required level", so the array order is
 * the comparison order — compare via {@link authenticationRequirementRank}.
 *
 * Future editions may add **stronger** levels (e.g. phishing-resistant
 * authentication) without changing the meaning of the shared levels; adding one
 * to this strict enum is not wire-additive on a v1 consumer and would require a
 * version bump / capability negotiation.
 */
export const AuthenticationRequirement = ["NONE", "REAUTH", "MFA"] as const;
export const AuthenticationRequirementSchema = z.enum(AuthenticationRequirement);
export type AuthenticationRequirement = (typeof AuthenticationRequirement)[number];
/** Ordinal in the frozen total order (NONE=0 < REAUTH=1 < MFA=2). Fails closed on an illegal value. */
export function authenticationRequirementRank(r: AuthenticationRequirement): number {
  return AuthenticationRequirement.indexOf(AuthenticationRequirementSchema.parse(r));
}

/**
 * A single authentication requirement together with an optional **freshness
 * window** (arch/16 §9). `maxAgeSeconds` is a **REAL wall-clock freshness window
 * in seconds** — the maximum age of the authentication evidence — NOT a logical
 * version tick like slice A's `VersionTickSchema`. It is therefore a plain
 * non-negative integer count of seconds, and the §9 example (`maxAgeSeconds:
 * 300`) is five real minutes. Omission means the policy imposes no freshness
 * bound of its own (the effective window is the shortest of all applicable
 * windows — a Platform combination, not encoded here). `maxAgeSeconds` is bounded
 * to {@link SAFE_INT_MAX} (`Number.MAX_SAFE_INTEGER`) so it never crosses the
 * `2^53` JSON-number precision boundary where distinct second counts could round
 * to the same double.
 */
export const AuthenticationRequirementSpecSchema = z
  .object({
    requirement: AuthenticationRequirementSchema,
    /**
     * REAL freshness window in seconds (a wall-clock max age), NOT a logical
     * version tick. Bounded to `Number.MAX_SAFE_INTEGER` so it stays
     * JSON-number-safe (never >2^53 precision loss).
     */
    maxAgeSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX).optional(),
  })
  .strict()
  // NONE demands no authentication, so there is no evidence whose age a
  // freshness window could bound — `NONE + maxAgeSeconds` would be a window
  // over nothing, silently unverifiable (review 2503 High: closed by
  // forbidding the combination rather than inventing evidence for NONE).
  .refine((s) => !(s.requirement === "NONE" && s.maxAgeSeconds !== undefined), {
    message: "a NONE requirement cannot carry maxAgeSeconds (§9: NONE demands no evidence, so a freshness window has nothing to bound)",
    path: ["maxAgeSeconds"],
  });
export type AuthenticationRequirementSpec = z.infer<typeof AuthenticationRequirementSpecSchema>;

/**
 * Authentication policy (arch/16 §9): a policy may **independently** specify a
 * requester and an approver requirement. `requester` is required; `approver` is
 * optional (a policy with no separate approver step omits it). The effective
 * requirement is the strongest required level and the effective freshness window
 * is the shortest applicable window — that combination is a Platform decision and
 * is deliberately not encoded here.
 */
export const AuthenticationPolicySchema = z
  .object({
    requester: AuthenticationRequirementSpecSchema,
    approver: AuthenticationRequirementSpecSchema.optional(),
  })
  .strict();
export type AuthenticationPolicy = z.infer<typeof AuthenticationPolicySchema>;

/**
 * The **session or challenge identity** an authentication evidence record was
 * produced under (arch/16 §9). Modeled as a CLOSED discriminated union on `kind`
 * so the two namespaces **must not collide**: a session id and a challenge id
 * live in separate id spaces, and a single `OpaqueIdSchema` field could not tell
 * which one a value belongs to (a challenge id accidentally reused as a session
 * id would silently pass). Exactly one branch, never both:
 *
 *   - `{ kind: "session", sessionId }`     — a Managed Access Session identity;
 *   - `{ kind: "challenge", challengeId }` — an authentication-challenge identity.
 */
export const SessionOrChallengeRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session"), sessionId: OpaqueIdSchema }).strict(),
  z.object({ kind: z.literal("challenge"), challengeId: OpaqueIdSchema }).strict(),
]);
export type SessionOrChallengeRef = z.infer<typeof SessionOrChallengeRefSchema>;

/**
 * Authentication evidence (arch/16 §9): the record that a required identity
 * confirmation was completed. §9 requires "level, method class, authentication
 * time, session or challenge identity, and the Device through which it was
 * completed":
 *
 *   - `level` — the authoritative axis, a frozen {@link AuthenticationRequirement}.
 *   - `methodClass` — a **descriptive, non-authoritative** label for the method
 *     (e.g. `totp`, `webauthn-platform`). It is a bounded free string
 *     (`NfcString`), **NOT an enum**, so a future method class is not rejected;
 *     authorization compares `level`, never this string.
 *   - `authenticationAtUnixSeconds` — **real wall-clock time** the authentication
 *     completed, in Unix seconds (§9 "authentication time"); NOT a version tick.
 *     Bounded to `Number.MAX_SAFE_INTEGER` ({@link SAFE_INT_MAX}) so it stays
 *     JSON-number-safe (never >2^53 precision loss).
 *   - `sessionOrChallenge` — the session-or-challenge identity that produced this
 *     evidence, a closed {@link SessionOrChallengeRefSchema} union (the two
 *     namespaces must not collide).
 *   - `deviceInstance` — the Device Instance through which it was completed
 *     (reuses slice A's {@link DeviceInstanceRefSchema}).
 *
 * As a top-level, independently-exported wire document it carries
 * `contractVersion` (the literal `CHECKPOINT_CONTRACT_VERSION`) as its first field,
 * mirroring part 1's `CheckpointDefinition`; its sub-refs do not.
 *
 * §9's anti-impersonation rule — an unattended AI must not satisfy a human
 * `REAUTH`/`MFA` requirement with a stored human second factor — is a
 * **Platform-enforced policy**; it is referenced here, not encoded in this wire
 * record.
 */
export const AuthenticationEvidenceSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    level: AuthenticationRequirementSchema,
    /** descriptive, non-authoritative method label; a bounded free string, NOT an enum. */
    methodClass: NfcString,
    /**
     * real wall-clock completion time in Unix seconds (§9), NOT a logical version
     * tick. Bounded to `Number.MAX_SAFE_INTEGER` so it stays JSON-number-safe.
     */
    authenticationAtUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    sessionOrChallenge: SessionOrChallengeRefSchema,
    deviceInstance: DeviceInstanceRefSchema,
  })
  .strict();
export type AuthenticationEvidence = z.infer<typeof AuthenticationEvidenceSchema>;

/* ------------------------------------------------------------------ *
 * B3. Checkpoint Group (arch/16 §2 / §7.1)
 * ------------------------------------------------------------------ */

/**
 * Shared refinement for a non-empty **set of exact Checkpoint versions** carried
 * on the wire (a Checkpoint Group's `members`, a `checkpoints` binding target):
 * the array MUST be in STRICT ASCENDING order by the canonical
 * {@link checkpointVersionKey}. A single canonical order both collapses two
 * spellings that differ only in order (which would fork any identity keyed on the
 * wire bytes) and subsumes the duplicate fail-safe (an equal adjacent pair is not
 * strictly increasing). A non-canonical array is **REJECTED, not silently
 * sorted** (mirroring `ServiceSelection` / the NfcString reject-not-transform
 * discipline); producers canonicalize first via {@link canonicalizeCheckpointMembers}.
 * Fails closed: `checkpointVersionKey` re-parses each member, so a forged id throws.
 */
function refineAscendingCheckpointSet(
  members: CheckpointVersionId[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  const keys = members.map(checkpointVersionKey);
  for (let i = 0; i + 1 < keys.length; i++) {
    if ((keys[i] as string) >= (keys[i + 1] as string)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "checkpoint set must be in strict ascending order by canonical checkpointVersionKey (canonical wire order; also rejects duplicates) — canonicalize the producer's set first",
        path: [...path, i + 1],
      });
      return;
    }
  }
}

/**
 * Output validator for {@link canonicalizeCheckpointMembers}: a non-empty set of
 * exact Checkpoint versions in the canonical strict-ascending order. Used to
 * fail closed on the helper's OWN output (like {@link canonicalizeServiceSelection}).
 */
const CanonicalCheckpointSetSchema = z
  .array(CheckpointVersionIdSchema)
  .min(1)
  .superRefine((m, ctx) => refineAscendingCheckpointSet(m, ctx, []));

/**
 * Producer helper that returns a set of exact Checkpoint versions in canonical
 * wire order: sorted STRICT ASCENDING by {@link checkpointVersionKey} and
 * de-duplicated, so the result satisfies the canonical-order invariant enforced
 * on `CheckpointGroup.members` and the `checkpoints` binding target. Fails closed
 * at BOTH ends: the input is validated (each member is a real
 * {@link CheckpointVersionIdSchema}; the array is non-empty) and the OUTPUT is
 * re-validated against {@link CanonicalCheckpointSetSchema} before returning, so
 * a caster cannot slip a malformed value through and the ordering is guaranteed.
 */
export function canonicalizeCheckpointMembers(members: CheckpointVersionId[]): CheckpointVersionId[] {
  const parsed = z.array(CheckpointVersionIdSchema).min(1).parse(members);
  // dedup by canonical key (keep one member per key), then sort by that key.
  const byKey = new Map<string, CheckpointVersionId>();
  for (const m of parsed) byKey.set(checkpointVersionKey(m), m);
  const canonical = [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, m]) => m);
  return CanonicalCheckpointSetSchema.parse(canonical) as CheckpointVersionId[];
}

/**
 * A **Checkpoint Group** (arch/16 §2, §7.1): a Platform-managed administrative
 * grouping of **Checkpoints** (never principals) that simplifies policy
 * assignment. It is an **administrative convenience only — NOT a runtime
 * authority token**. Before discovery or execution the Platform MUST resolve a
 * group to exact Checkpoint versions (§7.1); a group "must not hide the exact
 * operation being authorized". `members` is a non-empty set of exact
 * {@link CheckpointVersionIdSchema}s in **canonical wire order — STRICT
 * ASCENDING by {@link checkpointVersionKey}** (which also rejects duplicates, so
 * membership is one unambiguous spelling; a non-canonical array is REJECTED, not
 * silently sorted — canonicalize with {@link canonicalizeCheckpointMembers}).
 * `groupRevision` is a bounded monotonic revision counter (a JSON-number-safe decimal string via RevisionSchema; an ordinary
 * group-membership edit is a new revision, §7.1), NOT a logical version tick.
 *
 * As a top-level wire document it carries `contractVersion` first (mirroring
 * part 1's `CheckpointDefinition`); its member sub-refs do not.
 */
export const CheckpointGroupSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    groupId: OpaqueIdSchema,
    members: z.array(CheckpointVersionIdSchema).min(1),
    groupRevision: RevisionSchema,
  })
  .strict()
  .superRefine((g, ctx) => {
    // A group is a canonically-ordered SET of exact Checkpoints; strict ascending
    // by canonical key both fixes one wire spelling and rejects duplicates.
    refineAscendingCheckpointSet(g.members, ctx, ["members"]);
  });
export type CheckpointGroup = z.infer<typeof CheckpointGroupSchema>;

/**
 * Canonical, collision-free key for a Checkpoint Group revision, e.g.
 * `group<US>my-group<US>7`. Validates + fails closed (mirrors slice A's
 * {@link workloadKey}): the input is re-parsed, and the U+001F separator cannot
 * appear inside an {@link OpaqueIdSchema} groupId or a non-negative integer, so
 * distinct groups/revisions never share a key.
 */
export function checkpointGroupKey(group: CheckpointGroup): string {
  const g = CheckpointGroupSchema.parse(group);
  return `group${WORKLOAD_KEY_SEP}${g.groupId}${WORKLOAD_KEY_SEP}${g.groupRevision}`;
}

/* ------------------------------------------------------------------ *
 * B4. Policy Binding (arch/16 §7.1) — the core of slice B
 * ------------------------------------------------------------------ */

/**
 * Reference to a **Participant** as a policy subject (arch/16 §3). §3 is explicit
 * that "the Participant registry records identities and stable attributes, but
 * authorization roles are resolved for each invocation … Fixed type labels must
 * not replace the invocation-relative path model." A Participant is therefore a
 * MINIMAL identity ref with **NO fixed `USER`/`AGENT`/`SYSTEM` label**: the same
 * Participant may be an Originator in one invocation and a tool used by another
 * Originator in the next, so pinning an actor-type onto the subject would encode
 * a role that only the per-invocation path model may resolve. Distinct from
 * {@link PrincipalRefSchema}, which is the fixed-type actor identity used for
 * the audit/approval trail (§2), not for invocation-relative policy binding.
 */
export const ParticipantRefSchema = z
  .object({
    participantId: OpaqueIdSchema,
  })
  .strict();
export type ParticipantRef = z.infer<typeof ParticipantRefSchema>;

/**
 * The **subject** a Policy Binding is assigned to (arch/16 §7.1: "an Account,
 * Participant, organization, Device policy, Resource selector, or other policy
 * subject"). Modeled as a CLOSED discriminated union on `subjectKind` so the
 * subject is exactly one of the frozen kinds; an unknown kind is rejected:
 *
 *   - `account`          -> slice A's {@link AccountRefSchema};
 *   - `participant`      -> {@link ParticipantRefSchema} (§3 invocation-relative,
 *     NO fixed USER/AGENT/SYSTEM label — NOT {@link PrincipalRefSchema});
 *   - `organization`     -> an opaque `organizationId`;
 *   - `deviceInstance`   -> slice A's {@link DeviceInstanceRefSchema} (the Device
 *     policy subject);
 *   - `resourceSelector` -> part 1's {@link ResourceSelectorSchema}.
 */
export const PolicySubjectSchema = z.discriminatedUnion("subjectKind", [
  z.object({ subjectKind: z.literal("account"), account: AccountRefSchema }).strict(),
  z.object({ subjectKind: z.literal("participant"), participant: ParticipantRefSchema }).strict(),
  z.object({ subjectKind: z.literal("organization"), organizationId: OpaqueIdSchema }).strict(),
  z.object({ subjectKind: z.literal("deviceInstance"), deviceInstance: DeviceInstanceRefSchema }).strict(),
  z.object({ subjectKind: z.literal("resourceSelector"), resourceSelector: ResourceSelectorSchema }).strict(),
]);
export type PolicySubject = z.infer<typeof PolicySubjectSchema>;

/**
 * The **target** of a Policy Binding (arch/16 §7.1: "bind a group or exact
 * Checkpoints"). CLOSED discriminated union on `targetKind`:
 *
 *   - `group`       -> a `groupRef` (opaque id) referencing a
 *     {@link CheckpointGroupSchema} **plus the exact `groupRevision`** the binding
 *     was resolved against. §7.1 requires the exact group revision (an ordinary
 *     membership edit is a new revision) to be frozen into the decision + audit
 *     snapshot, so the ref alone — which could drift — is not enough; both
 *     identify one immutable member set. §7.1: the group must still resolve to
 *     exact Checkpoint versions before discovery/execution — the ref is not
 *     itself runtime authority.
 *   - `checkpoints` -> a non-empty set of exact {@link CheckpointVersionIdSchema}s
 *     in canonical wire order (STRICT ASCENDING by {@link checkpointVersionKey},
 *     which also rejects duplicates).
 */
export const BindingTargetSchema = z
  .discriminatedUnion("targetKind", [
    z.object({ targetKind: z.literal("group"), groupRef: OpaqueIdSchema, groupRevision: RevisionSchema }).strict(),
    z
      .object({
        targetKind: z.literal("checkpoints"),
        checkpoints: z.array(CheckpointVersionIdSchema).min(1),
      })
      .strict(),
  ])
  // Ordering/dedup lives on the union (a discriminatedUnion arm must be a bare
  // ZodObject). The checkpoints set is canonical STRICT ASCENDING by key, which
  // also rejects duplicates.
  .superRefine((t, ctx) => {
    if (t.targetKind === "checkpoints") {
      refineAscendingCheckpointSet(t.checkpoints, ctx, ["checkpoints"]);
    }
  });
export type BindingTarget = z.infer<typeof BindingTargetSchema>;

/**
 * How a resolved revision behaves under change (arch/16 §7.1). Implementations
 * **MUST record** which class applies and **must not infer** the opposite from
 * group membership alone:
 *
 *   - `SNAPSHOT_STABLE`      — an ordinary administrative edit does not silently
 *     substitute a different scope for an in-flight Approval / active Grant; the
 *     resolved snapshot remains its scope.
 *   - `REVOCATION_SENSITIVE` — a revision class that **takes precedence over
 *     snapshot stability and fails closed** (baseline removal, checkpoint
 *     withdrawal, target-admission revocation, data-classification escalation,
 *     token tightening, or a binding marked `invalidateDerivedAuthority`).
 */
export const RevisionClass = ["SNAPSHOT_STABLE", "REVOCATION_SENSITIVE"] as const;
export const RevisionClassSchema = z.enum(RevisionClass);
export type RevisionClass = (typeof RevisionClass)[number];

/**
 * The **control requirements** a binding imposes (arch/16 §7). Minimal by
 * design: the execution authorization `mode` (§8) plus the `authentication`
 * policy (§9). Rate, routing, risk-ceiling, and audit control sub-structures are
 * **deliberately NOT frozen here** — §7 says a lower layer may only *narrow*
 * Services/Resources/lifetime/rate and *strengthen* mode/authentication/routing/
 * audit, never reverse them; the fuller control surface is a later slice, and
 * this object is extensible then without redefining the two fields fixed now.
 */
export const ControlRequirementsSchema = z
  .object({
    mode: ExecutionAuthorizationModeSchema,
    authentication: AuthenticationPolicySchema,
    /**
     * §8.1 confirmation axis as a binding-imposed control. OPTIONAL, and
     * absence means the binding imposes no confirmation of its own — the same
     * pre-axis-compatible reading as the Checkpoint definition's
     * `confirmation`. The effective requirement is the STRICTER of the
     * definition's declaration and this flag (a binding can require
     * confirmation a definition did not declare, never waive one it did).
     */
    requireConfirmation: z.boolean().optional(),
    /**
     * Grant-lifetime constraint as a RELATIVE TTL in real seconds (slice B2;
     * §5 "maximum token lifetime", §8). Relative on purpose: a policy is
     * written before any invocation exists, so all it can say is "how long
     * from grant"; the absolute `expiresAtUnixSeconds` materializes exactly
     * once, at Grant issuance (`issuedAt + effective TTL`) — no other layer
     * re-interprets this number. Presence follows the mode (fail-closed
     * refinement below): REQUIRED for `TIME_BOUND` (a time-bound grant
     * without a time bound is a contradiction) and `SESSION_BOUND` (§8: it
     * "also has a TTL" beside the session's own end), OPTIONAL for
     * `SINGLE_USE` (bounds how long the one execution may be awaited; when
     * absent the evaluator freezes the versioned Platform lifetime profile's
     * value into the resolved result — never a deploy-time default read at
     * issuance), FORBIDDEN for `AUTO`/`DENY` (no grant is minted, so a
     * lifetime has nothing to bound — same argument as NONE+maxAgeSeconds).
     */
    maxTtlSeconds: z.number().int().positive().lte(SAFE_INT_MAX).optional(),
    /**
     * Use-count constraint (§8 `TIME_BOUND` "deadline or use limit"; the C2
     * Grant already freezes `maxUses`, this is its policy carrier). OPTIONAL
     * for the reusable modes (absent = no use limit; time/session bounds
     * still apply), MUST be exactly 1 when present on `SINGLE_USE` (same
     * invariant as the C2 Grant), FORBIDDEN for `AUTO`/`DENY`.
     */
    maxUses: z.number().int().positive().lte(SAFE_INT_MAX).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if ((c.mode === "TIME_BOUND" || c.mode === "SESSION_BOUND") && c.maxTtlSeconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${c.mode} control requires maxTtlSeconds (§8: TIME_BOUND is defined by its time bound, and SESSION_BOUND also carries a TTL beside the session's own end)`,
        path: ["maxTtlSeconds"],
      });
    }
    if ((c.mode === "AUTO" || c.mode === "DENY") && (c.maxTtlSeconds !== undefined || c.maxUses !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `an ${c.mode} control cannot carry maxTtlSeconds or maxUses (no grant is minted — a lifetime or use limit has nothing to bound)`,
        path: [c.maxTtlSeconds !== undefined ? "maxTtlSeconds" : "maxUses"],
      });
    }
    if (c.mode === "SINGLE_USE" && c.maxUses !== undefined && c.maxUses !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a SINGLE_USE control's maxUses, when present, is exactly 1 (the same invariant the C2 Grant freezes)",
        path: ["maxUses"],
      });
    }
  });
export type ControlRequirements = z.infer<typeof ControlRequirementsSchema>;

/**
 * A **Policy Binding** (arch/16 §7.1): the Platform-managed assignment connecting a
 * policy subject, a binding target (a Checkpoint Group or exact Checkpoints), an
 * optional Resource selector, and the control requirements. Runtime decisions
 * resolve it to exact immutable identities (see {@link ResolvedAuthorizationSchema}).
 *
 *   - `subject` / `target` are the closed unions above.
 *   - `resourceSelector` is OPTIONAL: a binding may scope to a Resource selector
 *     (part 1's {@link ResourceSelectorSchema}) in addition to its target; omitted
 *     means the target's own Resource scope applies.
 *   - `revisionClass` records SNAPSHOT_STABLE vs REVOCATION_SENSITIVE (§7.1,
 *     recorded, never inferred).
 *   - `invalidateDerivedAuthority` — when `true`, this binding is itself a
 *     revocation-sensitive trigger that **takes precedence over snapshot
 *     stability and fails closed** for authority derived from it (§7.1).
 *   - `bindingRevision` / `policyRevision` are bounded monotonic revision
 *     counters (NOT version ticks): the binding's own revision and the enclosing
 *     policy revision, both carried into the decision + audit snapshot (§7.1).
 *
 * As a top-level wire document it carries `contractVersion` first; its sub-refs
 * (subject, target, controls, selector) do not.
 */
export const PolicyBindingSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    /** Identity of the policy this binding belongs to (§7 policy layers); opaque, taxonomy not frozen. Pairs with `policyRevision`. */
    policyId: OpaqueIdSchema,
    bindingId: OpaqueIdSchema,
    subject: PolicySubjectSchema,
    target: BindingTargetSchema,
    resourceSelector: ResourceSelectorSchema.optional(),
    controls: ControlRequirementsSchema,
    revisionClass: RevisionClassSchema,
    invalidateDerivedAuthority: z.boolean(),
    bindingRevision: RevisionSchema,
    policyRevision: RevisionSchema,
  })
  .strict();
export type PolicyBinding = z.infer<typeof PolicyBindingSchema>;

/**
 * Canonical, collision-free key for a Policy Binding revision snapshot, e.g.
 * `binding<US>pol-sys<US>b-1<US>4<US>9`. Validates + fails closed (mirrors slice
 * A's {@link workloadKey}). The four trailing fields are `policyId`, `bindingId`,
 * `bindingRevision`, and `policyRevision`; the U+001F separator cannot appear in
 * an {@link OpaqueIdSchema} id or a decimal-string revision, so distinct
 * policies / bindings / revisions never share a key.
 */
export function policyBindingKey(binding: PolicyBinding): string {
  const b = PolicyBindingSchema.parse(binding);
  return `binding${WORKLOAD_KEY_SEP}${b.policyId}${WORKLOAD_KEY_SEP}${b.bindingId}${WORKLOAD_KEY_SEP}${b.bindingRevision}${WORKLOAD_KEY_SEP}${b.policyRevision}`;
}

/* ------------------------------------------------------------------ *
 * B5. Resolved authorization (arch/16 §7.1 resolution output)
 * ------------------------------------------------------------------ */

/**
 * One applicable constraint source's exact identity + revisions as it
 * contributed to a resolution (arch/16 §7 / §7.1). §7 defines the effective
 * permission as the **intersection of all applicable scopes**; the SET of
 * these contributions is that intersection made auditable — it lets an
 * auditor reconstruct exactly WHY a call was allowed or denied. §7.1 requires
 * the exact source identity AND revisions (and, for a group target, the exact
 * group revision) be frozen into the decision + audit snapshot, so every
 * branch of the union below carries:
 *
 *   - its layer's full identity + revision(s) — `policyId`/`bindingId` with
 *     both revisions for a binding, `ruleId`+`ruleRevision` for a System
 *     Exposure rule, `entitlementId`+`entitlementRevision` for an Account
 *     Entitlement;
 *   - `revisionClass` — SNAPSHOT_STABLE vs REVOCATION_SENSITIVE for THIS source;
 *   - `invalidateDerivedAuthority` — whether this source is itself a
 *     revocation-sensitive trigger (§7.1);
 *   - `resolvedThrough` — the REQUIRED closed union naming HOW the source's
 *     target reached this Checkpoint: `{kind:"direct"}` or `{kind:"group",
 *     groupRef, groupRevision}` (the group path cannot drop its exact
 *     revision; review 2520).
 *
 * Not top-level wire documents (sub-records of {@link
 * ResolvedAuthorizationSchema}), so they do NOT carry `contractVersion`.
 */
/**
 * HOW a contribution's source targeted the Checkpoint (review 2520 Medium):
 * a CLOSED union, so "directly" and "through a Checkpoint Group" are the only
 * spellings and the group path CANNOT silently drop its exact revision — the
 * optional-`group` shape it replaces could not verify its own "present IFF
 * the target was a group" claim, leaving the §7.1 group-revision freeze to
 * producer discipline instead of the contract.
 */
export const ContributionResolvedThroughSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct") }).strict(),
  z.object({ kind: z.literal("group"), groupRef: OpaqueIdSchema, groupRevision: RevisionSchema }).strict(),
]);
export type ContributionResolvedThrough = z.infer<typeof ContributionResolvedThroughSchema>;

export const PolicyBindingContributionSchema = z
  .object({
    layer: z.literal("policy-binding"),
    /**
     * Identity of the policy this binding belongs to. An opaque id — the
     * policy taxonomy beyond the three explicit layers below is NOT frozen
     * here. Required so a `policyRevision` names WHICH policy's revision,
     * letting an auditor reconstruct the exact provenance of a decision.
     */
    policyId: OpaqueIdSchema,
    bindingId: OpaqueIdSchema,
    policyRevision: RevisionSchema,
    bindingRevision: RevisionSchema,
    revisionClass: RevisionClassSchema,
    invalidateDerivedAuthority: z.boolean(),
    resolvedThrough: ContributionResolvedThroughSchema,
  })
  .strict();
export type PolicyBindingContribution = z.infer<typeof PolicyBindingContributionSchema>;

/** A System Exposure Rule's exact identity + revision as it contributed (§5/§7.1). */
export const SystemExposureRuleContributionSchema = z
  .object({
    layer: z.literal("system-exposure-rule"),
    ruleId: OpaqueIdSchema,
    ruleRevision: RevisionSchema,
    revisionClass: RevisionClassSchema,
    invalidateDerivedAuthority: z.boolean(),
    resolvedThrough: ContributionResolvedThroughSchema,
  })
  .strict();
export type SystemExposureRuleContribution = z.infer<typeof SystemExposureRuleContributionSchema>;

/** An Account Entitlement's exact identity + revision as it contributed (§7/§7.1). */
export const AccountEntitlementContributionSchema = z
  .object({
    layer: z.literal("account-entitlement"),
    entitlementId: OpaqueIdSchema,
    entitlementRevision: RevisionSchema,
    revisionClass: RevisionClassSchema,
    invalidateDerivedAuthority: z.boolean(),
    resolvedThrough: ContributionResolvedThroughSchema,
  })
  .strict();
export type AccountEntitlementContribution = z.infer<typeof AccountEntitlementContributionSchema>;

/**
 * One applicable constraint source as it contributed to a resolution — a
 * CLOSED union on `layer` (review 2518 High 2): §7's intersection spans the
 * System Exposure Baseline and Account Entitlements, not only Policy
 * Bindings, and each of those layers can move the final mode / authentication
 * / TTL / use limit and carries its OWN revocation sensitivity. A provenance
 * record that could only name bindings would make "why is the final TTL this
 * value" unreconstructable and would drop exposure/entitlement invalidations
 * out of the no-lost-invalidation computation — so every layer keeps its
 * exact identity + revision + `revisionClass` + `invalidateDerivedAuthority`
 * in its own branch. Not a top-level wire document (no `contractVersion`).
 */
export const ResolvedContributionSchema = z.discriminatedUnion("layer", [
  PolicyBindingContributionSchema,
  SystemExposureRuleContributionSchema,
  AccountEntitlementContributionSchema,
]);
export type ResolvedContribution = z.infer<typeof ResolvedContributionSchema>;

/**
 * A machine-readable ABSENCE that blocked a resolution (review 2519 High).
 * B2's deny-by-default axes deny by NOT having rows — no System Exposure
 * rule → not exposed, no Account Entitlement → entitled to nothing — and an
 * honest resolved result must be able to SAY so: with nothing matched there
 * is no real row to cite in `contributions`, and minting a sentinel
 * rule/binding would forge audit provenance. A blocker names the axis whose
 * emptiness denied, so a fresh deployment's DENY is schema-valid and
 * auditable without a single fabricated source. Closed union; absence can
 * only DENY (refined on {@link ResolvedAuthorizationSchema}).
 */
export const ResolutionBlockerSchema = z.discriminatedUnion("axis", [
  z.object({ axis: z.literal("account-entitlement"), reason: z.literal("no-matching-row") }).strict(),
  z.object({ axis: z.literal("system-exposure"), reason: z.literal("no-matching-rule") }).strict(),
]);
export type ResolutionBlocker = z.infer<typeof ResolutionBlockerSchema>;

/**
 * Canonical order key of a contribution: layer, then the branch's full
 * identity, U+001F-joined (no field can contain the separator). One wire
 * spelling of the applicable-constraint set; strict ascending also rejects
 * duplicates.
 */
export function contributionOrderKey(c: ResolvedContribution): string {
  const v = ResolvedContributionSchema.parse(c);
  switch (v.layer) {
    case "policy-binding":
      return `policy-binding${WORKLOAD_KEY_SEP}${v.policyId}${WORKLOAD_KEY_SEP}${v.bindingId}`;
    case "system-exposure-rule":
      return `system-exposure-rule${WORKLOAD_KEY_SEP}${v.ruleId}`;
    case "account-entitlement":
      return `account-entitlement${WORKLOAD_KEY_SEP}${v.entitlementId}`;
  }
}

/**
 * The exact-identity resolution a decision is resolved to **before discovery or
 * execution** (arch/16 §7 / §7.1): "exact Service, exact Checkpoint version,
 * exact Resource selector or normalized Resource, exact control requirements,
 * exact policy and binding revisions." It feeds the authorization decision and
 * the immutable audit snapshot; §7.1: historical decisions are immutable.
 *
 * The Resource half is a CLOSED discriminated union on `resourceBinding.kind`,
 * mirroring §7.1's "Resource selector **or** normalized Resource" — exactly one,
 * never both:
 *
 *   - `{ kind: "exact", resource }`   -> a normalized part 1 {@link ResourceReferenceSchema};
 *   - `{ kind: "selector", selector }` -> a part 1 {@link ResourceSelectorSchema}.
 *
 * `service` reuses slice A's shared logical-Service-id field (rejects `svc_*`).
 *
 * **Full resolution provenance (§7).** `contributions` is the set of every
 * applicable SOURCE's exact identity + revisions ({@link
 * ResolvedContributionSchema} — a closed per-layer union of Policy Binding /
 * System Exposure Rule / Account Entitlement branches) — the §7 "intersection
 * of all applicable scopes" made auditable, in canonical wire order (STRICT
 * ASCENDING by {@link contributionOrderKey}: layer, then identity; also
 * rejects duplicates). It may be EMPTY only when `resolutionBlockers` names
 * the deny-by-default absence that blocked the resolution (review 2519).
 * `effectiveRevisionClass` / `effectiveInvalidateDerivedAuthority` are the
 * COMBINED resolved sensitivity.
 *
 * Three fail-closed cross-field invariants are enforced:
 *   1. **identity consistency (§7.1/§3)** — `checkpoint.serviceId` MUST equal
 *      `service`; the authorization / routing / audit identity must not fork.
 *   2. **canonical provenance** — `contributions` are strict-ascending by
 *      {@link contributionOrderKey} (layer, then the branch's full identity;
 *      rejects non-canonical order and duplicates).
 *   3. **no lost invalidation (§7.1)** — if ANY contribution is
 *      `REVOCATION_SENSITIVE` or sets `invalidateDerivedAuthority`, the effective
 *      class MUST be `REVOCATION_SENSITIVE` and `effectiveInvalidateDerivedAuthority`
 *      MUST be `true`. An explicit invalidation requirement can never be resolved
 *      down to snapshot-stable — §7.1 says it takes precedence over snapshot
 *      stability and fails closed.
 *
 * As a top-level wire document it carries `contractVersion` first; its sub-refs
 * do not.
 */
export const ResolvedAuthorizationSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    service: LogicalServiceIdSchema,
    checkpoint: CheckpointVersionIdSchema,
    resourceBinding: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("exact"), resource: ResourceReferenceSchema }).strict(),
      z.object({ kind: z.literal("selector"), selector: ResourceSelectorSchema }).strict(),
    ]),
    controls: ControlRequirementsSchema,
    /**
     * §7 intersection made auditable — may be EMPTY only when
     * `resolutionBlockers` names the absence that denied (a resolution must
     * name its sources or the absences that blocked it; silence is not
     * expressible).
     */
    contributions: z.array(ResolvedContributionSchema),
    /**
     * The deny-by-absence provenance (review 2519 High): present when a
     * deny-by-default axis matched NOTHING. Canonical ascending by axis, no
     * duplicates; presence forces the effective mode to `DENY` — absence can
     * only deny, never confer.
     */
    resolutionBlockers: z.array(ResolutionBlockerSchema).min(1).optional(),
    /** COMBINED resolved revision class (see the no-lost-invalidation invariant). */
    effectiveRevisionClass: RevisionClassSchema,
    /** COMBINED resolved invalidation flag (see the no-lost-invalidation invariant). */
    effectiveInvalidateDerivedAuthority: z.boolean(),
    /**
     * The EFFECTIVE grant lifetime, RELATIVE seconds (slice B2): min of every
     * applicable `maxTtlSeconds`, or — for `SINGLE_USE` with no policy TTL —
     * the value the evaluator froze from the versioned Platform lifetime
     * profile. REQUIRED for every grant-minting mode (unbounded authority is
     * not expressible — C2 already freezes that every Grant has an expiry),
     * FORBIDDEN for `AUTO`/`DENY`. Issuance does `issuedAt + this`, nothing
     * more: the decision, including the default, is frozen HERE so the same
     * resolved result signs the same expiry on every deployment.
     */
    effectiveMaxTtlSeconds: z.number().int().positive().lte(SAFE_INT_MAX).optional(),
    /**
     * WHERE the effective TTL came from (slice B2; required alongside it):
     * `policy` = the min over the applicable SOURCES — bindings, exposure
     * rules, entitlements — whose identities are already in `contributions`; `lifetime-profile` = the evaluator
     * consumed the versioned, auditable Platform lifetime profile (the
     * SINGLE_USE-default path), and names its exact identity so the decision
     * is reconstructable without reading any deployment config.
     */
    ttlProvenance: z
      .discriminatedUnion("source", [
        z.object({ source: z.literal("policy") }).strict(),
        z
          .object({
            source: z.literal("lifetime-profile"),
            profileId: OpaqueIdSchema,
            profileRevision: RevisionSchema,
          })
          .strict(),
      ])
      .optional(),
    /**
     * The EFFECTIVE use limit (slice B2): min of applicable `maxUses`.
     * `SINGLE_USE` ⇒ REQUIRED and exactly 1 — frozen by the evaluator from
     * the mode invariant even when no policy wrote `maxUses`, so the resolved
     * result and the C2 Grant (`maxUses === 1`) can never disagree. Reusable
     * modes: optional (absent = no use limit). `AUTO`/`DENY`: forbidden.
     */
    effectiveMaxUses: z.number().int().positive().lte(SAFE_INT_MAX).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    // ---- reviews 2519/2520: deny-by-default axes are MANDATORY intersection
    // terms. §7's effective permission intersects System Exposure and Account
    // Entitlement unconditionally, so a resolution must account for each axis
    // EXACTLY ONE way: a real contribution from it, XOR the blocker naming its
    // emptiness. Missing both silently deletes a mandatory term from the
    // intersection (an authority-widening hole); claiming both is the same
    // axis asserting "matched" and "nothing matched" at once.
    const axisPairs: Array<{ axis: "system-exposure" | "account-entitlement"; layer: ResolvedContribution["layer"]; blockerName: string }> = [
      { axis: "system-exposure", layer: "system-exposure-rule", blockerName: "system-exposure/no-matching-rule" },
      { axis: "account-entitlement", layer: "account-entitlement", blockerName: "account-entitlement/no-matching-row" },
    ];
    for (const { axis, layer, blockerName } of axisPairs) {
      const contributed = r.contributions.some((c) => (c as ResolvedContribution).layer === layer);
      const blocked = r.resolutionBlockers?.some((bl) => (bl as ResolutionBlocker).axis === axis) === true;
      if (!contributed && !blocked) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `the mandatory ${axis} axis is unaccounted for: a resolution needs a ${layer} contribution XOR the ${blockerName} blocker (§7: omitting a mandatory intersection term widens authority)`,
          path: ["contributions"],
        });
      }
      if (contributed && blocked) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `the ${axis} axis claims both "matched" (a ${layer} contribution) and "nothing matched" (${blockerName}) — one axis, one truth`,
          path: ["resolutionBlockers"],
        });
      }
    }
    if (r.resolutionBlockers !== undefined) {
      if (r.controls.mode !== "DENY") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "resolutionBlockers force an effective DENY (absence can only deny, never confer)",
          path: ["controls", "mode"],
        });
      }
      for (let i = 0; i + 1 < r.resolutionBlockers.length; i++) {
        const a = r.resolutionBlockers[i] as ResolutionBlocker;
        const b = r.resolutionBlockers[i + 1] as ResolutionBlocker;
        if (a.axis >= b.axis) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "resolutionBlockers must be in strict ascending order by axis (canonical wire order; also rejects duplicates)",
            path: ["resolutionBlockers", i + 1],
          });
          break;
        }
      }
    }

    // ---- slice B2: lifetime / use-count effectives follow the mode ----
    const mode = r.controls.mode;
    const grantMinting = mode === "TIME_BOUND" || mode === "SESSION_BOUND" || mode === "SINGLE_USE";
    if (grantMinting && r.effectiveMaxTtlSeconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a resolved ${mode} authorization requires effectiveMaxTtlSeconds (unbounded grant authority is not expressible; the SINGLE_USE default comes from the lifetime profile, frozen at resolution)`,
        path: ["effectiveMaxTtlSeconds"],
      });
    }
    if (!grantMinting && (r.effectiveMaxTtlSeconds !== undefined || r.ttlProvenance !== undefined || r.effectiveMaxUses !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a resolved ${mode} authorization cannot carry effective lifetime/use fields (no grant is minted)`,
        path: [
          r.effectiveMaxTtlSeconds !== undefined
            ? "effectiveMaxTtlSeconds"
            : r.ttlProvenance !== undefined
              ? "ttlProvenance"
              : "effectiveMaxUses",
        ],
      });
    }
    if ((r.effectiveMaxTtlSeconds === undefined) !== (r.ttlProvenance === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "effectiveMaxTtlSeconds and ttlProvenance travel together (a TTL without provenance is not reconstructable; provenance without a TTL describes nothing)",
        path: [r.ttlProvenance === undefined ? "ttlProvenance" : "effectiveMaxTtlSeconds"],
      });
    }
    // Coherence with the effective controls this same object carries: when the
    // resolved controls state a TTL, the effective TTL IS it and its source is
    // policy; only the no-policy-TTL SINGLE_USE path may cite the profile.
    if (r.controls.maxTtlSeconds !== undefined && r.effectiveMaxTtlSeconds !== undefined) {
      if (r.effectiveMaxTtlSeconds !== r.controls.maxTtlSeconds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "effectiveMaxTtlSeconds must equal controls.maxTtlSeconds (controls already IS the effective intersection; a divergence forks the decision)",
          path: ["effectiveMaxTtlSeconds"],
        });
      }
      if (r.ttlProvenance !== undefined && r.ttlProvenance.source !== "policy") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "a TTL stated by the resolved controls has provenance `policy`, not `lifetime-profile`",
          path: ["ttlProvenance", "source"],
        });
      }
    }
    if (r.controls.maxTtlSeconds === undefined && r.ttlProvenance !== undefined && r.ttlProvenance.source !== "lifetime-profile") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a TTL the resolved controls do not state can only come from the lifetime profile (the SINGLE_USE default path)",
        path: ["ttlProvenance", "source"],
      });
    }
    if (mode === "SINGLE_USE" && r.effectiveMaxUses !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a resolved SINGLE_USE authorization has effectiveMaxUses exactly 1 (frozen from the mode invariant even when no policy wrote maxUses — the C2 Grant's maxUses === 1 must never disagree with the resolved result)",
        path: ["effectiveMaxUses"],
      });
    }
    if (r.controls.maxUses !== undefined && r.effectiveMaxUses !== r.controls.maxUses) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "effectiveMaxUses must equal controls.maxUses when the resolved controls state one (controls already IS the effective intersection)",
        path: ["effectiveMaxUses"],
      });
    }
    // Review 2518 Medium: a reusable-mode use limit needs a POLICY source —
    // effective = min over applicable maxUses, so with none applicable there
    // is nothing to take the min of. SINGLE_USE is the one exception (the
    // mode invariant itself is the source, frozen to 1 above).
    if (
      (mode === "TIME_BOUND" || mode === "SESSION_BOUND") &&
      r.controls.maxUses === undefined &&
      r.effectiveMaxUses !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a reusable-mode effectiveMaxUses without controls.maxUses has no source (min over nothing; only SINGLE_USE derives a use limit from the mode invariant)",
        path: ["effectiveMaxUses"],
      });
    }

    // (1) identity consistency (§7.1/§3): the resolved checkpoint's serviceId must
    // not disagree with the resolved service, or one decision names two services.
    if (r.checkpoint.serviceId !== r.service) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checkpoint.serviceId must equal service — authorization/routing/audit identity must not fork",
        path: ["checkpoint", "serviceId"],
      });
    }
    // (2) canonical provenance: contributions are STRICT ASCENDING by
    // contributionOrderKey — layer, then the branch's full identity (one wire
    // spelling of the applicable-source set; also rejects duplicates). The
    // composite key matters: the same bindingId under two different policies,
    // or the same opaque id under two different layers, is distinct.
    for (let i = 0; i + 1 < r.contributions.length; i++) {
      const ka = contributionOrderKey(r.contributions[i] as ResolvedContribution);
      const kb = contributionOrderKey(r.contributions[i + 1] as ResolvedContribution);
      if (ka >= kb) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "contributions must be in strict ascending order by (layer, identity) — see contributionOrderKey (canonical wire order; also rejects duplicates)",
          path: ["contributions", i + 1],
        });
        break;
      }
    }
    // (3) no lost invalidation (§7.1): an explicit invalidation / revocation-
    // sensitive class can never resolve down to snapshot-stable — it takes
    // precedence over snapshot stability and fails closed.
    const anySensitive = r.contributions.some(
      (c) => c.revisionClass === "REVOCATION_SENSITIVE" || c.invalidateDerivedAuthority === true,
    );
    if (anySensitive) {
      if (r.effectiveRevisionClass !== "REVOCATION_SENSITIVE") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "effectiveRevisionClass must be REVOCATION_SENSITIVE when any contribution is revocation-sensitive or sets invalidateDerivedAuthority (§7.1 fail-closed)",
          path: ["effectiveRevisionClass"],
        });
      }
      if (r.effectiveInvalidateDerivedAuthority !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "effectiveInvalidateDerivedAuthority must be true when any contribution is revocation-sensitive or sets invalidateDerivedAuthority (§7.1 fail-closed)",
          path: ["effectiveInvalidateDerivedAuthority"],
        });
      }
    }
  });
export type ResolvedAuthorization = z.infer<typeof ResolvedAuthorizationSchema>;

/* ------------------------------------------------------------------ *
 * B6. System Exposure Rule & Account Entitlement — minimal baseline forms
 * (slice B2; arch/16 §5, §7; the §17.2 landing items that had not landed)
 * ------------------------------------------------------------------ */

/**
 * A **System Exposure Rule**, minimal baseline form (arch/16 §5). The
 * Platform owns all exposure decisions, and the default is DENY: **no
 * explicit rule → not exposed** — an empty rule set exposing nothing is
 * correct behavior on a fresh deployment (§17.4.4), and a Service can never
 * broaden what these rules expose, while Account and token policy can never
 * weaken it.
 *
 *   - `target` — WHICH published Checkpoints the rule exposes: the same
 *     closed {@link BindingTargetSchema} a Policy Binding uses (a Checkpoint
 *     Group reference or an exact ascending Checkpoint-version set).
 *   - `deviceTypes` — the Device types the exposure is limited to; ABSENT
 *     means any device type (the §5 per-Device-Instance narrowing is a later
 *     form). Canonical: strict ascending, no duplicates.
 *   - `accounts` — the Accounts the exposure is limited to; ABSENT means any
 *     Account — exposure decides EXPOSABILITY, and per-Account authority is
 *     still gated by the Account's own Entitlement in the §7 intersection.
 *     Canonical: strict ascending by accountId, no duplicates.
 *   - `resourceSelector` — optional Resource bound on the exposure.
 *   - `controls` — the MINIMUM controls this exposure imposes (§5 "minimum
 *     authorization mode / minimum authentication requirement / maximum
 *     token lifetime"): a lower layer may only strengthen them.
 *   - `riskCeiling` — §5 "maximum risk level": a Checkpoint whose declared
 *     risk exceeds it is not exposed by this rule.
 *   - `ruleRevision` / `revisionClass` / `invalidateDerivedAuthority` — the
 *     same §7.1 revision discipline as a Policy Binding.
 *
 * Deliberately NOT in the minimal form (deferred, fail-closed where
 * reachable): approval / separation-of-duty requirements, audit level,
 * allowed routing modes, organizational scopes, per-Device-Instance lists.
 */
export const SystemExposureRuleSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    ruleId: OpaqueIdSchema,
    target: BindingTargetSchema,
    deviceTypes: z.array(DeviceTypeSchema).min(1).optional(),
    accounts: z.array(AccountRefSchema).min(1).optional(),
    resourceSelector: ResourceSelectorSchema.optional(),
    controls: ControlRequirementsSchema,
    riskCeiling: RiskLevelSchema.optional(),
    ruleRevision: RevisionSchema,
    revisionClass: RevisionClassSchema,
    invalidateDerivedAuthority: z.boolean(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.deviceTypes !== undefined) {
      for (let i = 0; i + 1 < rule.deviceTypes.length; i++) {
        if ((rule.deviceTypes[i] as string) >= (rule.deviceTypes[i + 1] as string)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "deviceTypes must be in strict ascending order (canonical wire order; also rejects duplicates)",
            path: ["deviceTypes", i + 1],
          });
          break;
        }
      }
    }
    if (rule.accounts !== undefined) {
      for (let i = 0; i + 1 < rule.accounts.length; i++) {
        const a = rule.accounts[i] as AccountRef;
        const b = rule.accounts[i + 1] as AccountRef;
        if (a.accountId >= b.accountId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "accounts must be in strict ascending order by accountId (canonical wire order; also rejects duplicates)",
            path: ["accounts", i + 1],
          });
          break;
        }
      }
    }
  });
export type SystemExposureRule = z.infer<typeof SystemExposureRuleSchema>;

/**
 * Canonical, collision-free key for a System Exposure Rule revision snapshot,
 * e.g. `exposure-rule<US>rule-1<US>3`. Validates + fails closed (mirrors
 * {@link policyBindingKey}).
 */
export function systemExposureRuleKey(rule: SystemExposureRule): string {
  const v = SystemExposureRuleSchema.parse(rule);
  return `exposure-rule${WORKLOAD_KEY_SEP}${v.ruleId}${WORKLOAD_KEY_SEP}${v.ruleRevision}`;
}

/**
 * An **Account Entitlement**, minimal baseline form (arch/16 §2/§7): the
 * Platform-managed MAXIMUM set of Checkpoints and Resources one Account may
 * use. It is one intersect term of §7's effective permission — an Account
 * with NO entitlement rows is entitled to nothing (deny-by-default on this
 * axis too), and nothing an entitlement grants survives the intersection
 * with the System Exposure Baseline above it.
 *
 *   - `account` — the single Account this row entitles (one row, one
 *     Account: entitlement is per-Account state, not a group policy — that
 *     is what Policy Bindings over subjects are for).
 *   - `target` / `resourceSelector` — the entitled Checkpoint set and its
 *     optional Resource bound, same closed shapes as everywhere else.
 *   - `controls` — OPTIONAL extra tightening this entitlement imposes on its
 *     own grants (absent = the entitlement adds scope, not controls; the §7
 *     rule that lower layers only narrow applies unchanged).
 *   - `entitlementRevision` / `revisionClass` / `invalidateDerivedAuthority`
 *     — the same §7.1 revision discipline as a Policy Binding.
 */
export const AccountEntitlementSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    entitlementId: OpaqueIdSchema,
    account: AccountRefSchema,
    target: BindingTargetSchema,
    resourceSelector: ResourceSelectorSchema.optional(),
    controls: ControlRequirementsSchema.optional(),
    entitlementRevision: RevisionSchema,
    revisionClass: RevisionClassSchema,
    invalidateDerivedAuthority: z.boolean(),
  })
  .strict();
export type AccountEntitlement = z.infer<typeof AccountEntitlementSchema>;

/**
 * Canonical, collision-free key for an Account Entitlement revision snapshot,
 * e.g. `entitlement<US>ent-1<US>2`. Validates + fails closed.
 */
export function accountEntitlementKey(e: AccountEntitlement): string {
  const v = AccountEntitlementSchema.parse(e);
  return `entitlement${WORKLOAD_KEY_SEP}${v.entitlementId}${WORKLOAD_KEY_SEP}${v.entitlementRevision}`;
}

/* ================================================================== *
 * #59 PART 2 — SLICE C1 (reviewed-scope & durable decision record):
 * the content-addressed ParameterDigest (§4), the ReviewedScope that
 * snapshots the full §8 SESSION_BOUND binding set + invocation path (§3)
 * + target admission (§7.2) + output-class upper bound (§7.2), the async
 * durable Decision outcome (§10), and the immutable AuditSnapshot the
 * decision is recorded into (§7.1).
 *
 * Append-only alongside part 1 and slices A/B above; same strict, closed v1
 * surface and the same `CHECKPOINT_CONTRACT_VERSION`. It reuses slice A's
 * `OpaqueIdSchema` / `AccountRefSchema` / `AccountTokenRefSchema` /
 * `DeviceInstanceRefSchema` / `DeviceWorkloadIdentityRefSchema` /
 * `ServiceSelectionSchema` / `PrincipalRefSchema` / `RevisionSchema` /
 * `WORKLOAD_KEY_SEP`, slice B's `SAFE_INT_MAX` / `ParticipantRefSchema` /
 * `ResolvedAuthorizationSchema`, and part 1's `LogicalServiceIdSchema` (shared logical
 * Service id) / `DataClassificationSchema` / the `CORE_SEMVER` pattern — none
 * of which this slice modifies.
 *
 * Scope discipline (what this slice deliberately does NOT freeze):
 *   - The Authentication Challenge, Approval, and Authorization Grant lifecycle
 *     OBJECTS of §10 are a later slice. This slice freezes only the reviewed
 *     scope, the async durable Decision outcome, and the immutable audit
 *     record; `challengeRef` / `approvalRef` here are minimal id refs into
 *     those later objects.
 *   - Per-hop credential / data-flow detail and the full §7.2 data-flow admission
 *     model are deferred (#61); this slice freezes the §3 invocation-relative role
 *     + entity-instance identity per hop and the exact §7.2 target-admission
 *     identity (concrete version + artifact digest + instance + admission/runtime
 *     trust revisions).
 *   - The full §8 combination algebra and the §10 challenge/approval issuance
 *     transport are Platform / later-slice concerns, not modeled here.
 * ================================================================== */

/* ------------------------------------------------------------------ *
 * C1.1 Parameter digest (arch/16 §4 parameter digest)
 * ------------------------------------------------------------------ */

/**
 * Lowercase-hex SHA-256 digest (64 hex chars). Shared by the §4 parameter
 * digest and the §7.2 target artifact digest so the two content authorities use
 * one canonical hex spelling and cannot fork on casing/length across languages.
 */
const SHA256_HEX = /^[0-9a-f]{64}$/;
const Sha256HexSchema = z.string().regex(SHA256_HEX, "sha-256 digest is 64 lowercase hex chars");

/**
 * Content-addressed digest of the reviewed invocation parameters (arch/16 §4:
 * the decision and audit snapshot bind a **parameter digest**, never the
 * plaintext). The digest is over a **frozen three-stage canonical preimage**, so
 * every language computes the same bytes:
 *
 *   stage 1 — Checkpoint-parameter normalization under the referenced
 *     **immutable, Platform-registered normalization profile**. The profile is
 *     **content-addressed by `normalizationProfile.profileDigest`** (`sha-256`
 *     lowercase hex) — the content authority of the immutable profile record,
 *     mirroring part 1's `SchemaRef.schemaRecord` digest; `(profileId,
 *     profileRevision)` is the immutable **registry locator**. Because the
 *     normalization rule is bound by an immutable content digest, two
 *     implementations cannot normalize differently — the profile record, not this
 *     wire object, binds the exact normalization rules;
 *   stage 2 — RFC 8785 JSON Canonicalization Scheme (JCS) over the normalized
 *     value;
 *   stage 3 — SHA-256 over the stage-2 bytes.
 *
 * The reviewed parameter plaintext is **never on the wire** — only this digest,
 * so a §10 payload change is detectable (the digest changes) without disclosing
 * the parameters. `algo`/`preimage` are **literals** (not free text): `algo`
 * names the hash and `preimage` describes the ALGORITHM (normalization then JCS),
 * while `normalizationProfile` binds the CONCRETE, immutable normalization rule
 * by content reference — so a future preimage/profile rule is a deliberate bump
 * of this closed surface, never a silent reinterpretation. `byteLength` is the
 * stage-2 preimage byte length, a JSON-number-safe count bounded to
 * `Number.MAX_SAFE_INTEGER` ({@link SAFE_INT_MAX}).
 *
 * Not a top-level wire document (a sub-ref embedded in ReviewedScope), so it
 * carries no `contractVersion`.
 */
export const ParameterDigestSchema = z
  .object({
    algo: z.literal("sha-256"),
    normalizationProfile: z
      .object({
        /** content authority of the immutable profile record (sha-256 lowercase hex). */
        profileDigest: Sha256HexSchema,
        /** immutable registry locator (not the content authority). */
        profileId: OpaqueIdSchema,
        profileRevision: RevisionSchema,
      })
      .strict(),
    preimage: z.literal("checkpoint-semantic-normalization|rfc8785-jcs"),
    digest: Sha256HexSchema,
    byteLength: z.number().int().nonnegative().lte(SAFE_INT_MAX),
  })
  .strict();
export type ParameterDigest = z.infer<typeof ParameterDigestSchema>;

/* ------------------------------------------------------------------ *
 * C1.2 Reviewed scope (arch/16 §7.1 audit snapshot, §7.2, §8, §10)
 * ------------------------------------------------------------------ */

/**
 * The **invocation-relative role** a hop plays on THIS invocation (arch/16 §3).
 * This is a ROLE resolved per invocation ("A Service may be a target in one hop
 * and an intermediary client in the next"), NOT an entity type — the entity type
 * lives on {@link PathHopSchema}'s `hopIdentity`. Three roles frame the §3 path:
 * `originator` (A), `intermediary` (an interior element of B), `target` (C's
 * serving element). Closed enum.
 */
export const PathRole = ["originator", "intermediary", "target"] as const;
export const PathRoleSchema = z.enum(PathRole);
export type PathRole = (typeof PathRole)[number];

/**
 * One hop on the invocation path (arch/16 §3: `B = complete ordered path of
 * devices, adapters, Services, and other intermediaries`). A hop separates the
 * **invocation-relative role** (`pathRole`, §3 — resolved per invocation, not a
 * fixed type label) from the **entity identity** (`hopIdentity`), so switching a
 * concrete Device Instance or Service Instance on a hop changes the path value
 * even when the role is unchanged.
 *
 * `hopIdentity` is a CLOSED discriminated union on `entityKind` that binds enough
 * to detect an instance change:
 *
 *   - `device-instance`  — the FULL {@link DeviceInstanceRefSchema} (deviceType +
 *     instance id);
 *   - `service-instance` — the logical Service id + concrete Service **deployment
 *     version** (an OPAQUE vendor version string, {@link NfcString}; distinct
 *     from the Checkpoint's core-SemVer authorization identity) + the opaque
 *     Service Instance id (so a version or instance switch is visible);
 *   - `participant`          — a bare {@link ParticipantRefSchema} with no running
 *     instance; allowed ONLY for the originator (§3: A may be an Account or an
 *     autonomous AI originator — the arch/16 §3 `agent:` sense, not a Connector);
 *   - `participant-instance` — a Participant plus an opaque running-instance id,
 *     for a runtime relay / adapter intermediary (so an instance switch shows).
 *
 * A sub-ref (no `contractVersion`). The per-hop credential / data-flow / runtime
 * trust detail is deferred (#61); role + entity-instance identity are frozen.
 */
export const PathHopSchema = z
  .object({
    pathRole: PathRoleSchema,
    hopIdentity: z.discriminatedUnion("entityKind", [
      z.object({ entityKind: z.literal("device-instance"), deviceInstance: DeviceInstanceRefSchema }).strict(),
      z
        .object({
          entityKind: z.literal("service-instance"),
          service: LogicalServiceIdSchema,
          /**
           * Service DEPLOYMENT version — an OPAQUE vendor version string
           * ({@link NfcString}: non-empty, well-formed Unicode, NFC), NOT core
           * SemVer. It is distinct from the Checkpoint's core-SemVer authorization
           * identity; a vendor may deploy `1.0.0-rc1` / `1.0.0+build`.
           */
          serviceVersion: NfcString,
          serviceInstanceRef: OpaqueIdSchema,
        })
        .strict(),
      z.object({ entityKind: z.literal("participant"), participant: ParticipantRefSchema }).strict(),
      z
        .object({
          entityKind: z.literal("participant-instance"),
          participant: ParticipantRefSchema,
          /**
           * Opaque running-instance id of this Participant (relay / adapter /
           * other runtime intermediary). Binding it means a hop whose Participant
           * keeps the same `participantId` but changes running instance produces a
           * different path — so an instance switch that must invalidate an
           * Approval/Grant is detectable (the bare `participant` branch cannot).
           */
          instanceId: OpaqueIdSchema,
        })
        .strict(),
    ]),
  })
  .strict();
export type PathHop = z.infer<typeof PathHopSchema>;

/**
 * The ordered invocation path (arch/16 §3 `A, through B, performs D on C`).
 * **Ordering is significant**: the array is the path root→leaf, from the
 * **originator (A)** toward the **target (C's serving element)**, with
 * append-only semantics — an intermediary adds a hop, it never rewrites an
 * earlier one. A sub-ref of ReviewedScope (no `contractVersion`).
 *
 * §3 topology is enforced fail-closed (length >= 2 is implied):
 *   - the FIRST hop is the sole `originator` (A);
 *   - the LAST hop is the sole `target` (C's serving element), and its
 *     `hopIdentity.entityKind` MUST be `service-instance` — a target is always a
 *     concrete admitted Service Instance, so a bare `participant` (no instance
 *     identity) or a `device-instance` target is rejected;
 *   - every interior hop is an `intermediary` (an element of B).
 */
export const InvocationPathSchema = z
  .array(PathHopSchema)
  .min(2, "invocation path must have >= 2 hops (originator .. target)")
  .superRefine((hops, ctx) => {
    const last = hops.length - 1;
    hops.forEach((hop, i) => {
      const expected: PathRole = i === 0 ? "originator" : i === last ? "target" : "intermediary";
      if (hop.pathRole !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            i === 0
              ? "the first hop must be the originator (§3 A); it is the only originator"
              : i === last
                ? "the last hop must be the target (§3 C's serving element); it is the only target"
                : "every interior hop must be an intermediary (§3 an element of B) — originator/target appear only at the ends",
          path: [i, "pathRole"],
        });
      }
    });
    // A target (§3 C) is always a concrete admitted Service Instance.
    const target = hops[last];
    if (target !== undefined && target.pathRole === "target" && target.hopIdentity.entityKind !== "service-instance") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "the target hop's hopIdentity.entityKind must be service-instance (§3: a target is a concrete admitted Service Instance; a bare participant/device-instance target has no instance identity)",
        path: [last, "hopIdentity", "entityKind"],
      });
    }
    // A RUNTIME intermediary (§3 an element of B — a relay / adapter / service)
    // must carry instance-bearing identity so an instance switch is detectable.
    // The bare `participant` entityKind (no instance) is allowed ONLY for the
    // originator (§3: A may be an Account or an autonomous AI originator — the
    // arch/16 §3 `agent:` sense, not a Connector — with no runtime instance).
    hops.forEach((hop, i) => {
      if (i !== 0 && hop.hopIdentity.entityKind === "participant") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "a non-originator hop must carry instance-bearing identity (device-instance / service-instance / participant-instance); the bare participant entityKind (no running instance) is allowed only for the originator, else a relay/adapter instance switch would be undetectable",
          path: [i, "hopIdentity", "entityKind"],
        });
      }
    });
  });
export type InvocationPath = z.infer<typeof InvocationPathSchema>;

/**
 * **Exact, immutable target-admission identity** (arch/16 §7.2: "Target admission
 * is scoped to the concrete Service version, artifact identity, Service Instance,
 * runtime or deployment trust, and requested Checkpoint. A Service must not be
 * marked globally trusted for every version, instance, Resource, or data class").
 * Every dimension §7.2 lists is REQUIRED so a §10 target-admission change is
 * necessarily detectable in the reviewed scope — an artifact or instance change
 * changes this ref and therefore the whole ReviewedScope:
 *
 *   - `service` — the logical Service id (shared {@link LogicalServiceIdSchema}; rejects `svc_*`);
 *   - `serviceVersion` — the concrete admitted Service **deployment** version, an
 *     OPAQUE vendor version string ({@link NfcString}: non-empty, well-formed
 *     Unicode, NFC), NOT core SemVer — distinct from the Checkpoint's core-SemVer
 *     authorization identity, so a vendor `1.0.0-rc1` / `1.0.0+build` is admissible;
 *   - `checkpoint` — the requested {@link CheckpointVersionIdSchema} the admission
 *     is scoped to (§7.2: "admission is scoped to … the requested Checkpoint");
 *   - `artifactDigest` — the artifact **content identity** (`sha-256` + lowercase
 *     hex), not an opaque locator: §7.2 "artifact identity" is immutable content,
 *     so a rebuilt/replaced artifact necessarily changes the digest;
 *   - `serviceInstanceRef` — the opaque Service Instance identity;
 *   - `admissionRevision` — the target-admission decision revision (§7.2);
 *   - `runtimeTrustRevision` — the runtime / deployment trust revision (§7.2).
 *
 * The full §7.2 data-flow admission model (credential release, routing mode,
 * per-target data-class handling) is deferred (#61). A sub-ref (no `contractVersion`).
 */
export const TargetAdmissionRefSchema = z
  .object({
    service: LogicalServiceIdSchema,
    /**
     * Concrete admitted Service DEPLOYMENT version — an OPAQUE vendor version
     * string ({@link NfcString}), NOT core SemVer. Distinct from the Checkpoint's
     * core-SemVer authorization identity carried in `checkpoint`.
     */
    serviceVersion: NfcString,
    checkpoint: CheckpointVersionIdSchema,
    artifactDigest: z.object({ algo: z.literal("sha-256"), digest: Sha256HexSchema }).strict(),
    serviceInstanceRef: OpaqueIdSchema,
    admissionRevision: RevisionSchema,
    runtimeTrustRevision: RevisionSchema,
  })
  .strict()
  // §7.2 fail-closed, STANDALONE: an admission identity names one Service. The
  // admitted `service` and the admitted `checkpoint`'s Service must be the same
  // Service — this object is publicly exported as the exact target-admission
  // identity and must not rely on an enclosing ReviewedScope to reconcile an
  // internal contradiction (e.g. service=linux-ops-widget-nodejs while checkpoint=anyapi/...).
  .superRefine((t, ctx) => {
    if (t.checkpoint.serviceId !== t.service) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checkpoint.serviceId must equal service (§7.2: a target admission identity names exactly one Service)",
        path: ["checkpoint", "serviceId"],
      });
    }
  });
export type TargetAdmissionRef = z.infer<typeof TargetAdmissionRefSchema>;

/* ------------------------------------------------------------------ *
 * C1.2c Managed Access Session binding snapshot (arch/16 §2/§6/§8)
 * ------------------------------------------------------------------ */

/**
 * The **immutable Managed Access Session binding snapshot** embedded in a
 * {@link ReviewedScopeSchema}. It is the AUTHORITATIVE binding of the reviewed
 * `SESSION_BOUND` authority to the session's complete §2/§6 composite —
 * Account, Account Token (id + revision), Device Workload Identity, Device
 * Instance, Service Selection, authentication context, bounded lifetime, and
 * lifecycle state — not merely the session's opaque id (PR #89 review: a bare
 * `sessionId` cannot prove the reviewed identities belong to the named session;
 * the same id could be recorded alongside an arbitrarily substituted token
 * revision / Device Instance / Service Selection and still parse).
 *
 * Structurally this is {@link ManagedAccessSessionSchema} minus the top-level
 * `contractVersion` (it is a sub-ref of the audit document, which states the
 * version once): the SAME `establishment` discriminated union (arch/16 §6.1;
 * docs#278 — credential-pair carries the token identities, device-authenticated
 * carries none and the `authenticationContext` reference is the establishing
 * authority, an immutable generation identity), the same canonical defaulting
 * rule (absent `establishment` = credential-pair), and the SAME fail-closed
 * invariants:
 *
 *   1. (`credential-pair` only) §35/§2 single-instance binding — the Device
 *      Workload Identity's FULL `(deviceType, deviceInstanceId)` must equal
 *      the Device Instance's;
 *   2. bounded lifetime ordering — `createdAtVersion <= expiresAtVersion`.
 *
 * `state` is RECORDED as reviewed, not constrained HERE: an audit snapshot may
 * legitimately record a decision made against a non-`ACTIVE` session (e.g. a
 * DENY because the session had expired) — but the enclosing {@link
 * AuditSnapshotSchema} enforces that a non-`ACTIVE` reviewed state can only
 * accompany a `DENY` decision and never a `grantRef` (§6/§8: session
 * end/expiry/revocation/invalidation ends SESSION_BOUND authority; PR #89
 * review 2). The enclosing {@link
 * ReviewedScopeSchema} additionally enforces field-by-field agreement between
 * this snapshot and the identities it carries at top level (§8 `SESSION_BOUND`:
 * session/token/device/scope change invalidates the binding, so a divergence is
 * a fork and fails closed).
 */
export const ManagedAccessSessionBindingSchema = z
  .preprocess(
    defaultEstablishmentToCredentialPair,
    z.discriminatedUnion("establishment", [
      z
        .object({
          establishment: z.literal("credential-pair"),
          accountToken: AccountTokenRefSchema,
          deviceWorkloadIdentity: DeviceWorkloadIdentityRefSchema,
          ...managedAccessSessionCommonFields,
        })
        .strict(),
      z
        .object({
          establishment: z.literal("device-authenticated"),
          accountToken: z.never().optional(),
          deviceWorkloadIdentity: z.never().optional(),
          ...managedAccessSessionCommonFields,
        })
        .strict(),
    ]),
  )
  // Identical invariants to ManagedAccessSessionSchema's (the snapshot must be
  // internally coherent on its own, without relying on the enclosing
  // ReviewedScope's copy of the same invariants).
  .superRefine(managedAccessSessionInvariants);
export type ManagedAccessSessionBinding = z.infer<typeof ManagedAccessSessionBindingSchema>;

/**
 * The **reviewed scope** frozen into a Decision and its immutable AuditSnapshot
 * (arch/16 §7.1 "exact reviewed scope"; §10 lists what invalidates an Approval /
 * Grant). It snapshots the FULL §8 `SESSION_BOUND` binding set (Account,
 * Account Token id+revision, authenticated Device Workload Identity and Device Instance,
 * Managed Access Session, Service Selection, Checkpoint + Resource + control
 * requirements via the resolved authorization), plus the §3 invocation path, the
 * §7.2 target admission, the §7.2 output-classification upper bound, and the §4
 * parameter digest — so **any §10 change is detectable**: a payload change
 * (parameterDigest), Checkpoint/Resource/controls change (resolved), path change
 * (invocationPath), target-admission change (targetAdmission), data-class change
 * (outputClassificationUpperBound), or a revocation-sensitive revision (carried
 * inside `resolved`).
 *
 *   - `resolved` — the exact-identity {@link ResolvedAuthorizationSchema} (§7.1),
 *     which itself carries the Checkpoint version, Resource binding, control
 *     requirements, and the policy/binding revision provenance;
 *   - `managedAccessSession` — the immutable {@link
 *     ManagedAccessSessionBindingSchema} snapshot of the Managed Access Session
 *     the review was bound to (§8 `SESSION_BOUND` binds the COMPLETE current
 *     session context, not an opaque session id; PR #89 review High);
 *   - `outputClassificationUpperBound` — the §7.2 conservative output-class upper
 *     bound the review admitted (a part-1 {@link DataClassificationSchema}).
 *
 * The scope names its **establishing authority context** explicitly (arch/16
 * §6.1; docs#278) — the same `establishment` discriminated union and canonical
 * defaulting rule as {@link ManagedAccessSessionSchema}: the `credential-pair`
 * branch reviews the Account Token (id + revision) and the Device Workload
 * Identity (+ `credentialRevision`), exactly the pre-dual-form shape; the
 * `device-authenticated` branch reviews the `authenticationContext` reference
 * (the establishing authority — an immutable generation identity, §6.1 rule 5)
 * together with the `deviceInstance`, and carries NO token identity (invalid
 * if present). Either way every §10 identity the review depends on is still
 * frozen: on the device-authenticated path the authentication-context
 * GENERATION plays the revision role the token identities play on the
 * credential-pair path (any change there is a NEW context id).
 *
 * Fail-closed cross-field invariants: (1) (`credential-pair` only) the §35
 * single-instance binding — the Device Workload Identity's FULL `(deviceType,
 * deviceInstanceId)` must equal the Device Instance's (matching the instance id
 * alone would let a workload bound to one deviceType ride a scope for a
 * different deviceType); (2) §7.2 service
 * consistency — `targetAdmission.service` must equal `resolved.service`, and when
 * `serviceSelection` is `explicit` its `services` must include `resolved.service`,
 * so the review cannot admit or select a Service other than the one it resolved;
 * (3) §7.2 admission-scoping — `targetAdmission.checkpoint` must deep-equal
 * `resolved.checkpoint` (admission is scoped to the resolved Checkpoint); (4) §3
 * path↔admission agreement — the target hop (the last hop, a `service-instance`)
 * must carry the SAME `service` / `serviceVersion` / `serviceInstanceRef` as
 * `targetAdmission`, so the path's serving element is exactly the admitted target;
 * (5) §3 device-in-path — the reviewed `deviceInstance` must appear as some
 * `device-instance` hop on the path (the current Managed Device Instance is in B);
 * (6) §8 session-binding agreement — every identity the session snapshot binds
 * for the reviewed path (`account`, `deviceInstance`, `serviceSelection`; plus
 * `accountToken` id+revision and `deviceWorkloadIdentity` on `credential-pair`,
 * or the `authenticationContext` reference on `device-authenticated`) must
 * equal the same-named top-level reviewed field, so the scope cannot name a
 * session while substituting a different token revision / authentication
 * generation / Device Instance / Service Selection (the session-authority gap
 * raised in the PR #89 post-concept-change review); (7) §6.1 establishing-
 * authority agreement — the embedded snapshot's `establishment` must equal the
 * scope's own (a scope reviewing one path while binding a session established
 * on the other is a fork).
 *
 * Although large, this is a sub-ref embedded in the durable Decision / audit
 * record, so it does NOT independently carry `contractVersion`; the top-level
 * {@link AuditSnapshotSchema} states the version once for the whole document.
 */
const reviewedScopeCommonFields = {
  account: AccountRefSchema,
  deviceInstance: DeviceInstanceRefSchema,
  managedAccessSession: ManagedAccessSessionBindingSchema,
  serviceSelection: ServiceSelectionSchema,
  resolved: ResolvedAuthorizationSchema,
  invocationPath: InvocationPathSchema,
  targetAdmission: TargetAdmissionRefSchema,
  outputClassificationUpperBound: DataClassificationSchema,
  parameterDigest: ParameterDigestSchema,
} as const;

const ReviewedScopeCredentialPairSchema = z
  .object({
    establishment: z.literal("credential-pair"),
    accountToken: AccountTokenRefSchema,
    deviceWorkloadIdentity: DeviceWorkloadIdentityRefSchema,
    ...reviewedScopeCommonFields,
  })
  .strict();

const ReviewedScopeDeviceAuthenticatedSchema = z
  .object({
    establishment: z.literal("device-authenticated"),
    authenticationContext: AuthenticationContextRefSchema,
    accountToken: z.never().optional(),
    deviceWorkloadIdentity: z.never().optional(),
    ...reviewedScopeCommonFields,
  })
  .strict();

type ReviewedScopeUnion =
  | z.infer<typeof ReviewedScopeCredentialPairSchema>
  | z.infer<typeof ReviewedScopeDeviceAuthenticatedSchema>;

function reviewedScopeInvariants(s: ReviewedScopeUnion, ctx: z.RefinementCtx): void {
  // (1) §35/§2 single-instance binding (credential-pair only): the Device
  // Workload Identity is bound to ONE Device Instance; the FULL (deviceType,
  // deviceInstanceId) identity must match — the instance id alone is not
  // enough (a different deviceType with a colliding instance id must not pass).
  if (
    s.establishment === "credential-pair" &&
    (s.deviceWorkloadIdentity.deviceType !== s.deviceInstance.deviceType ||
      s.deviceWorkloadIdentity.deviceInstanceId !== s.deviceInstance.deviceInstanceId)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "deviceWorkloadIdentity (deviceType, deviceInstanceId) must equal deviceInstance's (§35/§2 single-instance binding: the full Device Instance identity, not the instance id alone)",
      path: ["deviceWorkloadIdentity", "deviceInstanceId"],
    });
  }
  // (2) §7.2 target admission must admit the SAME Service the authorization
  // resolved to (`resolved.service`). A mismatch would fork the review —
  // authorizing one Service while admitting a different target — so fail closed.
  // (`resolved.checkpoint.serviceId === resolved.service` is already enforced
  // inside ResolvedAuthorization; not duplicated here.)
  if (s.targetAdmission.service !== s.resolved.service) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "targetAdmission.service must equal resolved.service (§7.2 fail-closed: the admitted target must be the Service the authorization resolved to — a mismatch forks the review)",
      path: ["targetAdmission", "service"],
    });
  }
  // An explicit Service Selection must include the resolved Service; otherwise
  // the review authorized a Service the selection never permitted — a fork.
  // `scope: "all"` selects all permitted Services, so no membership check applies.
  if (s.serviceSelection.scope === "explicit" && !s.serviceSelection.services.includes(s.resolved.service)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "explicit serviceSelection.services must include resolved.service (§7.2 fail-closed: an explicit selection cannot authorize a Service it did not select — a mismatch forks the review)",
      path: ["serviceSelection", "services"],
    });
  }
  // (3) §7.2 admission-scoping: target admission is scoped to the requested
  // Checkpoint, so the admitted checkpoint must be the resolved one — a mismatch
  // would admit a target for a different Checkpoint than the one authorized.
  const ta = s.targetAdmission.checkpoint;
  const rc = s.resolved.checkpoint;
  if (ta.serviceId !== rc.serviceId || ta.checkpointId !== rc.checkpointId || ta.checkpointVersion !== rc.checkpointVersion) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "targetAdmission.checkpoint must equal resolved.checkpoint (§7.2 fail-closed: admission is scoped to the resolved Checkpoint — a mismatch admits a target for a different Checkpoint)",
      path: ["targetAdmission", "checkpoint"],
    });
  }
  // (4) §3 path↔admission agreement: the target hop (the last hop) is the
  // serving element (C) and must be exactly the admitted target Service
  // Instance. Guard on the topology already enforced by InvocationPathSchema —
  // only compare when the last hop is the expected service-instance target
  // (else the path itself already reported the topology violation).
  const target = s.invocationPath[s.invocationPath.length - 1];
  if (target !== undefined && target.pathRole === "target" && target.hopIdentity.entityKind === "service-instance") {
    const id = target.hopIdentity;
    if (
      id.service !== s.targetAdmission.service ||
      id.serviceVersion !== s.targetAdmission.serviceVersion ||
      id.serviceInstanceRef !== s.targetAdmission.serviceInstanceRef
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "the target hop's (service, serviceVersion, serviceInstanceRef) must equal targetAdmission's (§3/§7.2 fail-closed: the path's serving element must be exactly the admitted target instance)",
        path: ["invocationPath", s.invocationPath.length - 1, "hopIdentity"],
      });
    }
  }
  // (5) §3 device-in-path: the current Managed Device Instance must appear on
  // the path — some device-instance hop whose full (deviceType,
  // deviceInstanceId) equals the reviewed deviceInstance.
  const deviceInPath = s.invocationPath.some(
    (hop) =>
      hop.hopIdentity.entityKind === "device-instance" &&
      hop.hopIdentity.deviceInstance.deviceType === s.deviceInstance.deviceType &&
      hop.hopIdentity.deviceInstance.deviceInstanceId === s.deviceInstance.deviceInstanceId,
  );
  if (!deviceInPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "the reviewed deviceInstance must appear as a device-instance hop on the invocationPath (§3 fail-closed: the current Managed Device Instance is part of path B)",
      path: ["invocationPath"],
    });
  }
  // (6)+(7) §8 session-binding agreement (PR #89 review High) and §6.1
  // establishing-authority agreement (docs#278): the embedded Managed Access
  // Session snapshot is the AUTHORITATIVE composite binding; each identity it
  // binds must equal the same-named top-level reviewed field, and it must have
  // been ESTABLISHED on the same path the scope reviews. Any divergence means
  // the scope names a session while substituting a different Account / token
  // revision / authentication generation / workload / Device Instance /
  // Service Selection — a fork, so each mismatch fails closed with its own issue.
  const mas = s.managedAccessSession;
  if (mas.establishment !== s.establishment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "managedAccessSession.establishment must equal the scope's establishment (§6.1 fail-closed: a scope reviewing one establishing-authority path cannot bind a session established on the other — a fork)",
      path: ["managedAccessSession", "establishment"],
    });
  }
  if (mas.account.accountId !== s.account.accountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "managedAccessSession.account must equal the reviewed account (§8 fail-closed: the SESSION_BOUND scope cannot bind a session issued for a different Account)",
      path: ["managedAccessSession", "account"],
    });
  }
  if (s.establishment === "credential-pair" && mas.establishment === "credential-pair") {
    if (mas.accountToken.tokenId !== s.accountToken.tokenId || mas.accountToken.revision !== s.accountToken.revision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "managedAccessSession.accountToken (tokenId, revision) must equal the reviewed accountToken's (§8 fail-closed: a token or token-revision substitution under the same sessionId forks the session binding)",
        path: ["managedAccessSession", "accountToken"],
      });
    }
    if (
      mas.deviceWorkloadIdentity.workloadIdentityId !== s.deviceWorkloadIdentity.workloadIdentityId ||
      mas.deviceWorkloadIdentity.credentialRevision !== s.deviceWorkloadIdentity.credentialRevision ||
      mas.deviceWorkloadIdentity.deviceType !== s.deviceWorkloadIdentity.deviceType ||
      mas.deviceWorkloadIdentity.deviceInstanceId !== s.deviceWorkloadIdentity.deviceInstanceId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "managedAccessSession.deviceWorkloadIdentity must equal the reviewed deviceWorkloadIdentity — all of (workloadIdentityId, credentialRevision, deviceType, deviceInstanceId) (§8 fail-closed: a workload or credential-revision substitution under the same sessionId forks the session binding)",
        path: ["managedAccessSession", "deviceWorkloadIdentity"],
      });
    }
  }
  if (
    s.establishment === "device-authenticated" &&
    mas.authenticationContext.authenticationContextId !== s.authenticationContext.authenticationContextId
  ) {
    // The authentication-context reference IS the establishing authority on
    // this path (§6.1 rule 5: an immutable generation identity — the
    // identifier is the revision), so a substitution here is exactly the
    // token/revision substitution of the credential-pair path.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "managedAccessSession.authenticationContext must equal the reviewed authenticationContext (§6.1/§8 fail-closed: an authentication-generation substitution under the same sessionId forks the session binding)",
      path: ["managedAccessSession", "authenticationContext"],
    });
  }
  if (
    mas.deviceInstance.deviceType !== s.deviceInstance.deviceType ||
    mas.deviceInstance.deviceInstanceId !== s.deviceInstance.deviceInstanceId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "managedAccessSession.deviceInstance (deviceType, deviceInstanceId) must equal the reviewed deviceInstance's (§8 fail-closed: a Device Instance substitution under the same sessionId forks the session binding)",
      path: ["managedAccessSession", "deviceInstance"],
    });
  }
  // Both selections are already canonical (ServiceSelectionSchema enforces
  // strict-ascending explicit lists), so element-wise equality is exact
  // set equality — no re-canonicalization needed here.
  const bSel = mas.serviceSelection;
  const rSel = s.serviceSelection;
  const selectionEqual =
    bSel.scope === "explicit" && rSel.scope === "explicit"
      ? bSel.services.length === rSel.services.length && bSel.services.every((svc, i) => svc === rSel.services[i])
      : bSel.scope === rSel.scope;
  if (!selectionEqual) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "managedAccessSession.serviceSelection must equal the reviewed serviceSelection (§8 fail-closed: a Service Selection substitution under the same sessionId forks the session binding)",
      path: ["managedAccessSession", "serviceSelection"],
    });
  }
}

export const ReviewedScopeSchema = z
  .preprocess(
    defaultEstablishmentToCredentialPair,
    z.discriminatedUnion("establishment", [ReviewedScopeCredentialPairSchema, ReviewedScopeDeviceAuthenticatedSchema]),
  )
  .superRefine(reviewedScopeInvariants);
export type ReviewedScope = z.infer<typeof ReviewedScopeSchema>;

/* ------------------------------------------------------------------ *
 * C1.3 Decision (arch/16 §10 async durable outcome)
 * ------------------------------------------------------------------ */

/**
 * The outcome of an authorization decision (arch/16 §10, §8.1). Beyond
 * `ALLOW`/`DENY` this includes the non-terminal **durable** control outcomes
 * returned instead of holding a connection: `REAUTHENTICATION_REQUIRED` (a
 * challenge must be completed), `APPROVAL_REQUIRED` (an approval is pending),
 * and `CONFIRMATION_REQUIRED` (§8.1: the input is complete and unambiguous and
 * what is missing is the originator's ASSENT — deliberately not a
 * clarification outcome, which a client may legitimately resolve by supplying
 * a value on its own; sharing one outcome would let an autofill satisfy a
 * control). None of the three is a denial and none may be collapsed into one
 * (§8.1 / arch-19 §5 N8). Closed enum.
 */
export const DecisionOutcome = [
  "ALLOW",
  "DENY",
  "REAUTHENTICATION_REQUIRED",
  "APPROVAL_REQUIRED",
  "CONFIRMATION_REQUIRED",
] as const;
export const DecisionOutcomeSchema = z.enum(DecisionOutcome);
export type DecisionOutcome = (typeof DecisionOutcome)[number];

/**
 * The machine-readable reason a decision reached its outcome (arch/16 §10 /
 * §8.1). Each code is consistent with exactly one outcome (enforced on {@link
 * DecisionSchema}): `ALLOWED` for `ALLOW`; the `DENIED_*` family for `DENY`
 * (policy, authentication, approval, target admission, or data-flow); and the
 * `CHALLENGE_*` family for the non-terminal control outcomes
 * (reauthentication, approval, confirmation). Closed enum.
 */
export const DecisionReasonCode = [
  "ALLOWED",
  "DENIED_POLICY",
  "DENIED_AUTH",
  "DENIED_APPROVAL",
  "DENIED_TARGET_ADMISSION",
  "DENIED_DATA_FLOW",
  "CHALLENGE_REAUTH",
  "CHALLENGE_APPROVAL",
  "CHALLENGE_CONFIRMATION",
] as const;
export const DecisionReasonCodeSchema = z.enum(DecisionReasonCode);
export type DecisionReasonCode = (typeof DecisionReasonCode)[number];

/**
 * An authorization Decision (arch/16 §10). Modeled as a CLOSED discriminated union
 * on `outcome` so the TYPE itself admits only the legal states — an outcome and
 * its fields can never disagree, and each branch carries ONLY its legal fields:
 *
 *   - `ALLOW`                      — `reasonCode` `ALLOWED`; no ref;
 *   - `DENY`                       — `reasonCode` one of the `DENIED_*` family; no ref;
 *   - `REAUTHENTICATION_REQUIRED`  — `reasonCode` `CHALLENGE_REAUTH`; exactly a `challengeRef`;
 *   - `APPROVAL_REQUIRED`          — `reasonCode` `CHALLENGE_APPROVAL`; exactly an `approvalRef`;
 *   - `CONFIRMATION_REQUIRED`      — `reasonCode` `CHALLENGE_CONFIRMATION`; exactly a
 *     `continuationRef` (§8.1: the control result carries the continuation handle,
 *     and the follow-up submission carries that handle — never a self-declared
 *     `confirmed: true`, which is an assertion by exactly the party the control
 *     exists to interpose).
 *
 * Because each branch is `.strict()`, a ref on the wrong branch (e.g. a
 * `challengeRef` on `ALLOW`) is an unknown-field rejection, not a runtime
 * cross-check. The refs are minimal opaque id refs into the slice C2 lifecycle
 * objects ({@link AuthenticationChallengeSchema}, {@link ApprovalSchema},
 * {@link ConfirmationContinuationSchema}). A sub-ref (no `contractVersion`).
 */
export const DecisionSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("ALLOW"), reasonCode: z.literal("ALLOWED") }).strict(),
  z
    .object({
      outcome: z.literal("DENY"),
      reasonCode: z.enum([
        "DENIED_POLICY",
        "DENIED_AUTH",
        "DENIED_APPROVAL",
        "DENIED_TARGET_ADMISSION",
        "DENIED_DATA_FLOW",
      ]),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("REAUTHENTICATION_REQUIRED"),
      reasonCode: z.literal("CHALLENGE_REAUTH"),
      challengeRef: z.object({ challengeId: OpaqueIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("APPROVAL_REQUIRED"),
      reasonCode: z.literal("CHALLENGE_APPROVAL"),
      approvalRef: z.object({ approvalId: OpaqueIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("CONFIRMATION_REQUIRED"),
      reasonCode: z.literal("CHALLENGE_CONFIRMATION"),
      continuationRef: z.object({ continuationId: OpaqueIdSchema }).strict(),
    })
    .strict(),
]);
export type Decision = z.infer<typeof DecisionSchema>;

/* ------------------------------------------------------------------ *
 * C1.4 Audit snapshot (arch/16 §7.1 immutable historical decision)
 * ------------------------------------------------------------------ */

/**
 * An **immutable historical decision record** (arch/16 §7.1: "historical
 * decisions are immutable"; the resolved identities and revisions are recorded
 * into the decision + audit snapshot). It binds the reviewed scope, the decision,
 * the acting identity, and an optional resulting grant ref, at a real wall-clock
 * time. Fail-closed invariants: (a) `grantRef` may only accompany an `ALLOW`
 * decision (§10: no grant is conferred by a DENY or a pending challenge/approval);
 * and the decision must respect the effective authorization mode
 * (`reviewedScope.resolved.controls.mode`, §8): (b) `DENY` mode ⇒ the decision
 * outcome is `DENY` (an absolute deny cannot resolve to ALLOW/REAUTH/APPROVAL);
 * (c) `AUTO`/`DENY` mode ⇒ NO `grantRef` (AUTO executes without a grant, DENY
 * confers none); (d) `AUTO`/`DENY` mode ⇒ the outcome is not `APPROVAL_REQUIRED`
 * (neither mode requires an approval step — but `CONFIRMATION_REQUIRED` stays
 * legal under `AUTO`: §8.1's confirmation axis is mode-independent, a
 * definition or binding may demand assent even where no grant flow exists;
 * under `DENY` it is already excluded by (b)); and (e) session-state consistency
 * (§6/§8, PR #89 review 2): a `SESSION_BOUND` review is anchored to an ACTIVE
 * Managed Access Session — session end / expiry / revocation / invalidation
 * ends the derived authority — so a reviewed
 * `managedAccessSession.state !== "ACTIVE"` MUST resolve to a `DENY` outcome
 * and MUST NOT carry a `grantRef`. Recording a decision made against a
 * non-ACTIVE session stays legal (the snapshot records the reviewed state,
 * review 1); the record just cannot claim that authorization SUCCEEDED, or
 * that a Grant was conferred, under a session that had already ended.
 *
 * There is **no `state` field**: this is a historical record, not a live object.
 * The mutable Approval / Grant lifecycles live on their own objects (§10, later
 * slice); an audit snapshot never transitions.
 *
 * `actor` is a CLOSED discriminated union on `actorKind`: a Participant (§3
 * invocation-relative, {@link ParticipantRefSchema}) or a Principal (§2 fixed-type
 * audit identity, {@link PrincipalRefSchema}). Because those two refs could
 * structurally overlap, the discriminator makes the actor exactly one kind —
 * never an ambiguous either/or.
 *
 * As a top-level, independently-exported wire document it carries
 * `contractVersion` (the literal `CHECKPOINT_CONTRACT_VERSION`) as its first field,
 * mirroring part 1's `CheckpointDefinition`; its sub-refs do not.
 * `atUnixSeconds` is real wall-clock time in Unix seconds, bounded to
 * `Number.MAX_SAFE_INTEGER` ({@link SAFE_INT_MAX}) so it stays JSON-number-safe.
 */
export const AuditSnapshotSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    auditId: OpaqueIdSchema,
    reviewedScope: ReviewedScopeSchema,
    decision: DecisionSchema,
    actor: z.discriminatedUnion("actorKind", [
      z.object({ actorKind: z.literal("participant"), participant: ParticipantRefSchema }).strict(),
      z.object({ actorKind: z.literal("principal"), principal: PrincipalRefSchema }).strict(),
    ]),
    grantRef: z.object({ grantId: OpaqueIdSchema }).strict().optional(),
    atUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
  })
  .strict()
  .superRefine((a, ctx) => {
    // §10 fail-closed: a resulting Authorization Grant can only accompany an
    // ALLOW. A grant recorded against DENY / REAUTHENTICATION_REQUIRED /
    // APPROVAL_REQUIRED would assert authority the decision never conferred.
    if (a.grantRef !== undefined && a.decision.outcome !== "ALLOW") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "grantRef may only accompany an ALLOW decision (§10: no grant is conferred by a DENY or a pending challenge/approval)",
        path: ["grantRef"],
      });
    }
    // §8: the decision must respect the effective authorization mode.
    const mode = a.reviewedScope.resolved.controls.mode;
    // (b) DENY mode is absolute — it cannot resolve to ALLOW/REAUTH/APPROVAL.
    if (mode === "DENY" && a.decision.outcome !== "DENY") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a DENY authorization mode must resolve to a DENY decision (§8: DENY is absolute and cannot be overridden by approval/authentication)",
        path: ["decision", "outcome"],
      });
    }
    // (c) AUTO executes without a grant and DENY confers none — neither carries a grantRef.
    if ((mode === "AUTO" || mode === "DENY") && a.grantRef !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an AUTO/DENY authorization mode must not carry a grantRef (§8: AUTO executes without a grant; DENY confers none)",
        path: ["grantRef"],
      });
    }
    // (d) neither AUTO nor DENY requires an approval step.
    if ((mode === "AUTO" || mode === "DENY") && a.decision.outcome === "APPROVAL_REQUIRED") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an AUTO/DENY authorization mode cannot yield APPROVAL_REQUIRED (§8: neither mode requires an approval step)",
        path: ["decision", "outcome"],
      });
    }
    // (e) §6/§8 session-state consistency (PR #89 review 2): SESSION_BOUND
    // authority is anchored to an ACTIVE Managed Access Session; session end,
    // expiry, revocation, or invalidation ends the derived authority. The
    // snapshot records the REVIEWED state, so a non-ACTIVE state can only be
    // recorded alongside the one outcome it can truthfully produce — DENY —
    // and never alongside a conferred Grant.
    const sessionState = a.reviewedScope.managedAccessSession.state;
    if (sessionState !== "ACTIVE" && a.decision.outcome !== "DENY") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a non-ACTIVE Managed Access Session (state ${sessionState}) must resolve to a DENY decision, not ${a.decision.outcome} (§6/§8 fail-closed: session end/expiry/revocation/invalidation ends SESSION_BOUND authority)`,
        path: ["decision", "outcome"],
      });
    }
    if (sessionState !== "ACTIVE" && a.grantRef !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a non-ACTIVE Managed Access Session (state ${sessionState}) must not carry a grantRef (§6/§8 fail-closed: no Grant is conferred under a session that has ended)`,
        path: ["grantRef"],
      });
    }
  });
export type AuditSnapshot = z.infer<typeof AuditSnapshotSchema>;

/**
 * Canonical, collision-free key for an AuditSnapshot, e.g. `audit<US>aud-123`.
 * Validates + fails closed (mirrors slice A's {@link workloadKey}): the input is
 * re-parsed, and the U+001F separator cannot appear inside an {@link
 * OpaqueIdSchema} auditId, so distinct audit records never share a key.
 */
export function auditSnapshotKey(a: AuditSnapshot): string {
  const v = AuditSnapshotSchema.parse(a);
  return `audit${WORKLOAD_KEY_SEP}${v.auditId}`;
}

/* ------------------------------------------------------------------ *
 * C2. Durable workflow objects (arch/16 §10, §8.1; #60)
 *
 * The mutable lifecycles the C1 records only referenced: Authentication
 * Challenge, single-stage Approval, Authorization Grant, and the §8.1
 * Confirmation Continuation. Each is a top-level wire document (carries
 * `contractVersion`), state-bearing, and validated with the same fail-closed
 * discipline as C1: an object whose fields contradict its state does not parse.
 *
 * Deliberately NOT here (deferred, per arch/16 §17.2): separation-of-duty and
 * multi-stage approvals; the Invocation Envelope as a wire object and per-hop
 * credential materialization (§17.3); the arch-19 §5 recovery-state vocabulary
 * (`ACCEPTED`/`CONTROL_ISSUED`/`NOT_ACCEPTED`/`STILL_UNKNOWN`), which is the
 * governed-invocation API's response surface (platform-ce#116), not a §10
 * lifecycle object.
 * ------------------------------------------------------------------ */

/**
 * A client-supplied logical-request id (arch-19 §5 `requestId`): the client's
 * idempotency key, generated BEFORE submission so recovery never depends on
 * having received a `commandId`. Free-form (the client chooses it) but bounded
 * and held to the same well-formed-Unicode + NFC wire rule as every free string
 * here. It is NOT an {@link OpaqueIdSchema} — the Platform does not mint it and
 * must not parse structure out of it — and it MAY contain characters (including
 * U+001F) that the collision-free `*Key` helpers exclude, which is why no key
 * helper ever embeds a requestId.
 */
const RequestIdSchema = NfcString.refine((v) => v.length <= 256, {
  message: "requestId is bounded to 256 characters (a client-supplied idempotency key, not unbounded free text)",
});

/**
 * Authentication Challenge lifecycle states (arch/16 §10): `PENDING` (issued,
 * awaiting completion), `COMPLETED` (evidence produced, not yet consumed),
 * `EXPIRED` (absolute expiry passed), `REVOKED`, `CONSUMED` (the evidence's
 * single consumption, paired with the subject — #123: an APPROVER challenge is
 * attached to the Approval it decided or the Grant it minted; a REQUESTER
 * challenge is accepted by the exact invocation in its scope; terminal —
 * evidence cannot be replayed for another consumer).
 * §10's "unless a policy explicitly authorizes reusable
 * authentication evidence" carve-out is DELIBERATELY NOT representable in this
 * slice: there is no machine-verifiable reusable-evidence field anywhere in
 * the policy contract yet, and a wire flag on the challenge itself would be
 * the challenge declaring its own reusability — so until the policy algebra
 * lands, every attachment consumes (fail closed; review 2501). Closed enum.
 */
export const AuthenticationChallengeState = ["PENDING", "COMPLETED", "EXPIRED", "REVOKED", "CONSUMED"] as const;
export const AuthenticationChallengeStateSchema = z.enum(AuthenticationChallengeState);
export type AuthenticationChallengeState = (typeof AuthenticationChallengeState)[number];

/**
 * An **Authentication Challenge** (arch/16 §10): the durable object proving a
 * required identity confirmation was completed. §10 binds it to the Account or
 * approver, the Device Workload Identity and Device Instance, the
 * authentication requirement, an invocation or approval scope, a nonce, an
 * absolute expiry, and the policy revision it was issued under:
 *
 *   - `subject` — WHO must complete it, a closed union: the requester (an
 *     Account) or an approver carrying the SAME actor domain an Approval's
 *     `approver` accepts (Participant or Principal — review 2504 High: any
 *     actor that may approve must be able to receive a REAUTH/MFA challenge;
 *     a narrower domain here would make approver authentication impossible
 *     for a legal Principal approver). The subject kind is paired with the
 *     scope kind (fail-closed below): a requester authenticates for an
 *     invocation, an approver for an approval decision.
 *   - `scope` — WHAT the completion evidence may satisfy, a closed union on an
 *     invocation id or an approval id (§10: "Completion evidence may satisfy
 *     only the scope and freshness window for which it was issued").
 *   - `requirement` — the {@link AuthenticationRequirementSpecSchema} (level +
 *     freshness window) the challenge was issued to satisfy. `NONE` is
 *     REFUSED (review 2502): a challenge exists to prove a required identity
 *     confirmation, and `NONE` names the absence of such a requirement — a
 *     "prove nothing" challenge is a contradiction, and minting one would let
 *     trivially-satisfied evidence flow into Approvals/Grants.
 *   - `nonce` — opaque anti-replay value bound into the challenge.
 *   - `policyProvenance` — the exact policy id + revision the requirement was
 *     derived from (mirrors {@link PolicyBindingContributionSchema}'s
 *     provenance discipline: an auditor can name WHICH policy demanded this).
 *   - `evidence` — the resulting {@link AuthenticationEvidenceSchema}:
 *     REQUIRED on `COMPLETED`/`CONSUMED`, FORBIDDEN on `PENDING` (nothing has
 *     been proven yet), and OPTIONAL on `EXPIRED`/`REVOKED` — a challenge that
 *     completed and THEN expired or was revoked KEEPS its historical evidence
 *     (review 2503 High: a legal `COMPLETED -> EXPIRED/REVOKED` transition
 *     must not force deleting the record of what was proven; these are
 *     durable lifecycle objects). All coherence checks run whenever evidence
 *     is present. It is an independently-defined §9 document embedded whole
 *     (its own `contractVersion` literal is pinned to the same value by its
 *     schema).
 *   - `consumedBy` — the single consumer of the completion, present IFF
 *     `CONSUMED`, and PAIRED with the subject (#123): an approver challenge is
 *     attached to the Approval it decided (naming the scope's approvalId) or
 *     the Grant it minted; a requester challenge is consumed by the exact
 *     invocation in its scope — no Approval or Grant exists on that path.
 *
 * Fail-closed cross-field invariants: (1) `issuedAt <= expiresAt`; (2) the §35
 * single-instance binding (workload identity's FULL `(deviceType,
 * deviceInstanceId)` equals the Device Instance's); (3) evidence is required
 * on completion states, forbidden on `PENDING`, and history-preserving on
 * `EXPIRED`/`REVOKED`; (4) `consumedBy` presence matches state; (5) the
 * evidence, when present, must have
 * been produced by THIS challenge (`sessionOrChallenge` is the `challenge`
 * branch naming this `challengeId`), through THIS Device Instance, at a level
 * satisfying `requirement.requirement` (rank comparison on the §9 total
 * order), within the challenge's issue window (`issuedAt <= authenticationAt
 * <= expiresAt`); (6) subject/scope pairing — requester ⇔ invocation scope,
 * approver ⇔ approval scope.
 */
export const AuthenticationChallengeSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    challengeId: OpaqueIdSchema,
    state: AuthenticationChallengeStateSchema,
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("requester"), account: AccountRefSchema }).strict(),
      z
        .object({
          kind: z.literal("approver"),
          actor: z.discriminatedUnion("actorKind", [
            z.object({ actorKind: z.literal("participant"), participant: ParticipantRefSchema }).strict(),
            z.object({ actorKind: z.literal("principal"), principal: PrincipalRefSchema }).strict(),
          ]),
        })
        .strict(),
    ]),
    deviceWorkloadIdentity: DeviceWorkloadIdentityRefSchema,
    deviceInstance: DeviceInstanceRefSchema,
    requirement: AuthenticationRequirementSpecSchema,
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("invocation"), invocationId: OpaqueIdSchema }).strict(),
      z.object({ kind: z.literal("approval"), approvalId: OpaqueIdSchema }).strict(),
    ]),
    /** opaque anti-replay nonce bound into the challenge (§10). */
    nonce: OpaqueIdSchema,
    /** The source of the effective LEVEL (platform-ce#243 review 2611: attribution is by ACTUAL contributor, never type priority). */
    policyProvenance: z.object({ policyId: OpaqueIdSchema, policyRevision: RevisionSchema }).strict(),
    /**
     * #123: the source of the effective FRESHNESS WINDOW when a DIFFERENT
     * policy tightened it than supplied the level (A=MFA/3600 + B=REAUTH/300
     * combine to MFA/300 — the 300s is B's). ABSENT when the level source also
     * supplied the window: producers MUST omit it in that case rather than
     * duplicate `policyProvenance` (fail-closed refinement below).
     */
    windowPolicyProvenance: z.object({ policyId: OpaqueIdSchema, policyRevision: RevisionSchema }).strict().optional(),
    issuedAtUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    expiresAtUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    evidence: AuthenticationEvidenceSchema.optional(),
    consumedBy: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("approval"), approvalId: OpaqueIdSchema }).strict(),
        z.object({ kind: z.literal("grant"), grantId: OpaqueIdSchema }).strict(),
        /**
         * #123 (owner Option A, 2026-08-24): a REQUESTER challenge is accepted
         * by the invocation it re-authorizes — there is no Approval or Grant on
         * that path (C2: a flow without an Approval mints no Grant), and the
         * durable invocation record is the acceptance boundary (arch/16 §8.1
         * commandless-target amendment).
         */
        z.object({ kind: z.literal("invocation"), invocationId: OpaqueIdSchema }).strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    // #123 review 2614 High: the consumer branch is PAIRED with subject/scope,
    // exactly as subject is paired with scope. A requester challenge (scope =
    // invocation) is accepted ONLY by that very invocation; an approver
    // challenge (scope = approval) is attached ONLY to an Approval or Grant —
    // and an approval attachment names the scope's own approvalId. Anything
    // else is forged durable provenance and does not parse.
    if (c.consumedBy !== undefined) {
      if (c.subject.kind === "requester") {
        if (c.consumedBy.kind !== "invocation") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "a requester challenge is consumed by its INVOCATION (#123: no Approval/Grant exists on that path) — consumedBy.kind must be \"invocation\"",
            path: ["consumedBy", "kind"],
          });
        } else if (c.scope.kind === "invocation" && c.consumedBy.invocationId !== c.scope.invocationId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "consumedBy.invocationId must equal scope.invocationId (§10: completion evidence may satisfy only the scope it was issued for)",
            path: ["consumedBy", "invocationId"],
          });
        }
      } else {
        // approver subject (scope = approval, enforced by the pairing rule)
        if (c.consumedBy.kind === "invocation") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "an approver challenge is attached to an Approval or Grant, never consumed by an invocation (#123)",
            path: ["consumedBy", "kind"],
          });
        } else if (c.consumedBy.kind === "approval" && c.scope.kind === "approval" && c.consumedBy.approvalId !== c.scope.approvalId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "consumedBy.approvalId must equal scope.approvalId (§10: the evidence attaches to the decision it was issued for)",
            path: ["consumedBy", "approvalId"],
          });
        }
      }
    }
    // #123: a window provenance without a window, or one merely duplicating the
    // level source, is noise a consumer would have to disambiguate — refused.
    if (c.windowPolicyProvenance !== undefined) {
      if (c.requirement.maxAgeSeconds === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "windowPolicyProvenance requires a freshness window (requirement.maxAgeSeconds) to attribute",
          path: ["windowPolicyProvenance"],
        });
      }
      if (c.windowPolicyProvenance.policyId === c.policyProvenance.policyId && c.windowPolicyProvenance.policyRevision === c.policyProvenance.policyRevision) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "windowPolicyProvenance must name a DIFFERENT source than policyProvenance (omit it when the level source supplied the window)",
          path: ["windowPolicyProvenance"],
        });
      }
    }
    // A challenge proves a required confirmation; NONE has nothing to prove
    // (review 2502 High: the NONE axis must be closed, not merely unusual).
    if (c.requirement.requirement === "NONE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "an Authentication Challenge cannot require NONE (§9/§10 fail-closed: a challenge exists to prove a required identity confirmation — NONE names the absence of one)",
        path: ["requirement", "requirement"],
      });
    }
    if (c.issuedAtUnixSeconds > c.expiresAtUnixSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "issuedAtUnixSeconds must be <= expiresAtUnixSeconds (§10: a challenge has an absolute expiry)",
        path: ["expiresAtUnixSeconds"],
      });
    }
    // §35/§2 single-instance binding, same as the session/scope snapshots.
    if (
      c.deviceWorkloadIdentity.deviceType !== c.deviceInstance.deviceType ||
      c.deviceWorkloadIdentity.deviceInstanceId !== c.deviceInstance.deviceInstanceId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "deviceWorkloadIdentity (deviceType, deviceInstanceId) must equal deviceInstance's (§35/§2 single-instance binding)",
        path: ["deviceWorkloadIdentity", "deviceInstanceId"],
      });
    }
    // Evidence presence: completion states require it; PENDING forbids it;
    // EXPIRED/REVOKED may keep the evidence of a completion that happened
    // before the end state (review 2503: durable objects preserve history —
    // a legal COMPLETED -> EXPIRED/REVOKED transition must not force deleting
    // the record of what was proven).
    const completed = c.state === "COMPLETED" || c.state === "CONSUMED";
    if (completed && c.evidence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${c.state} challenge must carry its completion evidence (§10: completion produces evidence)`,
        path: ["evidence"],
      });
    }
    if (c.state === "PENDING" && c.evidence !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a PENDING challenge must not carry evidence (§10: nothing has been proven yet)",
        path: ["evidence"],
      });
    }
    // consumedBy presence matches state; CONSUMED contradicts reusable evidence.
    if (c.state === "CONSUMED" && c.consumedBy === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a CONSUMED challenge must carry consumedBy (§10/#123: the consumer — the Approval/Grant it was attached to, or the requester invocation that accepted it)",
        path: ["consumedBy"],
      });
    }
    if (c.state !== "CONSUMED" && c.consumedBy !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${c.state} challenge must not carry consumedBy (§10: consumption is the CONSUMED transition)`,
        path: ["consumedBy"],
      });
    }
    // Evidence coherence: produced by THIS challenge, on THIS device, at a
    // sufficient level, within the issue window.
    if (c.evidence !== undefined) {
      const ev = c.evidence;
      if (ev.sessionOrChallenge.kind !== "challenge" || ev.sessionOrChallenge.challengeId !== c.challengeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "evidence.sessionOrChallenge must be the challenge branch naming THIS challengeId (§10 fail-closed: evidence produced under a different challenge or a session cannot complete this challenge)",
          path: ["evidence", "sessionOrChallenge"],
        });
      }
      if (
        ev.deviceInstance.deviceType !== c.deviceInstance.deviceType ||
        ev.deviceInstance.deviceInstanceId !== c.deviceInstance.deviceInstanceId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "evidence.deviceInstance must equal the challenge's deviceInstance (§10: the challenge is bound to the Device Instance it was issued for)",
          path: ["evidence", "deviceInstance"],
        });
      }
      if (authenticationRequirementRank(ev.level) < authenticationRequirementRank(c.requirement.requirement)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `evidence.level ${ev.level} does not satisfy the challenge's required level ${c.requirement.requirement} (§9 total order)`,
          path: ["evidence", "level"],
        });
      }
      if (
        ev.authenticationAtUnixSeconds < c.issuedAtUnixSeconds ||
        ev.authenticationAtUnixSeconds > c.expiresAtUnixSeconds
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "evidence.authenticationAtUnixSeconds must lie within [issuedAt, expiresAt] (§10: completion after expiry — or before issue — is not a completion of this challenge)",
          path: ["evidence", "authenticationAtUnixSeconds"],
        });
      }
    }
    // Subject/scope pairing: a requester authenticates for an invocation; an
    // approver authenticates for an approval decision.
    if (c.subject.kind === "requester" && c.scope.kind !== "invocation") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a requester-subject challenge must have an invocation scope (§10: the Account authenticates for its own invocation)",
        path: ["scope"],
      });
    }
    if (c.subject.kind === "approver" && c.scope.kind !== "approval") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an approver-subject challenge must have an approval scope (§10: an approver authenticates for an approval decision)",
        path: ["scope"],
      });
    }
  });
export type AuthenticationChallenge = z.infer<typeof AuthenticationChallengeSchema>;

/**
 * Canonical, collision-free key for an Authentication Challenge, e.g.
 * `challenge<US>ch-123`. Validates + fails closed (mirrors {@link auditSnapshotKey}).
 */
export function authenticationChallengeKey(c: AuthenticationChallenge): string {
  const v = AuthenticationChallengeSchema.parse(c);
  return `challenge${WORKLOAD_KEY_SEP}${v.challengeId}`;
}

/**
 * Approval lifecycle states (arch/16 §10): `PENDING`, `APPROVED`, `REJECTED`,
 * `EXPIRED` (decision deadline passed undecided), `REVOKED`, `INVALIDATED` (a
 * §10 invalidation: reviewed payload, Checkpoint version, Resource, path,
 * target admission, data classification, or a revocation-sensitive revision
 * changed). §10: an expired or invalidated Approval cannot later be approved —
 * a lifecycle rule the Platform enforces on transitions; this schema enforces
 * the per-state field shape. Closed enum.
 */
export const ApprovalState = ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED", "INVALIDATED"] as const;
export const ApprovalStateSchema = z.enum(ApprovalState);
export type ApprovalState = (typeof ApprovalState)[number];

/**
 * A **single-stage Approval** (arch/16 §10; §17.2 explicitly defers
 * separation-of-duty structure and multi-stage approvals, so there are no SoD
 * fields here — adding them is a later, deliberate change to this strict
 * surface). It records a decision to allow or reject an exact invocation
 * scope:
 *
 *   - `requester` — the EXPLICIT requester identity (§10 "requester and
 *     approver identities"), an ACTOR union (Participant or Principal) exactly
 *     like `approver` and {@link AuditSnapshotSchema}'s `actor` — per the
 *     approved C2 design (review 2502 Medium: an `AccountRef` forced equal to
 *     `reviewedScope.account` was the Account repeated, not an actor
 *     identity). Coherence between the requester actor and the reviewed
 *     Account chain is a Platform check — the actor namespaces
 *     (Participant/Principal) and the Account namespace are not frozen equal
 *     here, so a structural equality would be a false guarantee (the same
 *     reasoning already applied to `approver`).
 *   - `reviewedScope` — the exact reviewed scope AND digest (§10): the C1
 *     {@link ReviewedScopeSchema} binds the requester's full identity chain
 *     (Account, token, workload, Device Instance, session), the exact resolved
 *     Checkpoint version / Resource / controls with their policy+binding
 *     revisions (the §10 "revision snapshot"), the invocation path, the target
 *     admission, and the parameter digest — so any §10 invalidation trigger is
 *     detectable against this snapshot.
 *   - `decisionDeadlineUnixSeconds` — the absolute decision deadline (§10).
 *   - `approver` / `decidedAtUnixSeconds` — REQUIRED on `APPROVED`/`REJECTED`,
 *     FORBIDDEN on `PENDING`/`EXPIRED` (no decision was ever recorded — the
 *     machine reaches EXPIRED only from PENDING), and OPTIONAL-BUT-PAIRED on
 *     `REVOKED`/`INVALIDATED`: an approval revoked or invalidated AFTER being
 *     approved KEEPS its decision record (review 2503 High: the legal
 *     `APPROVED -> REVOKED/INVALIDATED` transitions must not force deleting
 *     who decided what, when — these are durable lifecycle objects; decision
 *     fields on those states imply the prior state was APPROVED, because
 *     REJECTED is terminal). The approver is a closed actor union
 *     (Participant or Principal), mirroring {@link AuditSnapshotSchema}'s
 *     `actor`. Since requester and approver are now the SAME actor union
 *     (review 2504 cleanup — the old AccountRef-vs-actor namespace note is
 *     obsolete), the §8.1 different-party rule ("approval is a governed
 *     control in which a DIFFERENT party authorizes") is structurally
 *     checkable and IS checked: an approver deep-equal to the requester does
 *     not parse. Richer separation-of-duty constraints stay deferred (§17.2);
 *     this is only the §8.1 floor.
 *   - `approverEvidence` — the approver's §9 authentication evidence. When the
 *     resolved controls carry an approver requirement, an `APPROVED` state
 *     REQUIRES it (review 2501 High: authority is conferred, so the required
 *     authentication must be evidenced — absence does not parse); on
 *     `REJECTED` it stays optional (a rejection confers no authority, and
 *     demanding MFA to record "no" would make refusing harder than doing
 *     nothing). When present it is rank-checked AND freshness-checked.
 *
 * Fail-closed invariants: (1) `issuedAt <= decisionDeadline`; (2) decision
 * fields required on decided states, forbidden on PENDING/EXPIRED, paired on
 * REVOKED/INVALIDATED (both `approver` and `decidedAt` or neither; evidence
 * only alongside them), and whenever a decision is recorded `issuedAt <=
 * decidedAt <= decisionDeadline` (§10: an expired approval cannot later be
 * approved — a decision timestamped after the deadline does not parse);
 * (3) mode
 * consistency — an Approval exists only where a grant flow exists, so the
 * reviewed effective mode must not be `AUTO` or `DENY` (matching the C1 audit
 * invariant that neither mode yields `APPROVAL_REQUIRED`); (4) the reviewed
 * session snapshot must be `ACTIVE` (an approval is solicited under a live
 * session; §6/§8 end derived authority with the session — ending it
 * INVALIDATES the approval, it does not rewrite the issuance snapshot);
 * (5) `approverEvidence` is REQUIRED when an approver requirement STRONGER
 * THAN `NONE` was resolved and the object records a conferring decision —
 * state `APPROVED`, or `REVOKED`/`INVALIDATED` carrying decision fields
 * (which imply a prior APPROVED) — (review 2502: a resolved
 * `{requirement: "NONE"}` demands nothing, so it must not force evidence),
 * satisfies that requirement's level (§9 rank), and is FRESH relative to the
 * decision (review 2501 High): `authenticationAt <= decidedAt` (evidence from
 * the future did not authenticate this decision) and, when the approver spec
 * carries `maxAgeSeconds`, `decidedAt - authenticationAt <= maxAgeSeconds`.
 */
export const ApprovalSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    approvalId: OpaqueIdSchema,
    state: ApprovalStateSchema,
    requester: z.discriminatedUnion("actorKind", [
      z.object({ actorKind: z.literal("participant"), participant: ParticipantRefSchema }).strict(),
      z.object({ actorKind: z.literal("principal"), principal: PrincipalRefSchema }).strict(),
    ]),
    reviewedScope: ReviewedScopeSchema,
    issuedAtUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    decisionDeadlineUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    approver: z
      .discriminatedUnion("actorKind", [
        z.object({ actorKind: z.literal("participant"), participant: ParticipantRefSchema }).strict(),
        z.object({ actorKind: z.literal("principal"), principal: PrincipalRefSchema }).strict(),
      ])
      .optional(),
    decidedAtUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX).optional(),
    approverEvidence: AuthenticationEvidenceSchema.optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.issuedAtUnixSeconds > a.decisionDeadlineUnixSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "issuedAtUnixSeconds must be <= decisionDeadlineUnixSeconds (§10: an absolute decision deadline)",
        path: ["decisionDeadlineUnixSeconds"],
      });
    }
    const decided = a.state === "APPROVED" || a.state === "REJECTED";
    const postDecision = a.state === "REVOKED" || a.state === "INVALIDATED";
    if (decided && (a.approver === undefined || a.decidedAtUnixSeconds === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${a.state} approval must carry approver and decidedAtUnixSeconds (§10: the decision itself is evidence — an undated or anonymous decision is not one)`,
        path: [a.approver === undefined ? "approver" : "decidedAtUnixSeconds"],
      });
    }
    // PENDING/EXPIRED never recorded a decision (EXPIRED is reachable only
    // from PENDING); REVOKED/INVALIDATED may KEEP one (history-preserving,
    // review 2503) but only as a coherent pair, with evidence only alongside.
    if ((a.state === "PENDING" || a.state === "EXPIRED") && (a.approver !== undefined || a.decidedAtUnixSeconds !== undefined || a.approverEvidence !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${a.state} approval must not carry approver / decidedAt / approverEvidence (§10: no decision was recorded — the machine reaches EXPIRED only from PENDING)`,
        path: [a.approver !== undefined ? "approver" : a.decidedAtUnixSeconds !== undefined ? "decidedAtUnixSeconds" : "approverEvidence"],
      });
    }
    if (postDecision && (a.approver === undefined) !== (a.decidedAtUnixSeconds === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${a.state} approval keeps its decision record whole or not at all (approver and decidedAtUnixSeconds are paired; an unpaired half is a forged history)`,
        path: [a.approver === undefined ? "approver" : "decidedAtUnixSeconds"],
      });
    }
    if (postDecision && a.approverEvidence !== undefined && a.decidedAtUnixSeconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${a.state} approval cannot carry approverEvidence without its decision record (evidence evidences a decision)`,
        path: ["approverEvidence"],
      });
    }
    if ((decided || postDecision) && a.decidedAtUnixSeconds !== undefined) {
      if (a.decidedAtUnixSeconds > a.decisionDeadlineUnixSeconds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "decidedAtUnixSeconds must be <= decisionDeadlineUnixSeconds (§10: an expired approval cannot later be approved)",
          path: ["decidedAtUnixSeconds"],
        });
      }
      if (a.decidedAtUnixSeconds < a.issuedAtUnixSeconds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "decidedAtUnixSeconds must be >= issuedAtUnixSeconds",
          path: ["decidedAtUnixSeconds"],
        });
      }
    }
    // §8.1 floor: the approver is a DIFFERENT party than the requester. Both
    // are the same closed actor union now, so same-kind identity equality is
    // meaningful and fails closed. (Richer SoD stays deferred, §17.2.)
    if (a.approver !== undefined) {
      const sameActor =
        (a.requester.actorKind === "participant" &&
          a.approver.actorKind === "participant" &&
          a.requester.participant.participantId === a.approver.participant.participantId) ||
        (a.requester.actorKind === "principal" &&
          a.approver.actorKind === "principal" &&
          a.requester.principal.principalType === a.approver.principal.principalType &&
          a.requester.principal.principalId === a.approver.principal.principalId);
      if (sameActor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "approver must be a DIFFERENT party than the requester (§8.1: merging them removes the record of who permitted what)",
          path: ["approver"],
        });
      }
    }
    // Mode consistency: an approval exists only where a grant flow exists.
    const mode = a.reviewedScope.resolved.controls.mode;
    if (mode === "AUTO" || mode === "DENY") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `an Approval cannot exist under a reviewed ${mode} mode (§8: AUTO needs no approval step and DENY is absolute — matching the audit rule that neither yields APPROVAL_REQUIRED)`,
        path: ["reviewedScope", "resolved", "controls", "mode"],
      });
    }
    // Issuance-time session liveness: the snapshot is frozen at solicitation.
    if (a.reviewedScope.managedAccessSession.state !== "ACTIVE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "an Approval's reviewed session snapshot must be ACTIVE (§6/§8: it is solicited under a live session; session end INVALIDATES the approval rather than rewriting its issuance snapshot)",
        path: ["reviewedScope", "managedAccessSession", "state"],
      });
    }
    // Approver evidence: REQUIRED to confer authority, rank-checked, and fresh
    // relative to the decision (review 2501 High).
    const approverSpec = a.reviewedScope.resolved.controls.authentication.approver;
    const recordsConferral = a.state === "APPROVED" || (postDecision && a.decidedAtUnixSeconds !== undefined);
    if (
      recordsConferral &&
      approverSpec !== undefined &&
      approverSpec.requirement !== "NONE" &&
      a.approverEvidence === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `an approval recording a conferring decision under a resolved approver requirement (${approverSpec.requirement}) must carry approverEvidence (§9/§10 fail-closed: conferred authority without the required authentication evidence does not parse; decision fields on REVOKED/INVALIDATED imply a prior APPROVED, since REJECTED is terminal)`,
        path: ["approverEvidence"],
      });
    }
    if (a.approverEvidence !== undefined && approverSpec !== undefined) {
      if (authenticationRequirementRank(a.approverEvidence.level) < authenticationRequirementRank(approverSpec.requirement)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `approverEvidence.level ${a.approverEvidence.level} does not satisfy the resolved approver requirement ${approverSpec.requirement} (§9 total order)`,
          path: ["approverEvidence", "level"],
        });
      }
    }
    if (a.approverEvidence !== undefined && a.decidedAtUnixSeconds !== undefined) {
      if (a.approverEvidence.authenticationAtUnixSeconds > a.decidedAtUnixSeconds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "approverEvidence.authenticationAtUnixSeconds must be <= decidedAtUnixSeconds (evidence from after the decision did not authenticate it)",
          path: ["approverEvidence", "authenticationAtUnixSeconds"],
        });
      }
      if (
        approverSpec?.maxAgeSeconds !== undefined &&
        a.decidedAtUnixSeconds - a.approverEvidence.authenticationAtUnixSeconds > approverSpec.maxAgeSeconds
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `approverEvidence is stale at the decision: decidedAt - authenticationAt exceeds the approver freshness window of ${approverSpec.maxAgeSeconds}s (§9: evidence may satisfy only the freshness window for which it was issued)`,
          path: ["approverEvidence", "authenticationAtUnixSeconds"],
        });
      }
    }
  });
export type Approval = z.infer<typeof ApprovalSchema>;

/**
 * Canonical, collision-free key for an Approval, e.g. `approval<US>app-123`.
 * Validates + fails closed (mirrors {@link auditSnapshotKey}).
 */
export function approvalKey(a: Approval): string {
  const v = ApprovalSchema.parse(a);
  return `approval${WORKLOAD_KEY_SEP}${v.approvalId}`;
}

/**
 * Authorization Grant lifecycle states (arch/16 §10): `ACTIVE`, `CONSUMED`
 * (use limit reached — for `SINGLE_USE`, atomically at execution START; a
 * failed single-use execution does NOT silently restore the grant), `EXPIRED`,
 * `REVOKED`, `INVALIDATED` (a §10 invalidation trigger fired). Closed enum.
 */
export const AuthorizationGrantState = ["ACTIVE", "CONSUMED", "EXPIRED", "REVOKED", "INVALIDATED"] as const;
export const AuthorizationGrantStateSchema = z.enum(AuthorizationGrantState);
export type AuthorizationGrantState = (typeof AuthorizationGrantState)[number];

/**
 * An **Authorization Grant** (arch/16 §10): execution authority produced after
 * all required policy, authentication, and approval conditions were satisfied.
 *
 *   - `mode` — the grant-bearing execution mode. `AUTO` needs no grant and
 *     `DENY` confers none (fail-closed below), and the mode must EQUAL the
 *     reviewed effective mode (`reviewedScope.resolved.controls.mode`): a grant
 *     claiming a different mode than its review resolved is a fork.
 *   - `reviewedScope` — the exact scope (§10), the same C1 snapshot an
 *     Approval freezes; every §10 invalidation trigger is detectable against
 *     it. Its session snapshot must be `ACTIVE`: a grant is only ever ISSUED
 *     under a live session (§6/§8); the session ending INVALIDATES the grant —
 *     it does not rewrite the issuance snapshot. For `SESSION_BOUND` the
 *     embedded {@link ManagedAccessSessionBindingSchema} IS the session
 *     binding.
 *   - `expiresAtUnixSeconds` — every grant is time-bounded (§10: a
 *     `TIME_BOUND` grant expires at its deadline; a `SESSION_BOUND` grant also
 *     carries a TTL — §8; a `SINGLE_USE` grant's expiry bounds how long it may
 *     await its one execution).
 *   - `maxUses` / `usedCount` — §10 "deadline or use limit". The use limit is
 *     an OPTIONAL constraint for the reusable modes (review 2501 High: a
 *     `TIME_BOUND` / `SESSION_BOUND` grant may be bounded by time / session
 *     alone, with no finite use count); `SINGLE_USE` ⇒ `maxUses` present and
 *     exactly 1. `usedCount` is always recorded.
 *   - `approvalRef` — the Approval this grant was produced from. REQUIRED per
 *     the approved C2 design (review 2501 High): in this slice a Grant is the
 *     product of the approval workflow — §10's "all required policy,
 *     authentication, and approval conditions" — and a grant that cannot name
 *     its approval breaks the §10 audit chain. Flows that confer execution
 *     authority without any approval object do not mint a Grant on this
 *     contract.
 *   - `retryOf` — §10 retry relation: a failed `SINGLE_USE` execution does not
 *     restore its grant, so an authorized retry is a NEW grant naming the
 *     grant it retries. The invocation-identity binding of the §10 "idempotent
 *     retry credential" lands with the invocation-record contract (later
 *     slice); the grant-to-grant relation is what #60 freezes now.
 *
 * Fail-closed invariants: (1) mode is neither `AUTO` nor `DENY`; (2) mode
 * equals the reviewed effective mode; (3) `SINGLE_USE` ⇒ `maxUses === 1`
 * (present); (4) `usedCount <= maxUses` when a limit exists; (5) `CONSUMED` ⇔
 * a use limit exists and is reached (`usedCount === maxUses`) — BOTH
 * directions enforced (review 2502 Medium): an unlimited grant has nothing to
 * exhaust and never parses as `CONSUMED`, and a limit-reached grant parses
 * ONLY as `CONSUMED` — reaching the final use IS the `CONSUMED` transition
 * (terminal precedence: exhaustion wins; revoking or expiring an
 * already-consumed grant is meaningless because no authority remains), so
 * `EXPIRED`/`REVOKED`/`INVALIDATED` at `usedCount === maxUses` does not
 * parse; an `ACTIVE` grant still has uses left (or no limit);
 * (6) `issuedAt <= expiresAt`;
 * (7) the reviewed session snapshot is `ACTIVE`; (8) `retryOf` never names
 * the grant itself; (9) slice B2 issuance binding (review 2518) —
 * `expiresAt === issuedAt + resolved.effectiveMaxTtlSeconds` (overflow past
 * `Number.MAX_SAFE_INTEGER` fails closed: a clamped expiry is one the
 * resolution never authorized) and `maxUses === resolved.effectiveMaxUses`
 * in BOTH directions (a resolution without a use limit forbids the grant
 * from minting one) — the evaluator decided and froze; issuance only adds.
 */
export const AuthorizationGrantSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    grantId: OpaqueIdSchema,
    state: AuthorizationGrantStateSchema,
    mode: ExecutionAuthorizationModeSchema,
    reviewedScope: ReviewedScopeSchema,
    issuedAtUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    expiresAtUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    maxUses: z.number().int().positive().lte(SAFE_INT_MAX).optional(),
    usedCount: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    approvalRef: z.object({ approvalId: OpaqueIdSchema }).strict(),
    retryOf: z.object({ grantId: OpaqueIdSchema }).strict().optional(),
  })
  .strict()
  .superRefine((g, ctx) => {
    if (g.mode === "AUTO" || g.mode === "DENY") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a Grant cannot exist with mode ${g.mode} (§8: AUTO executes without a grant; DENY confers none)`,
        path: ["mode"],
      });
    }
    if (g.mode !== g.reviewedScope.resolved.controls.mode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `grant mode ${g.mode} must equal the reviewed effective mode ${g.reviewedScope.resolved.controls.mode} (§7.1 fail-closed: a grant claiming a different mode than its review resolved is a fork)`,
        path: ["mode"],
      });
    }
    if (g.mode === "SINGLE_USE" && g.maxUses !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a SINGLE_USE grant has maxUses present and exactly 1 (§8/§10: it is atomically consumed when execution begins)",
        path: ["maxUses"],
      });
    }
    if (g.maxUses !== undefined && g.usedCount > g.maxUses) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "usedCount must be <= maxUses (§10: the use limit bounds consumption)",
        path: ["usedCount"],
      });
    }
    if (g.state === "CONSUMED" && (g.maxUses === undefined || g.usedCount !== g.maxUses)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a CONSUMED grant has a use limit and usedCount === maxUses (§10: CONSUMED is the use limit being reached; an unlimited grant has nothing to exhaust)",
        path: ["usedCount"],
      });
    }
    if (g.state === "ACTIVE" && g.maxUses !== undefined && g.usedCount >= g.maxUses) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an ACTIVE grant has usedCount < maxUses (a fully-used grant is CONSUMED, not ACTIVE)",
        path: ["state"],
      });
    }
    // Reverse direction of invariant (5) (review 2502 Medium): reaching the
    // final use IS the CONSUMED transition, so no other state may be the one
    // recorded at the limit. (The ACTIVE case above already reports with its
    // own message; this covers the remaining terminal states.)
    if (g.state !== "CONSUMED" && g.state !== "ACTIVE" && g.maxUses !== undefined && g.usedCount === g.maxUses) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a grant whose use limit is reached parses only as CONSUMED, not ${g.state} (§10 terminal precedence: exhaustion wins — no authority remains for a later revocation/expiry to remove)`,
        path: ["state"],
      });
    }
    if (g.issuedAtUnixSeconds > g.expiresAtUnixSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "issuedAtUnixSeconds must be <= expiresAtUnixSeconds (§10: every grant is time-bounded)",
        path: ["expiresAtUnixSeconds"],
      });
    }
    if (g.reviewedScope.managedAccessSession.state !== "ACTIVE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a Grant's reviewed session snapshot must be ACTIVE (§6/§8: a grant is only issued under a live session; session end INVALIDATES the grant rather than rewriting its issuance snapshot)",
        path: ["reviewedScope", "managedAccessSession", "state"],
      });
    }
    if (g.retryOf !== undefined && g.retryOf.grantId === g.grantId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "retryOf must name a DIFFERENT grant (§10: retry requires a NEW grant)",
        path: ["retryOf", "grantId"],
      });
    }
    // Review 2518 High 1 (slice B2): issuance is MECHANICAL consumption of the
    // resolved constraints — the evaluator decided and froze, so a grant that
    // deviates from its own resolved result is a schema-valid object with
    // MORE authority than its decision, and must not parse.
    const eff = g.reviewedScope.resolved;
    if (eff.effectiveMaxTtlSeconds !== undefined) {
      const bound = g.issuedAtUnixSeconds + eff.effectiveMaxTtlSeconds;
      if (bound > SAFE_INT_MAX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "issuedAt + resolved.effectiveMaxTtlSeconds exceeds Number.MAX_SAFE_INTEGER — no representable expiry exists for this issuance (fail closed rather than saturate: a clamped expiry would be an expiry the resolution never authorized)",
          path: ["expiresAtUnixSeconds"],
        });
      } else if (g.expiresAtUnixSeconds !== bound) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "expiresAtUnixSeconds must equal issuedAtUnixSeconds + resolved.effectiveMaxTtlSeconds (issuance only does the addition; the TTL decision was frozen at resolution)",
          path: ["expiresAtUnixSeconds"],
        });
      }
    }
    if (eff.effectiveMaxUses !== undefined) {
      if (g.maxUses !== eff.effectiveMaxUses) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "maxUses must equal resolved.effectiveMaxUses (issuance consumes the resolved use limit, never re-decides it)",
          path: ["maxUses"],
        });
      }
    } else if (g.maxUses !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a grant cannot mint a use limit its resolution did not carry (no applicable policy maxUses means no limit to consume)",
        path: ["maxUses"],
      });
    }
  });
export type AuthorizationGrant = z.infer<typeof AuthorizationGrantSchema>;

/**
 * Canonical, collision-free key for an Authorization Grant, e.g.
 * `grant<US>gr-123`. Validates + fails closed (mirrors {@link auditSnapshotKey}).
 */
export function authorizationGrantKey(g: AuthorizationGrant): string {
  const v = AuthorizationGrantSchema.parse(g);
  return `grant${WORKLOAD_KEY_SEP}${v.grantId}`;
}

/**
 * Confirmation Continuation lifecycle states (arch/16 §8.1): `ISSUED` (the
 * only usable state), `CONSUMED` (the confirmed submission was accepted —
 * consumption is atomic and happens on ACCEPTANCE, not success), `EXPIRED`
 * (plain expiry: nothing about authority changed, so re-submission yields
 * `CONFIRMATION_REQUIRED` again), `INVALIDATED` (session end, token revocation
 * or tightening, Device change — the same terms that invalidate a
 * `SESSION_BOUND` grant; ALSO the state of a handle superseded by a §8.1
 * generation rotation, which stays unusable and is never revived). Closed enum.
 */
export const ConfirmationContinuationState = ["ISSUED", "CONSUMED", "EXPIRED", "INVALIDATED"] as const;
export const ConfirmationContinuationStateSchema = z.enum(ConfirmationContinuationState);
export type ConfirmationContinuationState = (typeof ConfirmationContinuationState)[number];

/**
 * A **Confirmation Continuation** (arch/16 §8.1): the Platform-issued,
 * immutable lifecycle object behind a `CONFIRMATION_REQUIRED` outcome. The
 * follow-up submission carries this handle — never a self-declared
 * `confirmed: true` — and the handle binds everything that makes replay,
 * retargeting, or session-outliving impossible:
 *
 *   - `requestId` / `generation` — §8.1 keys the continuation on the FIRST
 *     submission's `requestId`, with the invariant *at most one usable
 *     continuation per requestId at any moment*, maintained by an atomic
 *     generation rotation (compare-and-set on the generation recorded for the
 *     requestId; concurrent recoveries all attempt it, one succeeds, the rest
 *     observe and return the new generation). Each generation is its own
 *     immutable wire object; a superseded generation is `INVALIDATED` and
 *     never revived. The rotation CAS itself is Platform state, not a wire
 *     field.
 *   - `account` + `managedAccessSession` — the full composite session snapshot
 *     ({@link ManagedAccessSessionBindingSchema}), not a bare session id, for
 *     the same authority reason as {@link ReviewedScopeSchema} (a bare id
 *     cannot prove which token revision / Device Instance the handle bound).
 *   - `checkpoint` + `resource` + `parameterDigest` — the exact Checkpoint
 *     version, the normalized Resource, and the parameter digest: a confirmed
 *     submission whose parameters differ does not match its own handle and is
 *     a NEW request needing a NEW confirmation (§8.1).
 *   - `consumedBy` — present IFF `CONSUMED`: the confirmed submission's OWN
 *     `requestId` (§8.1: the confirmed submission is a NEW logical request
 *     with its own requestId and dedupe key — reusing the original would
 *     collide under the same-key-different-digest fail-closed rule) and the
 *     identifier of the **durable acceptance record** that §8.1 requires to
 *     commit IN THE SAME transaction as the consumption and the dedupe
 *     record (#123, branch-aware): the `commandId` of the initial Command
 *     record for a command-producing target, or the `invocationId` of the
 *     post-acceptance invocation record for a platform-internal target,
 *     which never produces a Command on any path.
 *
 * Fail-closed invariants: (1) `issuedAt <= expiresAt`; (2) the snapshot binds
 * THIS account (`managedAccessSession.account === account`); (3) the session
 * snapshot is `ACTIVE` (issuance-time liveness — invalidation is a state
 * transition, not a snapshot rewrite); (4) `consumedBy` presence matches
 * state; (5) `consumedBy.confirmedRequestId !== requestId`; (6) the session
 * snapshot's establishing-authority path is `credential-pair` — the
 * APPROVAL-ONLY round boundary (docs#278 / review 2802): the confirmation
 * COMPLETION wire and runtime are credential-pair-only today, and the
 * generic dual-form MAS binding must not transitively declare a
 * device-authenticated confirmation durable state no runtime can honor.
 * When the confirmation wire goes path-aware in its own coordinated round,
 * this clause is the one line that opens it.
 */
export const ConfirmationContinuationSchema = z
  .object({
    contractVersion: z.literal(CHECKPOINT_CONTRACT_VERSION),
    continuationId: OpaqueIdSchema,
    state: ConfirmationContinuationStateSchema,
    requestId: RequestIdSchema,
    generation: RevisionSchema,
    account: AccountRefSchema,
    managedAccessSession: ManagedAccessSessionBindingSchema,
    checkpoint: CheckpointVersionIdSchema,
    resource: ResourceReferenceSchema,
    parameterDigest: ParameterDigestSchema,
    issuedAtUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    expiresAtUnixSeconds: z.number().int().nonnegative().lte(SAFE_INT_MAX),
    consumedBy: z
      .union([
        z
          .object({
            confirmedRequestId: RequestIdSchema,
            commandId: OpaqueIdSchema,
          })
          .strict(),
        /**
         * #123 (owner Option A, 2026-08-24; arch/16 §8.1 commandless-target
         * amendment): a platform-internal target (the `self.*` family) produces
         * no Command on ANY path — the durable invocation record in its
         * post-acceptance state is the committed member of the §8.1 consume
         * boundary, and the consumption reference names it.
         */
        z
          .object({
            confirmedRequestId: RequestIdSchema,
            invocationId: OpaqueIdSchema,
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.issuedAtUnixSeconds > c.expiresAtUnixSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "issuedAtUnixSeconds must be <= expiresAtUnixSeconds (§8.1: the handle binds an expiry)",
        path: ["expiresAtUnixSeconds"],
      });
    }
    if (c.managedAccessSession.account.accountId !== c.account.accountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "managedAccessSession.account must equal the continuation's account (§8.1 fail-closed: the handle cannot bind a session issued for a different Account)",
        path: ["managedAccessSession", "account"],
      });
    }
    if (c.managedAccessSession.state !== "ACTIVE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a Confirmation Continuation's session snapshot must be ACTIVE (§8.1: it is issued under a live session; session end INVALIDATES the handle rather than rewriting its issuance snapshot)",
        path: ["managedAccessSession", "state"],
      });
    }
    // Approval-only round boundary (docs#278 / review 2802): the shared MAS
    // binding is dual-form, but the confirmation completion wire/runtime is
    // credential-pair-only — a device-authenticated continuation would be a
    // durable state nothing can consume, so it does not parse.
    if (c.managedAccessSession.establishment !== "credential-pair") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a Confirmation Continuation's session must be credential-pair-established (docs#278 approval-only round: the §8.1 confirmation completion wire is not path-aware yet, and a handle no runtime can consume must not exist)",
        path: ["managedAccessSession", "establishment"],
      });
    }
    if (c.state === "CONSUMED" && c.consumedBy === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a CONSUMED continuation must carry consumedBy (§8.1: consumption commits together with the dedupe record, the invocation, AND the durable acceptance record — the Command for a command-producing target, the invocation itself for a platform-internal one)",
        path: ["consumedBy"],
      });
    }
    if (c.state !== "CONSUMED" && c.consumedBy !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${c.state} continuation must not carry consumedBy (§8.1: consumption is the CONSUMED transition)`,
        path: ["consumedBy"],
      });
    }
    if (c.consumedBy !== undefined && c.consumedBy.confirmedRequestId === c.requestId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "consumedBy.confirmedRequestId must differ from the first submission's requestId (§8.1: the confirmed submission is a NEW logical request with its own requestId and dedupe key)",
        path: ["consumedBy", "confirmedRequestId"],
      });
    }
  });
export type ConfirmationContinuation = z.infer<typeof ConfirmationContinuationSchema>;

/**
 * Canonical, collision-free key for a Confirmation Continuation, e.g.
 * `continuation<US>cc-123`. Keyed on the Platform-issued `continuationId` ONLY:
 * a `requestId` is client-supplied free text that may legally contain the
 * U+001F separator, so it must never be embedded in a collision-free key — the
 * §8.1 at-most-one-usable-per-requestId invariant is a Platform runtime
 * invariant over `(requestId, generation)`, not derivable from this key.
 */
export function confirmationContinuationKey(c: ConfirmationContinuation): string {
  const v = ConfirmationContinuationSchema.parse(c);
  return `continuation${WORKLOAD_KEY_SEP}${v.continuationId}`;
}

/* ------------------------------------------------------------------ *
 * C2.b Lifecycle transition machines (arch/16 §10, §8.1; review 2502)
 *
 * The static schemas above freeze what a state MAY LOOK LIKE; these freeze
 * what a state MAY BECOME. Each lifecycle exports its legal-edge table and a
 * pure, deterministic, fail-closed evaluator: given the current state, the
 * requested state, and the minimal temporal/use context, it answers whether
 * that single transition is legal — and if not, exactly why. Everything not
 * explicitly allowed is denied:
 *
 *   - a state is its own non-transition (`NOT_A_TRANSITION`);
 *   - a terminal state has NO outgoing edges — nothing revives (§10:
 *     "An expired or invalidated Approval cannot later be approved", "A
 *     failed single-use execution does not silently restore the grant", a
 *     superseded continuation "stays unusable and is never revived");
 *   - an edge absent from the table is `ILLEGAL_EDGE`;
 *   - expiry-family targets require the bound to have actually passed
 *     (`NOT_YET_EXPIRED`), and completion/decision/consumption targets
 *     require it not to have (`WINDOW_PASSED`) — one clock cannot satisfy
 *     both sides;
 *   - grant consumption requires a use limit (`NO_USE_LIMIT`) and requires
 *     THIS use to be the final one (`NOT_FINAL_USE`): the evaluator judges
 *     the PRE-transition object, so `usedCount === maxUses - 1` is the only
 *     count from which `CONSUMED` is reachable.
 *
 * Each evaluator takes the CURRENT DURABLE OBJECT itself — not a loose
 * `(from, to, guards)` tuple (review 2503 High): the object is re-parsed
 * against its own schema and every guard input (state, expiry, deadline, use
 * counts) is read FROM that parsed object, so a caller cannot pair a real
 * object with fabricated guard data — the guards provably belong to the
 * object being transitioned. The only caller-supplied context is
 * `nowUnixSeconds`: this module never reads a clock.
 *
 * The evaluators are wire-contract validation helpers (deterministic
 * pre/post-condition checks), not runtime behavior: the Platform performs
 * the transition (atomically, per §10); any conformant implementation must
 * agree with these verdicts.
 * ------------------------------------------------------------------ */

/** Why a lifecycle transition was denied. Closed enum. */
export const TransitionDenialReason = [
  "NOT_A_TRANSITION", // from === to: a state is not a transition to itself
  "TERMINAL_STATE", // the current state has no outgoing edges — nothing revives
  "ILLEGAL_EDGE", // the edge is not in the lifecycle's legal-edge table
  "NOT_YET_EXPIRED", // an expiry-family target before its bound has passed
  "WINDOW_PASSED", // a completion/decision/consumption target after its bound
  "NO_USE_LIMIT", // grant CONSUMED without a maxUses — nothing to exhaust
  "NOT_FINAL_USE", // grant CONSUMED from a count that is not the final use
  "EVIDENCE_STALE", // challenge CONSUMED with evidence older than its freshness window
  "EVIDENCE_FUTURE", // challenge CONSUMED with evidence timestamped after `now`
] as const;
export const TransitionDenialReasonSchema = z.enum(TransitionDenialReason);
export type TransitionDenialReason = (typeof TransitionDenialReason)[number];

/**
 * The verdict of a lifecycle transition evaluation: allowed, or denied with
 * exactly one machine-readable reason. Evaluators return the FIRST failing
 * check in the documented order (self, terminal, edge, guards) so a verdict
 * is deterministic for a given input.
 */
export type TransitionVerdict = { allowed: true } | { allowed: false; reason: TransitionDenialReason };

const UnixSecondsSchema = z.number().int().nonnegative().lte(SAFE_INT_MAX);

/** Shared edge-walk: self-transition, terminality, then edge membership. */
function baseTransitionCheck<S extends string>(
  table: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): TransitionVerdict | undefined {
  if (from === to) return { allowed: false, reason: "NOT_A_TRANSITION" };
  const edges = table[from];
  if (edges.length === 0) return { allowed: false, reason: "TERMINAL_STATE" };
  if (!edges.includes(to)) return { allowed: false, reason: "ILLEGAL_EDGE" };
  return undefined;
}

/**
 * Legal Authentication Challenge transitions (§10). `PENDING` may complete,
 * expire, or be revoked; `COMPLETED` evidence may be consumed by its single
 * attachment, or the challenge may still expire or be revoked unattached.
 * `EXPIRED`/`REVOKED`/`CONSUMED` are terminal.
 */
export const CHALLENGE_LEGAL_TRANSITIONS: Readonly<Record<AuthenticationChallengeState, readonly AuthenticationChallengeState[]>> = {
  PENDING: ["COMPLETED", "EXPIRED", "REVOKED"],
  COMPLETED: ["CONSUMED", "EXPIRED", "REVOKED"],
  EXPIRED: [],
  REVOKED: [],
  CONSUMED: [],
};

/**
 * Evaluate one Authentication Challenge transition (§10), FROM the current
 * durable object: the challenge is re-parsed against its schema and the
 * current state and absolute expiry are read from it. Guards beyond the edge
 * table: `EXPIRED` requires the expiry to have passed; `COMPLETED` and
 * `CONSUMED` require it NOT to have (completion after expiry is not a
 * completion, and expired evidence must not attach — the challenge's validity
 * bounds both). `CONSUMED` additionally enforces §9 temporal
 * validity of the evidence itself: evidence timestamped after `now` is
 * `EVIDENCE_FUTURE` unconditionally (a future timestamp cannot prove
 * authentication has already happened — with or without a freshness window),
 * and evidence older than the requirement's `maxAgeSeconds` window is
 * `EVIDENCE_STALE` — both even while the challenge itself is unexpired.
 * `REVOKED` has no temporal guard.
 */
export function evaluateChallengeTransition(
  challenge: AuthenticationChallenge,
  to: AuthenticationChallengeState,
  context: { nowUnixSeconds: number },
): TransitionVerdict {
  const c = AuthenticationChallengeSchema.parse(challenge);
  const t = AuthenticationChallengeStateSchema.parse(to);
  const now = UnixSecondsSchema.parse(context.nowUnixSeconds);
  const expiresAt = c.expiresAtUnixSeconds;
  const base = baseTransitionCheck(CHALLENGE_LEGAL_TRANSITIONS, c.state, t);
  if (base !== undefined) return base;
  if (t === "EXPIRED" && now <= expiresAt) return { allowed: false, reason: "NOT_YET_EXPIRED" };
  if ((t === "COMPLETED" || t === "CONSUMED") && now > expiresAt) return { allowed: false, reason: "WINDOW_PASSED" };
  // §9 temporal validity at CONSUMPTION (reviews 2504/2505 High): the
  // absolute expiry alone is not enough. FIRST, unconditionally, the evidence
  // must not be from the future — `authenticationAt <= now` — because a
  // timestamp after `now` cannot prove that authentication has already
  // happened, with or without a freshness window (the schema's own bound is
  // the challenge window, which may lie ahead of the consuming clock). THEN
  // the maxAgeSeconds window, when declared, rejects stale evidence. Both
  // inputs are read from the parsed object (evidence is schema-guaranteed
  // present on COMPLETED); the consumedBy:grant path has no later evidence
  // to compensate for either failure.
  if (t === "CONSUMED" && c.evidence !== undefined) {
    if (c.evidence.authenticationAtUnixSeconds > now) {
      return { allowed: false, reason: "EVIDENCE_FUTURE" };
    }
    if (
      c.requirement.maxAgeSeconds !== undefined &&
      now - c.evidence.authenticationAtUnixSeconds > c.requirement.maxAgeSeconds
    ) {
      return { allowed: false, reason: "EVIDENCE_STALE" };
    }
  }
  return { allowed: true };
}

/**
 * Legal Approval transitions (§10). `PENDING` may be decided (within the
 * deadline), expire, be revoked, or be invalidated; an `APPROVED` approval
 * remains revocable and invalidatable (§10: a reviewed-scope or
 * revocation-sensitive revision change invalidates the Approval). `REJECTED`,
 * `EXPIRED`, `REVOKED`, `INVALIDATED` are terminal — an expired or
 * invalidated Approval cannot later be approved.
 */
export const APPROVAL_LEGAL_TRANSITIONS: Readonly<Record<ApprovalState, readonly ApprovalState[]>> = {
  PENDING: ["APPROVED", "REJECTED", "EXPIRED", "REVOKED", "INVALIDATED"],
  APPROVED: ["REVOKED", "INVALIDATED"],
  REJECTED: [],
  EXPIRED: [],
  REVOKED: [],
  INVALIDATED: [],
};

/**
 * Evaluate one Approval transition (§10), FROM the current durable object:
 * the approval is re-parsed against its schema and the current state and
 * absolute decision deadline are read from it. Guards beyond the edge table:
 * a decision (`APPROVED`/`REJECTED`) requires the deadline not to have
 * passed; `EXPIRED` requires it to have. `REVOKED`/`INVALIDATED` have no
 * temporal guard (revocation and §10 invalidation triggers are not
 * clock-bound).
 */
export function evaluateApprovalTransition(
  approval: Approval,
  to: ApprovalState,
  context: { nowUnixSeconds: number },
): TransitionVerdict {
  const a = ApprovalSchema.parse(approval);
  const t = ApprovalStateSchema.parse(to);
  const now = UnixSecondsSchema.parse(context.nowUnixSeconds);
  const deadline = a.decisionDeadlineUnixSeconds;
  const base = baseTransitionCheck(APPROVAL_LEGAL_TRANSITIONS, a.state, t);
  if (base !== undefined) return base;
  if (t === "EXPIRED" && now <= deadline) return { allowed: false, reason: "NOT_YET_EXPIRED" };
  if ((t === "APPROVED" || t === "REJECTED") && now > deadline) return { allowed: false, reason: "WINDOW_PASSED" };
  return { allowed: true };
}

/**
 * Legal Authorization Grant transitions (§10). `ACTIVE` may be consumed
 * (reaching its use limit — for `SINGLE_USE`, atomically at execution start),
 * expire, be revoked, or be invalidated. All four end states are terminal: a
 * failed single-use execution does not silently restore the grant; retry is a
 * NEW grant (`retryOf`).
 */
export const GRANT_LEGAL_TRANSITIONS: Readonly<Record<AuthorizationGrantState, readonly AuthorizationGrantState[]>> = {
  ACTIVE: ["CONSUMED", "EXPIRED", "REVOKED", "INVALIDATED"],
  CONSUMED: [],
  EXPIRED: [],
  REVOKED: [],
  INVALIDATED: [],
};

/**
 * Evaluate one Authorization Grant transition (§10). Guards beyond the edge
 * table: `EXPIRED` requires the expiry to have passed; `CONSUMED` requires it
 * NOT to have (a use claimed after expiry is not a use), requires a use limit
 * to exist (`NO_USE_LIMIT`: an unlimited grant has nothing to exhaust), and —
 * judging the PRE-transition object — requires THIS use to be the final one
 * (`NOT_FINAL_USE`: `usedCount === maxUses - 1`; the post-transition object
 * then satisfies the static `usedCount === maxUses` invariant).
 * `REVOKED`/`INVALIDATED` have no guards. The grant is re-parsed against its
 * schema and state/expiry/use counts are read from it, so the static
 * invariants already hold on the input (an ACTIVE pre-state at its limit
 * cannot even be presented — the schema refuses it as anything but
 * `CONSUMED`).
 */
export function evaluateGrantTransition(
  grant: AuthorizationGrant,
  to: AuthorizationGrantState,
  context: { nowUnixSeconds: number },
): TransitionVerdict {
  const g = AuthorizationGrantSchema.parse(grant);
  const t = AuthorizationGrantStateSchema.parse(to);
  const now = UnixSecondsSchema.parse(context.nowUnixSeconds);
  const expiresAt = g.expiresAtUnixSeconds;
  const maxUses = g.maxUses;
  const usedCount = g.usedCount;
  const base = baseTransitionCheck(GRANT_LEGAL_TRANSITIONS, g.state, t);
  if (base !== undefined) return base;
  if (t === "EXPIRED" && now <= expiresAt) return { allowed: false, reason: "NOT_YET_EXPIRED" };
  if (t === "CONSUMED") {
    if (now > expiresAt) return { allowed: false, reason: "WINDOW_PASSED" };
    if (maxUses === undefined) return { allowed: false, reason: "NO_USE_LIMIT" };
    if (usedCount !== maxUses - 1) return { allowed: false, reason: "NOT_FINAL_USE" };
  }
  return { allowed: true };
}

/**
 * Legal Confirmation Continuation transitions (§8.1). `ISSUED` — the only
 * usable state — may be consumed (atomically, when the confirmed request is
 * ACCEPTED), expire, or be invalidated (session end, token revocation or
 * tightening, Device change, or generation rotation superseding it). All
 * three end states are terminal; renewal is a NEW generation minted by the
 * §8.1 rotation CAS, never a revival of this one.
 */
export const CONTINUATION_LEGAL_TRANSITIONS: Readonly<Record<ConfirmationContinuationState, readonly ConfirmationContinuationState[]>> = {
  ISSUED: ["CONSUMED", "EXPIRED", "INVALIDATED"],
  CONSUMED: [],
  EXPIRED: [],
  INVALIDATED: [],
};

/**
 * Evaluate one Confirmation Continuation transition (§8.1). Guards beyond the
 * edge table: `EXPIRED` requires the handle's expiry to have passed;
 * `CONSUMED` requires it not to have (an expired handle can never be
 * consumed). `INVALIDATED` has no temporal guard (its triggers — and
 * generation rotation — are not clock-bound). The continuation is re-parsed
 * against its schema; state and expiry are read from it.
 */
export function evaluateConfirmationContinuationTransition(
  continuation: ConfirmationContinuation,
  to: ConfirmationContinuationState,
  context: { nowUnixSeconds: number },
): TransitionVerdict {
  const c = ConfirmationContinuationSchema.parse(continuation);
  const t = ConfirmationContinuationStateSchema.parse(to);
  const now = UnixSecondsSchema.parse(context.nowUnixSeconds);
  const expiresAt = c.expiresAtUnixSeconds;
  const base = baseTransitionCheck(CONTINUATION_LEGAL_TRANSITIONS, c.state, t);
  if (base !== undefined) return base;
  if (t === "EXPIRED" && now <= expiresAt) return { allowed: false, reason: "NOT_YET_EXPIRED" };
  if (t === "CONSUMED" && now > expiresAt) return { allowed: false, reason: "WINDOW_PASSED" };
  return { allowed: true };
}

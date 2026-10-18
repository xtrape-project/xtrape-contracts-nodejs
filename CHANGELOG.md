# Changelog

All notable changes to `@xtrape/contracts` are documented in this file. Historical entries retain the package names that were current for those releases.

This project follows semantic versioning. Pre-`v1.0.0` minors may include breaking changes; pin matching minor versions across CE, the Connector SDK, and this package.

## Unreleased

## [0.8.17] — 2026-09-07

### Added (BREAKING within the pre-freeze v1 train) — the candidate exchange's parameter slot (runtime-platform/13 v0.5 §4.2/§4.3; #144)

- `CheckpointReviewFace.candidateParameter?`: the NAME of the top-level execution `inputSchema` property the §4.3 candidate exchange fills — any JSON Schema property name (a non-empty JSON string, no lexical restriction; the Platform verifies at Checkpoint admission that it is a declared top-level property of the execution schema). The Platform re-normalizes each submitted candidate as `{ ...reviewInput, [candidateParameter]: candidate }` under the execution face's admitted normalization profile and Resource extractor, intersects with the session's effective authorization, and admits an added `enum` in `next.inputSchema` only on this property and only from what it returned. Absent = the review runs no exchange (unchanged behaviour: an added enum is refused). Part of the immutable version.
- **BREAKING within the pre-freeze v1 train** (review 3198): `CheckpointReviewFaceSchema` is strict, so a 0.8.16 reader REJECTS a definition carrying `candidateParameter`. `CHECKPOINT_CONTRACT_VERSION` stays 1 under the pre-freeze rule; every consumer that reads two-phase definitions (platform-ce, connector, Widgets, Panel/Exposure projections) moves to 0.8.17 in the same round — a definition with the field must not be published to a Platform still on 0.8.16.

## [0.8.16] — 2026-09-06

### Added — the review face of a two-phase Checkpoint (xtrape-docs#288 / runtime-platform/13 v0.4; #141)

- `CheckpointDefinition.review?` (`CheckpointReviewFaceSchema`, strict): `inputSchema` (SchemaRef, a subset of the execution schema's properties), `resource` (ResourceExtractionSpec — Service-rooted or over the review input), `outputSchema` (SchemaRef, what `next.currentState` may contain), `risk`, `affinity` (`CheckpointReviewAffinity` = `INCARNATION | NONE`). Absence = single-phase (the `confirmation` precedent; `CHECKPOINT_CONTRACT_VERSION` unchanged). Part of the immutable version.
- `ReviewNextSchema` / `ReviewCommandResultSchema`: the contracts-fixed envelope a REVIEW command answers with — `result = { next: { inputSchema, initialPayload, currentState } }`, strict at both levels.
- **`DeliveredCommand.operation = EXECUTE | REVIEW`** (BREAKING within the pre-freeze v1 train): `REVIEW` — the read-only review step of a two-phase Checkpoint, answered with `ReviewCommandResultSchema` and no side effect — REPLACES the former `PREPARE` arm (never emitted by any Platform, dropped by every Connector). A Connector built against the old union fails closed on `REVIEW` (runtime-platform/13 §9). Types `DeliveredReviewCommand` / `DeliveredExecuteCommand`.
- `CandidateResourceFilterExchangeSchema`: the exchange validator — same command, `admitted ⊆ candidates`, no duplicates on either side.
- `CandidateResourceFilterRequestSchema` / `CandidateResourceFilterResponseSchema`: the arch/16 §8.1 candidate exchange run inside a review command (Service submits candidates; Platform answers the admitted subset).


## [0.8.15] — 未发布

### Changed (BREAKING within the pre-freeze v1 train — establishing-authority dual form, docs#278)

- `ManagedAccessSessionSchema`, `ManagedAccessSessionBindingSchema` and
  `ReviewedScopeSchema` are now discriminated unions on an explicit
  `establishment` field (arch/16 §6.1): `credential-pair` keeps the exact
  pre-dual-form field set (Account Token id+revision, Device Workload
  Identity + credentialRevision, all existing invariants), while
  `device-authenticated` carries the `authenticationContext` reference as
  the establishing authority (an immutable generation identity — §6.1
  rule 5) plus the `deviceInstance`, and REJECTS any present token field
  (`z.never()`). An absent `establishment` parses as `credential-pair`
  (canonical defaulting — existing documents are unchanged bytes), but the
  parse OUTPUT always carries the discriminator explicitly, so canonical
  (JCS) serializations of parsed credential-pair scopes — and therefore
  newly computed scope digests — change. Historical digests in immutable
  decision records stay as recorded (no historical debt pre-0.9.x).
- New fail-closed invariants: the scope and its embedded session snapshot
  must agree on `establishment` (a cross-path binding is a fork), and on the
  device-authenticated path an authentication-generation substitution under
  the same `sessionId` is rejected exactly as a token/revision substitution
  is on the credential-pair path.
- Approval-only round boundary (review 2802): `ConfirmationContinuationSchema`
  REJECTS a session snapshot whose `establishment` is not `credential-pair` —
  the shared dual-form MAS binding must not transitively declare a
  device-authenticated confirmation durable state while the §8.1 confirmation
  completion wire/runtime is credential-pair-only. Approval and Grant carry
  device-authenticated scopes; the continuation does not, until its own
  coordinated path-aware round.

### Added

- `ManagedAccessSessionEstablishment` / `ManagedAccessSessionEstablishmentSchema`
  — the closed two-value establishment vocabulary (`credential-pair`,
  `device-authenticated`); one authority model, two establishment paths, no
  third form.

## [0.8.14] — 2026-08-27

### Changed (BREAKING within the pre-freeze v1 train — accepted-input narrowing)

- `ServiceManifestSchema`'s top level is `.passthrough()`, so a payload
  carrying an arbitrary `build` object (e.g. `{"build":{"vendor":"foo"}}`)
  used to parse as an unknown extra key. `build` is now a KNOWN `.strict()`
  field, so the same payload fails validation unless it matches
  `{artifactDigest: "sha256:<64 lowercase hex>"}` exactly. This is an
  accepted-input narrowing, not a purely additive field; recorded here per
  the #121 in-place-evolution regime (no `CE_CONTRACT_VERSION` bump — the
  0.8.x train is unfrozen and all consumers are coordinated in this
  instance).

### Added

- `ServiceManifestSchema.build` — optional self-reported build identity
  (`build.artifactDigest`, `sha256:<64 hex>`, strict object): the content
  digest of the code the Worker runs, computed at startup with the same
  canonical-manifest construction the Platform applies to itself. Round-1
  trust level is self-reported (owner ruling on platform-ce#253; arch/16
  §17.1 item 10); the recorded evolution (self-reported → asset-library
  issuance → anchor) replaces the trust source, never this shape. Optional
  on the wire; the Platform refuses to ADMIT a GOVERNED registration that
  omits it, so for governed Widgets it is effectively required.

## 0.8.13 — 2026-08-25

### Changed (BREAKING within the pre-freeze v1 train — coordinated in-place evolution, #121 regime)

- **Logical Service identity on the CE wire is kebab-only; the legacy `svc_*`
  constraint is retired** (contracts-nodejs#128; docs#228 D6, maintainer-
  ratified 2026-08-03). Every CE-wire field that MEANS the logical Service id —
  `CommandSchema.serviceId`, `ActionDefinitionSchema.serviceId`,
  `HealthReportSchema.serviceId`, `ConfigItemSchema.serviceId`,
  `ConnectorHeartbeatRequestSchema.serviceId`,
  `BusEventEnvelopeSchema.sourceServiceId` — now uses the same shared
  declarative kebab rule as the Checkpoint identity (newly exported as
  `LogicalServiceIdSchema` from the checkpoint module) and REJECTS `svc_*`.
  Singular correction, no dual-accept transition (the D6 compatibility ruling:
  no historical-debt obligations before the 0.9.x cleanup + second OSS
  release). System-minted opaque ids (`cmd_` / `agt_` / `act_` / `hlr_` /
  `cfg_` …) keep their prefixes — prefixes belong only to minted ids, never to
  declarative logical names.
- **`CheckpointDefinition` carries the Checkpoint↔Action edge: required
  `action: { actionId, capabilityId? }`** (contracts-nodejs#127; docs#228
  D1–D5, maintainer-ratified 2026-08-03). The immutable definition the
  publishing Service already authors names the ONE Action it governs — no
  third binding authority, publication stays atomic, and the frozen
  one-Checkpoint-version→one-Action rule becomes checkable at admission.
  `actionId` uses the current Action-name semantic (case-sensitive);
  `capabilityId` is declared now but optional until docs#199 completes the
  Capability identity wire (filling it later is a value change, not a second
  strict-surface change). Action identity is an implementation binding, never
  authorization authority; the reference carries no serviceId (the logical
  Service identity is `id.serviceId` alone). D5 lifecycle: a later
  disappearance of the referenced Action does not mutate/withdraw the
  Checkpoint — invocation becomes UNDISPATCHABLE (distinct from UNAUTHORIZED
  and from policy denial); the live Action catalog is dispatchability
  evidence, never the semantic authority. The self exception is ENCODED IN
  THE STRUCTURE: a PLATFORM-INTERNAL Checkpoint (`id.serviceId` equal to
  the newly exported `PLATFORM_INTERNAL_SERVICE_ID`, "self") executes
  in-process and MUST NOT carry the reference; every OTHER definition is
  Service-published and MUST carry it — the schema enforces both
  directions, so "a Service Checkpoint without an edge" is not expressible
  on the wire (D1 atomicity holds at the contract, and again at Platform
  admission, where the arch/19 §3.1 catalogue resolution runs). A
  strict consumer built against 0.8.12 rejects definitions carrying the new
  field — recorded per the #121 pre-freeze regime (the D2 "not additive"
  ruling is honored by this BREAKING record; the version literal moves only
  under the post-freeze regime).

## 0.8.12 — 2026-08-24

### Added (wire-additive)

- **Round-1 static Resource-extractor contract** (contracts-nodejs#130; the
  mechanical encoding of xtrape-docs#266 N1–N5, APPROVED after four design
  review rounds + two rounds here): new `extraction` module with the
  `application/vnd.xtrape.static-resource-extractor.v1+json` media type, the
  frozen round-1 limits (Unicode-scalar-value units; `maxEvaluationSteps` 128
  per the docs#266 amendment), the shared bounded RFC 6901 pointer
  parser/tokenizer (`parseStaticExtractorPointer` — ill-formed Unicode
  fail-closed, `-` token rejected, empty pointer RFC-valid), the strict/closed
  artifact grammar v1 (`StaticResourceExtractorArtifactSchema`, reusing the
  `ResourceSegmentSchema` field schemas by reference), the five deterministic
  extraction failure codes plus the operational `evaluation-aborted` constant,
  and the `StaticExecutionProfileRecordSchema` v1 record family (structure
  only — family membership is a Platform admission check; every field literal-
  frozen except `parameterNormalizationProfile`).
- **Shared conformance vectors** (`STATIC_EXTRACTOR_CONFORMANCE_VECTORS`,
  23 vectors): success expectations carry the complete strict v1
  `ResourceReference`; admission rejections and the two-phase
  grammar/`evaluationBulwark` pair are modeled explicitly. Both consumers —
  the platform interpreter (platform-ce#206/#207) and Connector-SDK/widget
  authoring — run this one suite in CI. No existing export changed.

## 0.8.11 — 2026-08-24

### Changed (BREAKING within the pre-freeze v1 train — coordinated in-place evolution, #121 regime)

- **`AccountTokenClaims` gains the three narrow-only scope axes** (#117; owner-
  ruled B3, from the platform-ce#212 spec review): optional `allowedServices`
  (logical Service ids, strict-ascending canonical wire order), optional
  `allowedCheckpoints` (**BARE** logical checkpointIds, dot-delimited kebab, no
  version — the round-1 semantics the Platform's discovery already enforces),
  and optional `riskCeiling` (`RiskLevel`). Absence = unlimited on that axis.
  `isTightening` extends over all three: absent→present narrows, present→absent
  (a return to unlimited) is refused, a present list may only shrink, a present
  ceiling may only lower (`riskRank`). `resourceSelectors` is deliberately NOT
  promoted (stored-only, uninterpreted — recorded on #117). A strict consumer
  built against 0.8.10 rejects claims documents carrying the new fields.
- **`AuthenticationChallenge.consumedBy` gains the `invocation` branch and the
  optional `windowPolicyProvenance` slot** (#123, owner Option A 2026-08-24;
  arch/16 §8.1 commandless-target amendment, docs#260): a requester challenge
  is accepted by the invocation it re-authorizes (no Approval/Grant exists on
  that path). The consumer branch is PAIRED with subject/scope (review 2614):
  requester ⇒ `invocation` consumer naming the scope's own invocationId;
  approver ⇒ `approval`/`grant` only, an approval attachment naming the
  scope's own approvalId — anything else is forged provenance and does not
  parse. `policyProvenance` names the effective LEVEL's actual
  contributor, and `windowPolicyProvenance` names the freshness window's
  contributor when a DIFFERENT policy tightened it (must differ from the level
  source, requires a window to attribute — both fail-closed refinements).
- **`ConfirmationContinuation.consumedBy` becomes a closed two-branch union**
  (#123, same ruling): `{confirmedRequestId, commandId}` for command-producing
  targets (unchanged bytes), `{confirmedRequestId, invocationId}` for
  platform-internal targets, whose §8.1 committed member is the durable
  invocation record. The confirmed-request-must-differ rule applies to both.

### Documentation

- **`checkpoint.ts` header states both change regimes** (#121): the pre-freeze
  posture the 0.8.x train actually follows (coordinated in-place v1 evolution,
  BREAKING recorded per release, consumers ride the train) and the post-freeze
  rule (bump `CHECKPOINT_CONTRACT_VERSION` or negotiate capabilities for any
  change a strict v1 consumer would reject), effective from the 0.9 wire-freeze
  release. Ruled on #121 (comment #18441): **the freeze itself does not bump
  the constant** — `contractVersion` names wire semantics, not frozen-ness;
  0.9 freezes at `1` unless an incompatible wire change lands in that
  release, and the first strict-rejectable change after the freeze is what
  moves `1 → 2` (or is negotiated). No wire change.

## 0.8.10 — 2026-08-21

### Changed

- **`ChannelBinding.deviceId` accepts Platform-minted Device handles** (#118;
  platform-ce#215 implementation finding). The private `DeviceIdSchema`
  pattern is now `^[a-z0-9][a-z0-9_-]{7,127}$` — underscore allowed, 128-char
  upper bound added. The Platform has minted Device ids as `dev_` + 32 hex
  since platform-ce#148; a claims document naming one could not parse under
  the hyphen-only pattern, so no governed Account Token bound to a Device could
  ever have had valid claims. Wire-widening for this one field (a strict v1
  consumer that previously rejected such ids now accepts them); same-train
  consumers (pre-0.9.x posture).

## 0.8.9 — 2026-08-21

### Added

- **Checkpoint slice B2 — the §17.2 landing items that had not landed**
  (platform-ce#113 plan A1-v2..v4; PR #115). `SystemExposureRuleSchema` (§5
  minimal baseline: deny-by-default exposure — no rule → not exposed; targets
  via the shared `BindingTarget`, optional canonical `deviceTypes`/`accounts`
  narrowing, optional Resource bound, MINIMUM `controls`, `riskCeiling`, the
  §7.1 revision discipline; approval/SoD, audit level, routing modes and org
  scopes stay deferred) and `AccountEntitlementSchema` (§2/§7 minimal
  baseline: the per-Account MAXIMUM Checkpoint/Resource set — no rows,
  nothing entitled; optional tightening controls), each with a revision-scoped
  `*Key` helper. Grant-lifetime and use-count carriers:
  `ControlRequirements.maxTtlSeconds` (RELATIVE TTL — a policy predates every
  invocation, so the absolute expiry materializes exactly once, at Grant
  issuance) and `ControlRequirements.maxUses`; resolved effectives
  `ResolvedAuthorization.effectiveMaxTtlSeconds` (REQUIRED for every
  grant-minting mode; the SINGLE_USE no-policy-TTL default is frozen at
  RESOLUTION from a versioned Platform lifetime profile, named by the new
  `ttlProvenance` union — never a deploy-time read at issuance) and
  `effectiveMaxUses` (SINGLE_USE ⇒ exactly 1, frozen from the mode
  invariant so the resolved result and the C2 Grant can never disagree; a
  reusable-mode use limit needs a policy source — `controls.maxUses` absent ⇔
  `effectiveMaxUses` absent). Provenance is now a CLOSED per-layer union
  (review 2518): `ResolvedContributionSchema` =
  `PolicyBindingContribution | SystemExposureRuleContribution |
  AccountEntitlementContribution`, each branch carrying its exact identity,
  revision, `revisionClass`, and `invalidateDerivedAuthority` — so
  exposure/entitlement layers enter both the "why is the final constraint
  this value" reconstruction and the no-lost-invalidation computation;
  canonical ascending order by `contributionOrderKey` (layer, then identity);
  the exposure-rule and entitlement branches freeze the exact `groupRef` +
  `groupRevision` when resolved through a Checkpoint Group. Deny-by-absence
  is expressible without forging provenance (review 2519):
  `ResolutionBlockerSchema` names the deny-by-default axis whose emptiness
  denied (`system-exposure: no-matching-rule` / `account-entitlement:
  no-matching-row`), and the two deny-by-default axes are MANDATORY
  intersection terms enforced PER AXIS (review 2520): every resolution needs
  a system-exposure-rule contribution XOR the system-exposure blocker, and an
  account-entitlement contribution XOR the entitlement blocker — omitting an
  axis both ways (an authority-widening hole) or claiming both ways ("one
  axis, one truth") does not parse; blockers force an effective `DENY` — a
  fresh deployment's empty baseline yields a schema-valid, auditable DENY
  with zero fabricated sources. Every contribution branch carries a REQUIRED
  `resolvedThrough` closed union (`direct` | `group{groupRef,groupRevision}`)
  replacing the optional `group` — the group path can no longer silently
  drop its exact revision; the §7.1 freeze is a contract guarantee, not
  producer discipline.
  The C2 `AuthorizationGrant` is now MECHANICALLY bound to its resolution:
  `expiresAt === issuedAt + resolved.effectiveMaxTtlSeconds` (overflow past
  `Number.MAX_SAFE_INTEGER` fails closed rather than saturating) and
  `maxUses === resolved.effectiveMaxUses` in both directions (a resolution
  without a use limit forbids the grant from minting one) — the evaluator
  decided and froze; issuance only adds.

### Changed

- **BREAKING (strict-v1 surface; coordinated in-tree evolution)** —
  `ControlRequirements` now REQUIRES `maxTtlSeconds` for
  `TIME_BOUND`/`SESSION_BOUND` and forbids the new carriers on `AUTO`/`DENY`;
  `ResolvedAuthorization` REQUIRES `effectiveMaxTtlSeconds` + `ttlProvenance`
  for grant-minting modes and `effectiveMaxUses === 1` for `SINGLE_USE`;
  contributions now carry a `layer` discriminator
  (`ResolvedPolicyContribution*` exports are renamed to
  `PolicyBindingContribution*`, no alias); `AuthorizationGrant` documents
  that deviate from their resolved TTL/use limits no longer parse. Pre-B2
  documents for those modes no longer parse; consumers ride the same train
  (pre-0.9.x posture).

## 0.8.8 — 2026-08-20

### Changed

- **BREAKING (source-level rename, wire bytes unchanged) — the exposure
  module is now the checkpoint module** (#112; naming ruling xtrape-docs#259).
  `src/exposure.ts` → `src/checkpoint.ts` and `EXPOSURE_CONTRACT_VERSION` →
  `CHECKPOINT_CONTRACT_VERSION`, with **no alias** (docs#199 D11 precedent;
  pre-0.9.x posture — both consumers, `xtrape-platform-ce` and
  `xtrape-exposure`, follow in the same release train). Bare "Exposure" now
  names the projection layer (the `xtrape-exposure` Device adapter);
  "Controlled Exposure" remains the arch/16 design title; the module is named
  after its anchor object. The wire is untouched: the wire field is
  `contractVersion: 1` (a number), verified two ways in the PR — the module's
  source string/template literal multiset is unchanged (529 literals,
  escape-aware comment-skipping scanner), and a normalized-source equivalence
  check (comments stripped, whitespace collapsed, the version-constant rename
  the ONLY allowed identifier substitution) shows the remaining
  executable/schema text byte-identical before/after. The originally planned
  dist-level literal diff is NOT usable for this change and was not relied on:
  renaming the entry file reshuffles bundler-internal identifiers.

### Added

- **Exposure part 2 slice C2 — §10 durable workflow objects + §8.1 confirmation
  control** (#60, PR #111; canonical arch/16 §8.1/§10/§17.2). New top-level
  wire documents in the exposure module: `AuthenticationChallengeSchema`
  (5-state lifecycle; fail-closed evidence coherence — produced by THIS
  challenge, on THIS Device Instance, satisfying the §9 level, inside the
  issue window; every attachment consumes — §10's reusable-evidence carve-out
  stays unrepresentable until a machine-verifiable policy field exists),
  `ApprovalSchema` (single-stage, 6 states; explicit `requester` as an ACTOR
  union — Participant or Principal, like `approver`; `APPROVED` under a
  resolved approver requirement stronger than `NONE` REQUIRES approver
  evidence, rank- and freshness-checked against `decidedAtUnixSeconds`;
  decisions outside `[issuedAt, decisionDeadline]` do not parse;
  SoD/multi-stage deferred per §17.2), `AuthorizationGrantSchema`
  (5 states; mode equals the reviewed effective mode, never `AUTO`/`DENY`;
  REQUIRED `approvalRef`; `maxUses` optional for reusable modes and exactly 1
  for `SINGLE_USE`; `CONSUMED` ⇔ a use limit is reached — both directions,
  exhaustion takes precedence over other terminal states), and
  `ConfirmationContinuationSchema` (4 states; keyed on the first submission's
  `requestId` + rotation `generation`; binds account, full session snapshot,
  exact Checkpoint version, normalized Resource, parameter digest, expiry;
  `consumedBy` carries the confirmed submission's OWN `requestId` + the
  transactionally-committed `commandId`). An `AuthenticationChallenge` cannot
  require `NONE` (a challenge exists to prove a required confirmation), and an
  `AuthenticationRequirementSpec` of `NONE` cannot carry `maxAgeSeconds` (a
  freshness window over nothing). Lifecycle objects are history-preserving:
  a challenge that completed and then expired/was revoked keeps its evidence,
  and an approval revoked/invalidated after APPROVED keeps its (paired,
  evidenced) decision record. A challenge's approver subject spans the FULL
  Approval actor domain (Participant or Principal), and the §8.1 floor is
  structural: an approver deep-equal to the requester does not parse (richer
  SoD stays deferred). Challenge consumption enforces §9 temporal validity of the evidence
  itself even while the challenge is unexpired: future-dated evidence is
  rejected unconditionally (`EVIDENCE_FUTURE` — a timestamp after `now`
  cannot prove authentication already happened, window or no window) and
  evidence beyond the declared `maxAgeSeconds` is `EVIDENCE_STALE`. Plus
  `*Key` helpers, the
  state/`ConfirmationRequirement` enums, and the four **lifecycle transition
  machines**: exported legal-edge tables (`CHALLENGE_LEGAL_TRANSITIONS`,
  `APPROVAL_LEGAL_TRANSITIONS`, `GRANT_LEGAL_TRANSITIONS`,
  `CONTINUATION_LEGAL_TRANSITIONS`) and pure fail-closed **object-aware**
  evaluators (`evaluateChallengeTransition(challenge, to, {nowUnixSeconds})`
  and siblings): each takes the current durable object, re-parses it against
  its own schema, and reads every guard input (state, expiry, deadline, use
  counts) from the parsed object — fabricated guard data has no entry point.
  Verdicts are a `TransitionVerdict` with a closed `TransitionDenialReason` —
  terminal states have no outgoing edges, expiry-family targets require their
  bound passed, decision/completion/consumption targets require it not
  passed, and grant consumption requires an existing use limit and the final
  use.

### Changed

- **BREAKING (strict-v1 surface; coordinated in-tree evolution)** — the
  exposure module's closed surfaces grew: `CheckpointDefinition` gains an
  optional `confirmation` axis and `ControlRequirements` an optional
  `requireConfirmation` (absence = not required on both; effective = stricter
  of the two); `Decision` gains the `CONFIRMATION_REQUIRED` branch and
  `DecisionOutcome` / `DecisionReasonCode` gain `CONFIRMATION_REQUIRED` /
  `CHALLENGE_CONFIRMATION`. A strict pre-C2 consumer rejects documents using
  the new members; all consumers are in-workspace and ride the same release
  train (pre-0.9.x posture).

## 0.8.7 — 2026-08-18

### Added

- **`CommandOrigin` on delivered commands** (#256 design: xtrape-docs
  runtime-platform/12). `DeliveredActionCommandFields.origin?` carries the
  authenticated Account context a command was issued under —
  `{ account?, traceId? }`, strict — where `account` is ONE namespace: the
  canonical Account (Participant) id, never a principal/instance/client id
  or a component name. There is deliberately no class field: the Account
  taxonomy is undecided and the canonical `PrincipalType` is an
  invocation-relative Originator vocabulary, not an Account class (an
  Account-class enum, if ever wanted, arrives separately named). Missing or
  malformed reads as `{}`. It is filled by the Platform at delivery time
  only; `CommandDispatchRequest` stays strict and refuses it. Optional on
  the wire, but optional is not compatibility: a pre-#256 strict consumer
  would refuse the whole delivery on the unknown key, so the Platform sends
  it ONLY when the routed Worker instance's manifest declares
  `features.commandOrigin` (`COMMAND_ORIGIN_FEATURE`) — consumers accept
  before the producer sends. World B (Platform dials the Connector) carries
  it on the Platform-set `x-xtrape-command-origin` header
  (`COMMAND_ORIGIN_HEADER`), since that dial body is the strict dispatch
  request. Two consumers: platform-ce (fills) and `@xtrape/connector`
  (exposes on the execute context).

## 0.8.6 — 2026-08-09

### Changed

- **BREAKING — `timeoutSeconds` on delivered commands is now OPTIONAL, and it
  is disclosure only** (#106, design contracts#14, canonical xtrape-docs#242).
  `DeliveredActionCommandFields.timeoutSeconds` goes required → optional
  inside a `.strict()` union, so a pre-#14 consumer's parse FAILS the moment
  a dispatch omits the field — a deliberate one-time break, accepted by the
  owner on contracts#14 (2026-08-09) with no accepts-both intermediate state.
  The frozen semantics: elapsed time never terminalizes or adjudicates a
  command, on any side; the value is reminder metadata that neither the
  Platform nor a generic Connector synthesizes, clamps, or enforces.
  `CommandFailureReason.TIMEOUT` STAYS, re-scoped: a bound the reporter
  itself declared elapsed — never a Platform judgment. This supersedes the
  0.7.4 "required and server-clamped" and 0.7.3 "server-enforced" wording
  below, which are left as written as historical record. Conformance:
  `delivery-command-missing-timeout.invalid.json` is now
  `delivery-command-without-timeout.valid.json`.

### Removed

- **BREAKING — pre-CE legacy `Worker*` surface deleted** (#99, canonical
  xtrape-docs#199 **D10/D11**, prerequisite xtrape-docs#200 merged as `996d84f`).
  27 exports plus one enum member are gone outright, with **no `@deprecated`
  aliases and no removal window**: `WorkerStatus` (const/type) /
  `WorkerStatusSchema`; `WorkerManifest*`; `ReportedWorker*`;
  `WorkerRuntimeReport*`; `WorkerReportRequest*`; `WorkerInstance*`; the old
  `Worker` / `WorkerSchema` / `workerSchema` shorthand; `WorkerInstanceDetail*`;
  `WorkerDetail*`; and `ErrorCode.WORKER_CODE_TAKEN`.
  **Final disposition of that error code:** the `ErrorCode.WORKER_CODE_TAKEN`
  member is gone from the package; its wire VALUE
  `"CAPSULE_SERVICE_CODE_TAKEN"` is retained ONLY as a historical record in
  `spec/errors.json`, `spec/errors.md` and
  `spec/worker-compatibility-v0.4.json`. `ErrorCode.X` no longer resolves for
  it. This supersedes the 0.7.6 entry below, which recorded the property as
  current at that time; that entry is left as written.
  Rationale: that face misused the canonical name **Worker** for Service and
  ServiceInstance records (`WorkerInstance.id` carried the `svc_` prefix), and
  both of its route faces (`/api/agents/*` and `/api/admin/workers/*`) are gone
  from `xtrape-platform-ce`. Verified zero consumers across eight repositories.
- **BREAKING — 24 `Agent*` compatibility aliases deleted** (#99, docs#199 D11;
  they were introduced by #93/#94). `AgentStatus*`, `AgentMode*`, `AgentSchema`,
  `Agent`, `RegisterAgent*`, `WorldARegisterAgent*`, `AgentHeartbeat*`,
  `WorldAAgentHeartbeat*`, `agentHeartbeatRequestSchema`, and the `./ce`
  `AgentHeartbeatSchema` / `AgentHeartbeat`. Use the `Connector*` primaries.
  `agent` remains too broad a word to keep frozen into the export surface.
- **BREAKING — `ConnectorMode` removed entirely, AND PARSE RESULTS NARROW**
  (#99, docs#199 D2): `ConnectorMode`, `ConnectorModeSchema`, the `mode` field
  of `ConnectorSchema` and of `RegisterConnectorRequestSchema.agent`, and the
  `agentMode` manifest field. There is no ophub mode any more — every Widget
  deploys independently — so the concept, not one of its values, is gone.
  **This is NOT in the same class as the wire-neutral `ServiceInstance` ->
  `Worker` rename below.** The registration wrapper is not `strict`, so an
  inbound `mode` is **tolerated but STRIPPED** rather than rejected: senders do
  not break, but `parse(...).agent.mode` is now `undefined`. Readers of
  `.mode` must be audited. Pinned by `tests/schema-validation.spec.ts`.
- `tests/worker-compatibility.spec.ts` and `tests/connector-alias.spec.ts`
  (they guarded the deleted surfaces). The surviving `BusErrorCode.BUS_DISABLED`
  wire-value pin moved to `tests/bus.spec.ts`.

### Changed

- **BREAKING — `ServiceInstance` renamed to `Worker`** (#99, docs#199 **D13**):
  `ServiceInstanceSchema` -> `WorkerSchema`, `ServiceInstance` -> `Worker`,
  `ServiceInstanceHealth` -> `WorkerHealth`, `ServiceInstanceHealthSchema` ->
  `WorkerHealthSchema`. The entity that registers IS the Worker; a Service is
  the logical grouping the Platform creates when the first Worker completes
  registration, and "Service Instance" is not a separate entity.
  **Symbol-level only — every wire byte is unchanged**: `instanceId`, the
  `instance` key of `CeRegistrationRequestSchema`, and the exposure face's
  `serviceInstanceRef` all keep their names. Field set, requiredness, defaults
  and enum values are identical, and `CE_CONTRACT_VERSION` stays `1`. Renaming
  those keys is a `contractVersion` migration and is deliberately deferred.
- **BREAKING AND SILENT — `Worker` / `WorkerSchema` were REBOUND.** Those two
  names existed before #99 as the pre-CE legacy shorthand for `WorkerInstance`
  (an `svc_`-keyed Service record). #99 deleted that binding and gave the same
  two names to the CE runtime entity above. Because the names never leave the
  export surface, **an old consumer gets no missing-export error** — it
  type-checks against a completely different schema and fails at runtime on the
  first `.parse()`. Every other symbol deleted by #99 fails loudly at compile
  time; these two do not. **A successful build after upgrading does not mean the
  call site is still correct.**
- `README.md` and `package.json` (`description`, `keywords`) no longer advertise
  a supported Worker wire surface.

### Not changed *(by #99 itself — this subsection is #99's own scope statement.
Elsewhere in this SAME 0.8.6 release, #106 changes two `spec/ce` fixtures and
slice C1 adds to `src/exposure.ts`; see those entries.)*

- `spec/` is byte-identical **as far as #99 goes**: `spec/worker-compatibility-v0.4.json`,
  `spec/openapi/*`, `spec/enums/*` and `spec/errors.*` remain frozen historical
  records. Retiring them is tracked separately and is not part of #99.
  Consequence: the wire value `"CAPSULE_SERVICE_CODE_TAKEN"` still exists in
  `spec/errors.json` / `spec/errors.md` / `spec/worker-compatibility-v0.4.json`,
  but has **no `ErrorCode` member** any more. README section 8 lists it under
  "Historical spec values NOT exported by `ErrorCode`". (`BusErrorCode.BUS_DISABLED`
  is the opposite case: legacy VALUE, surviving surface, still exported.)
- `src/exposure.ts` is untouched **by #99**. Its `PrincipalType."AGENT"` is the autonomous
  AI originator (arch/16 §3, conformance family A11 "never renamed") and is out
  of scope for every agent rename, per docs#199 **D16**.

### Added

- **Controlled Exposure contracts — part 2 slice C1 of #59: reviewed scope &
  durable decision record** (§4/§7.1/§7.2/§8/§10; canonical
  `architecture/16-controlled-exposure-and-invocation-authorization.md`).
  Additive on the **unpublished** v1 Exposure surface (`src/exposure.ts`) — no
  `EXPOSURE_CONTRACT_VERSION` bump. Adds:
  - `ParameterDigest` (§4) — the content-addressed digest of the reviewed
    parameters over a **frozen three-stage preimage**: normalization under a
    referenced **immutable, Platform-registered normalization profile** →
    RFC 8785 JCS → SHA-256. The profile is **content-addressed by
    `normalizationProfile.profileDigest`** (`sha-256`, the content authority,
    mirroring part 1's `SchemaRef.schemaRecord`); `(profileId, profileRevision)`
    is the immutable **registry locator**. `algo`/`preimage` are literal
    descriptors; the profile record — not this wire object — binds the concrete
    normalization rules, so two implementations cannot normalize differently.
    Plaintext is never on the wire.
  - `ReviewedScope` (§7.1/§7.2/§8/§10) — the full round-1 `SESSION_BOUND`
    binding set frozen into a decision + audit snapshot: `account`,
    `accountToken` (adopting the merged Account Token rename), `deviceWorkloadIdentity`,
    `deviceInstance`, `managedAccessSession`, `serviceSelection`, `resolved`,
    `invocationPath`, `targetAdmission`, `outputClassificationUpperBound`,
    `parameterDigest`. `managedAccessSession` is a full **immutable
    `ManagedAccessSessionBinding` snapshot** (new export) — the session's §2/§6
    composite binding (session id, Account, Account Token id+revision, Device
    Workload Identity, Device Instance, Service Selection, authentication
    context, bounded lifetime, recorded state), NOT an opaque session id, so the
    `SESSION_BOUND` audit evidence provably binds the reviewed identities to the
    named session. Fail-closed cross-field invariants: the §35 single-instance
    binding (full `(deviceType, deviceInstanceId)`); §7.2 service consistency
    (`targetAdmission.service === resolved.service`, and an `explicit`
    `serviceSelection` must include `resolved.service`); §7.2 admission-scoping
    (`targetAdmission.checkpoint` deep-equals `resolved.checkpoint`); §3
    path↔admission agreement (the target hop's `service`/`serviceVersion`/
    `serviceInstanceRef` equal `targetAdmission`'s); §3 device-in-path (the
    reviewed `deviceInstance` appears as a `device-instance` hop); and §8
    session-binding agreement (every identity the session snapshot binds —
    Account, token id+revision, workload, Device Instance, Service Selection —
    equals the same-named top-level reviewed field, so substituting any of them
    under the same `sessionId` fails closed) — so the review cannot admit,
    select, or route a Service/instance other than the one resolved, and cannot
    claim a session binding it does not carry.
  - `TargetAdmissionRef` (§7.2) — an **exact, immutable** admission identity:
    concrete `service` + an **opaque vendor `serviceVersion`** (a non-empty NFC
    deployment-version string, distinct from the Checkpoint's core-SemVer identity)
    + the requested `checkpoint` the admission is scoped to + `artifactDigest`
    (`sha-256` content digest, not an opaque locator) + `serviceInstanceRef` +
    `admissionRevision` + `runtimeTrustRevision`, all required, so an
    artifact/instance/trust/checkpoint change necessarily changes the
    ReviewedScope. Full §7.2 data-flow model deferred (#61).
  - `InvocationPath` / `PathHop` / `PathRole` (§3 `A, through B, performs D on C`)
    — an ordered, append-only path (length >= 2) where each hop separates the
    **invocation-relative role** (`pathRole`: originator/intermediary/target —
    resolved per invocation, not a fixed type) from the **entity identity**
    (`hopIdentity`, a closed union on `entityKind`: a Device Instance, a Service
    Instance with an opaque vendor version + id, a `participant-instance`
    (Participant + opaque running-`instanceId`, for a runtime relay/adapter), or a
    bare `participant`), so a hop switching Device / Service / running instance
    changes the path. §3 topology is fail-closed: the first hop is the sole
    originator (A), the last is the sole target (C) and MUST be a concrete
    `service-instance`, and every interior hop is an intermediary (an element of
    B). A bare `participant` (no running instance) is allowed ONLY as the
    originator (an Account/agent A has no runtime instance); every non-originator
    hop must carry instance-bearing identity so a relay/adapter instance switch
    is detectable. `TargetAdmissionRef` itself enforces
    `checkpoint.serviceId === service` (standalone exact-identity, not reliant on
    the enclosing scope).
  - `Decision` (§10) — a **closed 4-branch discriminated union** on `outcome`
    (`ALLOW`/`DENY`/`REAUTHENTICATION_REQUIRED`/`APPROVAL_REQUIRED`), each branch
    carrying only its legal fields (ALLOW/DENY carry no ref; the async branches
    carry exactly their `challengeRef`/`approvalRef`), so illegal states are
    unrepresentable at the type level. Exports `DecisionOutcome`/`DecisionReasonCode`.
  - `AuditSnapshot` (§7.1) — the immutable historical decision record (top-level
    wire document carrying `contractVersion` first) with fail-closed invariants:
    `grantRef` may only accompany an `ALLOW` decision (§10); and the decision must
    respect the effective authorization mode `reviewedScope.resolved.controls.mode`
    (§8) — a `DENY` mode must resolve to a `DENY` decision, and an `AUTO`/`DENY`
    mode carries no `grantRef` and cannot yield `APPROVAL_REQUIRED` — and the
    reviewed session state (§6/§8) — a non-`ACTIVE`
    `managedAccessSession.state` (CLOSED/EXPIRED/REVOKED/INVALIDATED) must
    resolve to `DENY` and must not carry a `grantRef` (recording a decision
    against an ended session stays legal; claiming it succeeded does not).
    `auditSnapshotKey` helper validates + fails closed.

  Grant / Invocation Envelope remain #60; per-hop credential/data-flow detail and
  the Challenge/Approval/Grant lifecycle objects remain deferred (#61/#60). Refs #59, #60.

### Changed

- **Connector naming plane (0.8.0 concept freeze, R1 tier-2)** *(development
  history: the alias-retention this entry records, including "No export was
  removed", was an INTERMEDIATE state — the #99 entries earlier in this same
  0.8.6 release later DELETED 24 of these `Agent*` aliases outright, and the
  published 0.8.6 surface is #99's. Kept as written for the record.)* — the
  published TypeScript **export symbol** names for the former "Agent" concept
  are now `Connector*`-named primaries, with every previously published old
  name retained as a `@deprecated` alias pointing at the new name (`AgentStatus`,
  `AgentMode`, `AgentStatusSchema`, `AgentModeSchema`, `AgentSchema`, `Agent`,
  `RegisterAgentRequestSchema` / `RegisterAgentRequest` /
  `registerAgentRequestSchema`, `RegisterAgentResponseSchema` /
  `RegisterAgentResponse`, `WorldARegisterAgentResponseSchema` /
  `WorldARegisterAgentResponse`, `AgentHeartbeatRequestSchema` /
  `AgentHeartbeatRequest` / `agentHeartbeatRequestSchema`,
  `AgentHeartbeatResponseSchema` / `AgentHeartbeatResponse`,
  `WorldAAgentHeartbeatResponseSchema` / `WorldAAgentHeartbeatResponse`,
  `AgentHeartbeatSchema` / `AgentHeartbeat`). Each alias is the **same runtime
  object / same type** as its primary, so `===` identity, `instanceof` and
  structural typing are unchanged. **No export was removed** — the `.d.ts`
  export set is strictly additive.
  **Nothing on the wire changed**: enum VALUES (including `"AGENT"` in
  `AuditActorType` / `PrincipalType`), JSON payload keys (`agent`, `agentId`,
  `agentToken`, `agentMode`), id/token prefixes (`agt_`, `opstage_agent_`),
  error codes (`AGENT_REVOKED`, `AGENT_DISABLED`), `spec/` fixtures, enum specs
  and the OpenAPI surface are byte-identical.
  Doc-comment subjects in `src/ce.ts` / `src/exposure.ts` and the
  README / SECURITY / issue-template prose were updated to Connector / Platform.
  Refs #93.

## [0.8.5] - 2026-07-27

### Added

- **Controlled Exposure contracts — part 1 of #59: Checkpoint + Resource**
  (0.8.5; canonical `architecture/16-controlled-exposure-and-invocation-authorization.md`).
  New additive module `src/exposure.ts`, versioned via a separate
  `EXPOSURE_CONTRACT_VERSION` and coexisting with the 0.7.x CE Action/command
  contracts (no reinterpretation of existing Action objects). Introduces the
  immutable `CheckpointDefinition` (stable wire identity
  `serviceId + checkpointId + checkpointVersion` — `serviceId` is the **logical
  Service id** (`ops-linux`), not a legacy `svc_*` instance id; `checkpointVersion`
  is **core SemVer** (no leading zeros / prerelease / build) so it cannot fork
  across language SemVer libraries. `inputSchema`/`outputSchema` are
  **`SchemaRef`s that reference an immutable Platform-registered schema record**
  by content digest (`schemaRecord`) — the record binds the bytes + dialect +
  validation profile + the Platform's single authoritative interpretation, so
  consumers never re-interpret raw bytes and cannot disagree cross-language (an
  inline `jsonSchema` branch stays deferred). Business **idempotency**,
  execution/**delivery** guarantee, and an explicit **retry** policy are three
  orthogonal fields (replacing the old `AT_MOST_ONCE`-in-idempotency enum and the
  underspecified `retryable` boolean), with the legal combination frozen
  (`IDEMPOTENT_REPLAY` requires `IDEMPOTENT` + `AT_LEAST_ONCE`). `risk` and
  `sensitivity` (`inputUpperBound` + `outputUpperBound`, symmetric) use **frozen
  total orders** compared via `riskRank` / `dataClassificationRank`, which
  **fail closed** (schema-validate) on an illegal value rather than returning
  `-1`. The `ResourceExtractionSpec` keeps only the versioned `extractor-artifact`
  variant (declarative DSL deferred): **`artifactDigest` is the sole content
  authority** and an **`executionProfileRecord`** digest references an immutable,
  Platform-admitted execution-profile record binding the full deterministic ABI
  (runtime, module exports, IO envelope, error/timeout/memory limits, WASI/import
  allowlist, dependency-closure preimage; output re-validated as a v1
  `ResourceReference`); `artifactId` is an optional non-authoritative locator.
  and the segment-based `ResourceReference` / `ResourceSelector` with pure
  ancestry/containment/selector helpers (`resourceContains`, `selectorMatches`,
  `canonicalResourceString`, `encodeResourceId`, `checkpointVersionKey`).
  `segments` are the single authority: the canonical string is **derived**, not
  carried on the wire (so it cannot diverge), and is **injective** via a frozen
  cross-language **byte contract** — an id is NFC-normalized, UTF-8 encoded, and
  every non-RFC-3986-unreserved byte is percent-encoded as uppercase `%XX`
  (`encodeResourceId`), so delimiter/escape bytes (`:`/`/`/`%`), Unicode, CJK,
  NUL, newline, and control bytes all encode deterministically and never collide
  across languages. `encodeResourceId` **enforces its own wire invariant** —
  it `NfcString.parse`s the input, so empty, non-NFC, or lone-surrogate input is
  rejected rather than silently repaired (the helper cannot be a bypass).
  Free-form wire strings (Resource/selector ids, `aliases`, `localPreconditions`,
  `artifactId`) must be a **well-formed Unicode scalar sequence** — unpaired
  UTF-16 surrogates are rejected before NFC, so `\uD800`/`\uDC00` cannot be
  silently coerced to U+FFFD and collide with a genuine `�` in the byte encoding.
  **NFC is a cross-language *wire invariant*, not a local transform**: segment
  ids and exact selector ids that are not already NFC are **rejected** (the
  schema does not silently normalize), so a producer in any language must emit
  NFC and every consumer applies the same `value == NFC(value)` predicate —
  identity can never fork across TypeScript/Go/Java. Conformance vectors assert a
  composed (NFC) id is accepted and its decomposed spelling is rejected. The
  exported identity helpers (`canonicalResourceString`, `resourceContains`,
  `selectorMatches`, `checkpointVersionKey`) **validate their input against the
  owning schema and fail closed**, so a caller cannot fork identity by passing an
  unparsed structural object — a `type` bearing the delimiters `:`/`/` (which
  would collide in the canonical string) or a non-NFC id is rejected, not trusted.
  **Selectors are structured, not string-overloaded**: a selector segment is
  `{ match: "exact", id }` or `{ match: "any" }`, so the literal Resource id
  `"*"` is expressible by `{ match: "exact", id: "*" }` and is no longer
  conflated with the wildcard. Every nested object is `.strict()`, and the
  immutable surface carries **no Zod defaults** — `matchDescendants` and
  `localPreconditions` are required, so `{}` is never an implicit spelling of an
  object with defaults and immutable equality / re-registration / audit / future
  digest are stable across languages. **v1 is a strict, closed surface**: any
  later change a strict v1 consumer would reject — a new field, a new
  `SchemaRef` / `ResourceExtractionSpec` branch, a relaxed constraint — is **not**
  a wire-additive change; it requires bumping `EXPOSURE_CONTRACT_VERSION` or an
  explicit capability negotiation.
  A self-referential content **digest over the whole Checkpoint is intentionally
  deferred**: a cross-language digest needs a frozen canonical-serialization
  contract (preimage, self-exclusion, ordering, default expansion,
  number/unicode/array normalization, cross-language test vectors), tracked as a
  #59 follow-up before any digest field is added. Ships round-trip and
  invariant fixtures (semver/identity validation, strict unknown-field
  rejection, prefix containment, exact vs descendant selectors, and canonical
  collision resistance). The identity half — Account Token (formerly Device
  Token, docs#180) claims / Managed Access Session (§2, §6) — has since landed
  as part 2 slice A, and the authorization policy & decision model (§7/§8/§9)
  as part 2 slice B; Grant / Invocation Envelope remain #60. No package
  version bump here.

### Changed

- **BREAKING (pre-release, unpublished surface) — `DeviceToken*` renamed to
  `AccountToken*` (docs#180; canonical rename in xtrape-docs#181, runtime in
  platform-ce#150).** The Account-delegation credential formerly called
  "Device Token" is now "Account Token"; an optional Device / Device Instance
  binding is a usage-channel constraint, not the token's identity.
  - Removed exports: `DeviceTokenRefSchema`, `DeviceTokenRef`,
    `DeviceTokenClaimsSchema`, `DeviceTokenClaims`.
  - Added exports: `AccountTokenRefSchema`, `AccountTokenRef`,
    `AccountTokenClaimsSchema`, `AccountTokenClaims`, plus
    `ChannelBindingSchema` / `ChannelBinding` — a closed strict union
    `{ kind: "device", deviceId }` | `{ kind: "device-instance", deviceId,
    deviceInstanceId }` behind the new **optional**
    `AccountTokenClaims.channelBinding` field (absent = unbound), replacing
    the former required flat `deviceId` claim and aligning with the
    platform-persisted `boundDeviceId` / `boundDeviceInstanceId` pair
    (platform-ce#150: both or neither). `isTightening` now enforces the
    binding lattice: unbound -> device-bound -> same-device instance-bound
    only narrows; removing or swapping a binding is a widening.
  - Wire field rename: `ManagedAccessSession.deviceToken` ->
    `ManagedAccessSession.accountToken` (strict schema: the retired
    `deviceToken` key is rejected).
  - No compatibility alias is kept: the whole Exposure surface
    (`src/exposure.ts`, `EXPOSURE_CONTRACT_VERSION` v1) has never shipped in
    a published package (`@xtrape/contracts` on npm stops at 0.7.6), so there
    are zero external consumers.

## 0.7.6

### Added

- **Callback-token capability negotiation for CE Service registration**
  (contracts#82): `instance.supportsCallbackToken?: boolean` declares that the
  Service adopts a Server-issued per-instance callback token and will enforce
  it on inbound calls; `registrationResponse.callbackToken?: string` returns
  that token — only to declaring instances. This freezes the compatibility
  semantics for the 0.7.6 credential model (xtrape-docs#122): older or
  non-opt-in Services keep the transitional existing callback credential, and
  a Server must not switch them to the derived token. Ships with conformance
  fixtures for the declared request, the token-bearing response, and the
  token-free response.

### Changed (BREAKING — TS API surface)

- **All public `Capsule*` TypeScript exports are removed** ahead of the first public OSS release (design: xtrape-docs#100). The `Worker*` vocabulary is now the real definition, not an alias: `WorkerStatus(+Schema)`, `WorkerManifest(+Schema)`, `WorkerInstance(+Schema)`, `WorkerInstanceDetail(+Schema)`; `Worker`/`WorkerDetail` remain compatibility shorthands for the instance record. Removed: `CapsuleServiceStatus(+Schema)`, `CapsuleManifest(+Schema)`, `CapsuleService(+Schema)`, `CapsuleServiceDetail(+Schema)`, `CapsuleBusExperimental(+Schema)` (now `BusExperimental(+Schema)`).
- Error-code **property names** renamed to canonical vocabulary while their **wire VALUES stay unchanged**: `BusErrorCode.BUS_DISABLED` = `"CAPSULE_BUS_DISABLED"`, `ErrorCode.WORKER_CODE_TAKEN` = `"CAPSULE_SERVICE_CODE_TAKEN"`.

> *Later-added pointer (contracts-nodejs#99, shipped in 0.8.6). The two 0.7.6 bullets
> above are left exactly as written — they were accurate for 0.7.6. Their
> subjects have since been removed: the whole `Worker*` legacy vocabulary
> (`WorkerStatus*`, `WorkerManifest*`, `WorkerInstance*`, `WorkerInstanceDetail*`,
> `Worker`/`WorkerDetail*`) and the `ErrorCode.WORKER_CODE_TAKEN` member are
> deleted in the `[0.8.6]` section above (shipped 2026-08-09).
> `BusErrorCode.BUS_DISABLED` is unaffected and still exported.*

### Changed (BREAKING — wire accepted-input narrowing)

- **`WorkerManifestSchema` accepts `kind: "Worker"` only** (contracts#81):
  the legacy `"CapsuleService"` kind is REJECTED as of this release. Producers
  emit (and the omitted-kind default is) `"Worker"`. Implemented now, before
  the first public release, while there are zero external consumers — every
  known producer already emits `"Worker"`.

### Unchanged (per docs#100)

- Token prefixes (`opstage_reg_`, `opstage_agent_`, `xtrape_reg_`), error-code wire values, `svc_`/`agt_` ID prefixes, and `CE_CONTRACT_VERSION` are untouched; no schemaVersion bump.

## 0.7.5

### Changed

- **Package renamed `@xtrape/capsule-contracts-node` → `@xtrape/contracts`** before the first public 0.7.6 stack while all known consumers remain internal. The wire surface and `CE_CONTRACT_VERSION` are unchanged.
- The renamed package starts at `0.7.5`; the existing `v0.7.4` tag remains the immutable source for the historical release under the old package name.
- After `@xtrape/contracts@0.7.5` is published and verified, deprecate `@xtrape/capsule-contracts-node` on npm with a migration message pointing consumers to the canonical package.

## 0.7.4

> **Superseded in part** (#106, contracts#14, xtrape-docs#242): `timeoutSeconds`
> is no longer "required and server-clamped" — it is optional disclosure that
> nothing clamps or enforces. See the `[0.8.6]` entry above (shipped
> 2026-08-09). The text below is the historical record of what 0.7.4 shipped.

### Added

- World A long-poll transport contract (contracts#48, docs runtime-platform/09 §4/§5, scoped by docs#68 to the agent-dials-server direction only): `TransportParametersSchema` requires concrete server-distributed `mode`/`waitMs`/`maxBatch`. The canonical CE provisioning surface is fully frozen as `POST /v1/instances`: `WORLD_A_CE_REGISTRATION_PATH`, required `x-xtrape-registration-token` via `WorldACeRegistrationHeadersSchema`, strict `{manifest, instance}` `CeRegistrationRequestSchema` with service/tenant identity consistency, compatibility `CeRegistrationResponseSchema`, and transport-required `WorldACeRegistrationResponseSchema`. Legacy Opstage `WorldARegisterAgentResponseSchema`/heartbeat shapes remain compatibility-only and are not CE authority. `CommandPollResponseSchema` is a non-empty batch of strict `StreamDeliverySchema` arms with unique per-batch `deliveryId`: `COMMAND` explicitly discriminates `EXECUTE` vs optional `PREPARE`, `CANCEL` carries its own stable `cancelId`, and `MESSAGE` preserves the ConversationMessage envelope unchanged. Thus all server-originated action/control work rides the agent-initiated stream; "nothing to deliver" remains HTTP 204 with no body. `timeoutSeconds` is required and server-clamped for action commands. Ack requests require unique IDs; responses require unique/disjoint `acked`/`unknown`, and `AckDeliveriesExchangeSchema` freezes those arrays as an exact partition of the request IDs (no omission or foreign ID). New `CeErrorCode`: `TRANSPORT_MODE_UNSUPPORTED` (World B/SSE/WS are refused explicitly). Conformance fixtures under `spec/ce/transport` freeze provisioning/authentication, execute/prepare/cancel/message delivery, redelivery, unique batch ack keys, and complete ack exchange invariants.

### Compatibility

- Additive at `CE_CONTRACT_VERSION = 1`. World B / rendezvous discovery / HA routing stay 0.8.x; nothing here assumes a single server node (queue+ack semantics are multi-node safe).


## [0.7.3]

> **Superseded in part** (#106, contracts#14, xtrape-docs#242): there is no
> "server-enforced `timeoutSeconds`" any more — elapsed time terminalizes
> nothing, and `TIMEOUT` now names a bound the reporter itself declared. See
> the `[0.8.6]` entry above (shipped 2026-08-09). The text below is the
> historical record.

### Added

- Durable command lifecycle contract (contracts#50, docs runtime-platform/09 §6, for server-ce#68): `CeCommandStatus` (PREPARED/RUNNING/COMPLETED/FAILED, terminal-immutable) + `CommandFailureReason` (ERROR/TIMEOUT/CANCELLED) so server-enforced `timeoutSeconds` and cancellation are represented WITHOUT new states old consumers can't read. State invariants are **structurally frozen**, not merely documented: `CommandTerminalResultSchema` is a `.strict()` discriminated union where COMPLETED forbids a `failureReason` and FAILED requires one. `CommandDispatchRequestSchema` carries an `idempotencyKey` (stable command identity → dedup of retried dispatch); `CommandResultReportSchema` is claim-bound via a required `instanceId`; `CommandResultReportResponseSchema` freezes the duplicate/late/wrong-owner outcomes (`APPLIED`/`ALREADY_TERMINAL`/`UNKNOWN_COMMAND`/`OWNERSHIP_MISMATCH`); `CommandProgressSchema` carries `instanceId` + monotonic `seq` (ordering + dedup key); `CommandDispatchResponseSchema` (bounded-sync = terminal-result | `RUNNING`+commandId); `CommandCancelRequest`/`Response` (discriminated on `outcome`: CANCELLING+RUNNING / ALREADY_TERMINAL+terminal-status / UNKNOWN_COMMAND). The per-action `async` flag is deprecated (transport is uniformly async). Long-poll/`waitMs`/direction provisioning stay out (0.7.4 / #48).
- Sensitive / one-time result contract (contracts#50, for server-ce#86): a sensitive result is **one atomic report**, and the plaintext is split by direction so it can never leak on a durable/public projection. The agent → server report (`CommandResultReportSchema`, `sensitive: true` arm) carries the one-time `secret` alongside the `redacted` durable view and `requestedTtlSeconds`; the server → caller terminal/dispatch projection (`CommandTerminalResultSchema`, `sensitive: true` arm) carries **only** `redacted` + the server-set `expiresAt` — never the `secret`. Plaintext is delivered solely by `SensitiveConsumeResponseSchema`'s `DELIVERED` arm. The agent *requests* a TTL (`requestedTtlSeconds`, bounded by the exported `SENSITIVE_TTL_MAX_SECONDS = 3600`, default `SENSITIVE_TTL_DEFAULT_SECONDS = 300`); the **server clamps** it and derives the authoritative consumer from the command's origin — the agent cannot choose who reads it, pin an arbitrary expiry, or ride plaintext on the generic `result` field (all structurally rejected). `SensitiveDeliveryStateSchema` (`.strict()` discriminated union PENDING/CONSUMED/EXPIRED, per-status field sets, and NEVER carrying the plaintext); `SensitiveConsumeResponseSchema` (`.strict()` discriminated on `outcome`: `DELIVERED`+secret on first consume, `ALREADY_CONSUMED`/`EXPIRED`/`CONSUMER_MISMATCH` state-only afterwards). New `CeErrorCode`s: `UNKNOWN_COMMAND`, `SENSITIVE_ALREADY_CONSUMED`, `SENSITIVE_EXPIRED`, `SENSITIVE_CONSUMER_MISMATCH`.
- Conformance fixtures under `spec/ce/command-lifecycle` (23) and `spec/ce/sensitive-result` (15), valid **and invalid** — state transitions, timeout, cancellation, idempotent/late/wrong-owner report responses, progress, atomic sensitive report, delivery state, one-time consume — so every consumer (server-ce, agent-nodejs, Panel, Demo) validates the same bytes and the same rejections.

### Compatibility

- Additive at `CE_CONTRACT_VERSION = 1`; the existing PREPARED/RUNNING/COMPLETED/FAILED consumers are unchanged. TIMEOUT/CANCELLED are `failureReason`s under FAILED, not new status members. The legacy Capsule `CommandStatus` (SUCCEEDED/EXPIRED/CANCELLED, `index.ts`) is a separate heritage enum and is untouched.

## [0.7.1]

### Added

- Action result display envelope (contracts#44): `ActionResultSchema` (`{success, data?, message?, error?}`) plus operator-UI display structures rendered by Panel — `ActionDisplayListSchema` (`data.list`: table with columns/format/rowActions) and `ActionDisplayDetailSchema` (`data.detail`: key/value sheet with fields/format). Additive; capsule/opstage display heritage standardized.

## [0.7.0]

> Version correction: the async action envelopes below belong to the **0.7 milestone**
> (server-ce#41 "0.7.0: async action completion"). They were mistakenly published to
> npm as `0.6.1`; `0.6.1` is deprecated in favor of the identical `0.7.0`.

### Added

- Async action completion envelopes (server-ce#41 Stage B): `ActionAsyncAckSchema` (HTTP 202 `RUNNING` ack from a worker accepting a long-running action) and `ActionCommandResultSchema` (later outcome report to `POST /v1/instances/:instanceId/commands/:commandId/result`). Additive; synchronous actions are unaffected.


## 0.5.1 - 2026-06-22

### Changed

- Republish the CE 0.1 Phase 0 contract freeze with the merged Forgejo repository metadata and README authority-boundary documentation.

### Compatibility

- No wire/schema changes from `0.5.0`.

## 0.5.0 - 2026-06-22

### Added

- **Xtrape CE 0.1 Phase 0 runtime contracts frozen**: `CE_CONTRACT_VERSION` (`1`) plus `ServiceManifestSchema`, `ServiceInstanceSchema`, `AgentHeartbeatSchema`, `ConversationMessageSchema`, and `ErrorModelSchema` (with `CeErrorCode`), per `xtrape-docs` `runtime-platform/02..04`.
- Field/enum **surface guard** in `tests/ce-contracts.spec.ts` so accidental removal, rename, or incompatible additions fail in review (covers `.passthrough()` and optional fields a parse-only test would miss).
- README **Contract Authority Boundary** (`xtrape-contracts` future authority vs `xtrape-contracts-nodejs` TS/Zod implementation) and a **CE 0.1 Phase 0 Contracts** usage section.

### Changed

- `repository` / `homepage` / `bugs` URLs point to the canonical Forgejo repository.

### Compatibility

- npm name `@xtrape/capsule-contracts-node` remains a legacy physical compatibility identifier; `Capsule` is not a current concept.
- Pair with the CE 0.1 release train across `xtrape-server-ce`, `xtrape-agent-nodejs`, and `xtrape-demo`.

## 0.4.0-rc.0 - 2026-05-16

### Added

- Experimental Capsule Bus wire contracts for CE's built-in SQLite-backed in-process event-to-command router (`v0.4-experimental`): bus event envelopes, event publish requests/responses, route rules, command requests, routed command results, and persisted event records.
- Canonical `BusErrorCode` constants: `CAPSULE_BUS_DISABLED`, `BUS_RATE_LIMITED`, `BUS_DEPTH_EXCEEDED`.
- Lowercase aliases for Capsule Bus schemas for downstream compatibility.

### Removed

- `maxCommandsPerEvent` from `BusRouteRuleSchema` / `CreateBusRouteRuleRequestSchema`. v0.4 does not support fan-out; one matched route produces at most one `ACTION_EXECUTE` command.

### Compatibility

- Capsule Bus contracts are experimental and may change before v1.0.
- Pair with the `v0.4` release train across CE, Agent SDK, OpHub, demo, and site.

## 0.2.0 - 2026-05-14

First `v0.2 Public Preview` release. Pair with
`@xtrape/capsule-agent-node@0.2.0+` and Opstage CE `0.2.0+`.

### Removed (breaking)

- **`newId()`** helper. The helper minted random IDs with a prefix string;
  CE itself mints IDs in the backend and never imported `newId`. Removing
  it keeps the contracts surface focused on the wire spec.
- **`idPrefixes`** constant and **`IdPrefix`** type. Same rationale; the
  documented prefixes are now enforced by individual Zod schemas via
  `z.string().startsWith(...)`.
- **`nanoid`** removed from `dependencies` as a consequence of the above.
  Consumers that minted IDs from this package must wire their own factory —
  see the [ID generation](./README.md#id-generation) section of the README.

### Compatibility

- Wire schemas are **unchanged** between `0.1.x` and `0.2.x`. Existing
  `0.1.x` agents continue to validate against a `0.2.x` backend.
- Pairs with `@xtrape/capsule-agent-node@0.2.0+` and CE `0.2.0+`.

## 0.1.0-public-review.1 - 2026-05-08

### Added

- **ActionPrepareResultSchema**: New schema defining the shape an agent's prepare() handler must return for ACTION_PREPARE commands — `{ action?, inputSchema?, initialPayload?, currentState? }`. This ensures consistency between backend, SDK, and documentation.

### Changed

- **CommandSchema.type**: Removed the deprecated "ACTION" literal value. The backend only creates ACTION_PREPARE / ACTION_EXECUTE commands today. Lifted into a named `CommandTypeSchema` for reuse.
- **RegisterAgentRequest.agent.runtime**: Unified with service runtime using the same `RuntimeKind` enum (nodejs / java / python / go / other). Previously had two separate type domains causing inconsistent rejection behavior.

### Compatibility

- Pairs with `@xtrape/capsule-agent-node@0.1.0-public-review.1+`.

## 0.1.0 - 2026-05-01

The first publicly usable release of the shared TypeScript / Zod contract package.

### Added

- Shared Zod instance re-exported as `z`.
- Status enums and types: `AgentStatus`, `CapsuleServiceStatus`, `HealthStatus`, `CommandStatus`, `DangerLevel`, `AuditActorType`, `AuditResult`, `TokenStatus`.
- Admin schemas: users, sessions, registration token requests/responses.
- Agent schemas: registration, heartbeat, service report, command result.
- Capsule Service schemas: manifest, health, config, action, service detail.
- Command schemas: create, detail, result.
- Audit and dashboard schemas.
- System health and version schemas.
- Helpers: `newId`, `parseSort`, `paginate`, `HttpError`, `ListQueryBase`.
  (`newId` was removed in `0.2.0` — see that entry above.)
- Lowercase aliases for backend compatibility (e.g. `registerAgentRequestSchema` alongside `RegisterAgentRequestSchema`).

### Compatibility

- Targets Opstage CE `0.1.x`.
- Pairs with `@xtrape/capsule-agent-node@0.1.x`.

### Status

- Not yet published to npm. Consume from the workspace inside `xtrape-capsule-ce` or from a local checkout until the v0.1.0 Public Preview cut.


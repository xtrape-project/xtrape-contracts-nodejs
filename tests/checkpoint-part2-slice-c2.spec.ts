import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_CONTRACT_VERSION,
  AuthenticationRequirementSpecSchema,
  ConfirmationRequirement,
  ConfirmationRequirementSchema,
  CheckpointDefinitionSchema,
  ControlRequirementsSchema,
  DecisionSchema,
  DecisionOutcome,
  DecisionReasonCode,
  AuditSnapshotSchema,
  AuthenticationChallengeState,
  AuthenticationChallengeSchema,
  authenticationChallengeKey,
  ApprovalState,
  ApprovalSchema,
  approvalKey,
  AuthorizationGrantState,
  AuthorizationGrantSchema,
  authorizationGrantKey,
  ConfirmationContinuationState,
  ConfirmationContinuationSchema,
  confirmationContinuationKey,
  TransitionDenialReason,
  CHALLENGE_LEGAL_TRANSITIONS,
  evaluateChallengeTransition,
  APPROVAL_LEGAL_TRANSITIONS,
  evaluateApprovalTransition,
  GRANT_LEGAL_TRANSITIONS,
  evaluateGrantTransition,
  CONTINUATION_LEGAL_TRANSITIONS,
  evaluateConfirmationContinuationTransition,
} from "../src/index";

/* -------- shared fixtures (mirrors slice C1's base) -------- */

const cpA = { serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: "1.0.0" };

const resourceRef = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  segments: [
    { type: "host", id: "host-001" },
    { type: "service", id: "nginx" },
  ],
};

const authentication = {
  requester: { requirement: "REAUTH" as const, maxAgeSeconds: 300 },
  approver: { requirement: "MFA" as const, maxAgeSeconds: 300 },
};

const controls = {
  mode: "SESSION_BOUND" as const,
  authentication,
  maxTtlSeconds: 3600, // slice B2: SESSION_BOUND also carries a TTL (§8)
};

/** mode-correct controls (slice B2 presence rules). */
const controlsFor = (mode: "AUTO" | "TIME_BOUND" | "SESSION_BOUND" | "SINGLE_USE" | "DENY") => ({
  mode,
  authentication,
  ...(mode === "TIME_BOUND" || mode === "SESSION_BOUND" ? { maxTtlSeconds: 3600 } : {}),
});

/** mode-correct resolved effective lifetime/use fields (slice B2). */
const effectiveFor = (mode: "AUTO" | "TIME_BOUND" | "SESSION_BOUND" | "SINGLE_USE" | "DENY") =>
  mode === "AUTO" || mode === "DENY"
    ? {}
    : mode === "SINGLE_USE"
      ? {
          effectiveMaxTtlSeconds: 600,
          ttlProvenance: { source: "lifetime-profile" as const, profileId: "lt-platform-r1", profileRevision: "1" },
          effectiveMaxUses: 1,
        }
      : { effectiveMaxTtlSeconds: 3600, ttlProvenance: { source: "policy" as const } };

const resolved = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  service: "linux-ops-widget-nodejs",
  checkpoint: cpA,
  resourceBinding: { kind: "exact" as const, resource: resourceRef },
  controls,
  contributions: [
    {
      layer: "account-entitlement" as const,
      entitlementId: "ent-1",
      entitlementRevision: "2",
      revisionClass: "SNAPSHOT_STABLE" as const,
      invalidateDerivedAuthority: false,
      resolvedThrough: { kind: "direct" as const },
    },
    {
      layer: "policy-binding" as const,
      policyId: "pol-sys",
      bindingId: "bind-001",
      policyRevision: "9",
      bindingRevision: "4",
      revisionClass: "SNAPSHOT_STABLE" as const,
      invalidateDerivedAuthority: false,
      resolvedThrough: { kind: "direct" as const },
    },
    {
      layer: "system-exposure-rule" as const,
      ruleId: "rule-1",
      ruleRevision: "3",
      revisionClass: "SNAPSHOT_STABLE" as const,
      invalidateDerivedAuthority: false,
      resolvedThrough: { kind: "direct" as const },
    },
  ],
  effectiveRevisionClass: "SNAPSHOT_STABLE" as const,
  effectiveInvalidateDerivedAuthority: false,
  ...effectiveFor("SESSION_BOUND"),
};

const parameterDigest = {
  algo: "sha-256" as const,
  normalizationProfile: { profileDigest: "c".repeat(64), profileId: "np-checkpoint", profileRevision: "2" },
  preimage: "checkpoint-semantic-normalization|rfc8785-jcs" as const,
  digest: "a".repeat(64),
  byteLength: 128,
};

const artifactDigest = { algo: "sha-256" as const, digest: "b".repeat(64) };

const targetAdmission = {
  service: "linux-ops-widget-nodejs",
  serviceVersion: "2.1.0",
  checkpoint: cpA,
  artifactDigest,
  serviceInstanceRef: "inst-001",
  admissionRevision: "1",
  runtimeTrustRevision: "1",
};

const deviceInstance = { deviceType: "xtrape-mcp", deviceInstanceId: "di-001" };
const deviceWorkloadIdentity = {
  workloadIdentityId: "wl-001",
  credentialRevision: "3",
  deviceType: "xtrape-mcp",
  deviceInstanceId: "di-001",
};

const invocationPath = [
  { pathRole: "originator" as const, hopIdentity: { entityKind: "device-instance" as const, deviceInstance } },
  {
    pathRole: "target" as const,
    hopIdentity: {
      entityKind: "service-instance" as const,
      service: "linux-ops-widget-nodejs",
      serviceVersion: "2.1.0",
      serviceInstanceRef: "inst-001",
    },
  },
];

const managedAccessSession = {
  sessionId: "sess-1",
  establishment: "credential-pair" as const,
  account: { accountId: "acct-42" },
  accountToken: { tokenId: "tok-1", revision: "5" },
  deviceWorkloadIdentity,
  deviceInstance,
  serviceSelection: { scope: "explicit" as const, services: ["linux-ops-widget-nodejs", "self"] },
  authenticationContext: { authenticationContextId: "auth-001" },
  createdAtVersion: "1.0.0",
  expiresAtVersion: "2.0.0",
  state: "ACTIVE" as const,
};

const reviewedScope = {
  account: { accountId: "acct-42" },
  establishment: "credential-pair" as const,
  accountToken: { tokenId: "tok-1", revision: "5" },
  deviceWorkloadIdentity,
  deviceInstance,
  managedAccessSession,
  serviceSelection: { scope: "explicit" as const, services: ["linux-ops-widget-nodejs", "self"] },
  resolved,
  invocationPath,
  targetAdmission,
  outputClassificationUpperBound: "CONFIDENTIAL" as const,
  parameterDigest,
};

/** a reviewed scope whose effective controls carry a different mode — with
 *  the slice-B2 mode-correct TTL/use-count presence on both layers. */
const scopeWithMode = (mode: "AUTO" | "TIME_BOUND" | "SESSION_BOUND" | "SINGLE_USE" | "DENY") => {
  const { effectiveMaxTtlSeconds: _t, ttlProvenance: _p, effectiveMaxUses: _u, ...bare } = resolved;
  void _t; void _p; void _u;
  return {
    ...reviewedScope,
    resolved: { ...bare, controls: controlsFor(mode), ...effectiveFor(mode) },
  };
};

/** a reviewed scope whose resolved approver requirement is NONE (nothing demanded). */
const scopeWithApproverNone = {
  ...reviewedScope,
  resolved: {
    ...resolved,
    controls: { ...controls, authentication: { ...controls.authentication, approver: { requirement: "NONE" as const } } },
  },
};

/** a reviewed scope whose embedded session snapshot has ended (both copies, so
 *  only the C2 issuance-liveness rule fires, not the C1 agreement rule). */
const scopeWithEndedSession = {
  ...reviewedScope,
  managedAccessSession: { ...managedAccessSession, state: "EXPIRED" as const },
};

const evidence = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  level: "MFA" as const,
  methodClass: "totp",
  authenticationAtUnixSeconds: 1_700_000_500,
  sessionOrChallenge: { kind: "challenge" as const, challengeId: "ch-1" },
  deviceInstance,
};

const roundTrip = (schema: { parse: (v: unknown) => unknown }, sample: unknown) => {
  const parsed = schema.parse(sample);
  const round = schema.parse(JSON.parse(JSON.stringify(parsed)));
  expect(round).toEqual(parsed);
  return parsed;
};

/* ================================================================== */

describe("#60 slice C2 — confirmation axis (arch/16 §8.1)", () => {
  it("exports the frozen two-value requirement enum", () => {
    expect([...ConfirmationRequirement]).toEqual(["NOT_REQUIRED", "REQUIRED"]);
    expect(ConfirmationRequirementSchema.parse("REQUIRED")).toBe("REQUIRED");
    expect(() => ConfirmationRequirementSchema.parse("OPTIONAL")).toThrow();
  });

  it("a Checkpoint definition may declare confirmation; absence stays legal (pre-axis definitions keep their meaning)", () => {
    const def = {
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      id: cpA,
      inputSchema: { schemaRecord: `sha256:${"d".repeat(64)}` },
      outputSchema: { schemaRecord: `sha256:${"e".repeat(64)}` },
      resourceExtraction: {
        kind: "extractor-artifact" as const,
        artifactDigest: `sha256:${"f".repeat(64)}`,
        executionProfileRecord: `sha256:${"1".repeat(64)}`,
      },
      sideEffect: "READ_ONLY" as const,
      risk: "LOW" as const,
      sensitivity: { inputUpperBound: "INTERNAL" as const, outputUpperBound: "INTERNAL" as const },
      idempotency: "IDEMPOTENT" as const,
      delivery: "AT_LEAST_ONCE" as const,
      retry: "IDEMPOTENT_REPLAY" as const,
      execution: "SYNC" as const,
      action: { actionId: "getServiceStatus" },
      localPreconditions: [],
    };
    roundTrip(CheckpointDefinitionSchema, def); // absent — NOT_REQUIRED reading
    roundTrip(CheckpointDefinitionSchema, { ...def, confirmation: "REQUIRED" });
    expect(() => CheckpointDefinitionSchema.parse({ ...def, confirmation: "ALWAYS" })).toThrow();
  });

  it("a NONE requirement cannot carry maxAgeSeconds (review 2503: a freshness window over nothing)", () => {
    roundTrip(AuthenticationRequirementSpecSchema, { requirement: "NONE" });
    expect(() => AuthenticationRequirementSpecSchema.parse({ requirement: "NONE", maxAgeSeconds: 300 })).toThrow(
      /nothing to bound/,
    );
  });

  it("a Policy Binding's controls may carry requireConfirmation; absence stays legal", () => {
    roundTrip(ControlRequirementsSchema, controls);
    roundTrip(ControlRequirementsSchema, { ...controls, requireConfirmation: true });
    expect(() => ControlRequirementsSchema.parse({ ...controls, requireConfirmation: "yes" })).toThrow();
  });

  it("Decision gains the CONFIRMATION_REQUIRED branch with exactly a continuationRef", () => {
    expect([...DecisionOutcome]).toContain("CONFIRMATION_REQUIRED");
    expect([...DecisionReasonCode]).toContain("CHALLENGE_CONFIRMATION");
    roundTrip(DecisionSchema, {
      outcome: "CONFIRMATION_REQUIRED",
      reasonCode: "CHALLENGE_CONFIRMATION",
      continuationRef: { continuationId: "cc-1" },
    });
    // wrong reason code for the branch
    expect(() =>
      DecisionSchema.parse({
        outcome: "CONFIRMATION_REQUIRED",
        reasonCode: "CHALLENGE_APPROVAL",
        continuationRef: { continuationId: "cc-1" },
      }),
    ).toThrow();
    // the ref does not leak onto other branches (strict unknown-field rejection)
    expect(() =>
      DecisionSchema.parse({ outcome: "ALLOW", reasonCode: "ALLOWED", continuationRef: { continuationId: "cc-1" } }),
    ).toThrow();
  });

  it("audit: CONFIRMATION_REQUIRED is legal under an AUTO mode (mode-independent axis) but not under DENY", () => {
    const confirmationDecision = {
      outcome: "CONFIRMATION_REQUIRED" as const,
      reasonCode: "CHALLENGE_CONFIRMATION" as const,
      continuationRef: { continuationId: "cc-1" },
    };
    roundTrip(AuditSnapshotSchema, {
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      auditId: "aud-1",
      reviewedScope: scopeWithMode("AUTO"),
      decision: confirmationDecision,
      actor: { actorKind: "participant" as const, participant: { participantId: "p-1" } },
      atUnixSeconds: 1_700_000_000,
    });
    expect(() =>
      AuditSnapshotSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        auditId: "aud-2",
        reviewedScope: scopeWithMode("DENY"),
        decision: confirmationDecision,
        actor: { actorKind: "participant" as const, participant: { participantId: "p-1" } },
        atUnixSeconds: 1_700_000_000,
      }),
    ).toThrow(/DENY/);
  });
});

/* ================================================================== */

describe("#60 slice C2 — Authentication Challenge (arch/16 §10)", () => {
  const pending = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    challengeId: "ch-1",
    state: "PENDING" as const,
    subject: { kind: "requester" as const, account: { accountId: "acct-42" } },
    deviceWorkloadIdentity,
    deviceInstance,
    requirement: { requirement: "REAUTH" as const, maxAgeSeconds: 300 },
    scope: { kind: "invocation" as const, invocationId: "inv-1" },
    nonce: "nonce-0001",
    policyProvenance: { policyId: "pol-sys", policyRevision: "9" },
    issuedAtUnixSeconds: 1_700_000_000,
    expiresAtUnixSeconds: 1_700_000_900,
  };
  const completed = { ...pending, state: "COMPLETED" as const, evidence };

  it("exports the frozen five-state lifecycle", () => {
    expect([...AuthenticationChallengeState]).toEqual(["PENDING", "COMPLETED", "EXPIRED", "REVOKED", "CONSUMED"]);
  });

  it("round-trips PENDING (no evidence) and COMPLETED (coherent evidence)", () => {
    roundTrip(AuthenticationChallengeSchema, pending);
    roundTrip(AuthenticationChallengeSchema, completed);
  });

  // #123 pairing (review 2614 High): the consumer branch follows the subject.
  const approverCompleted = {
    ...completed,
    subject: { kind: "approver" as const, actor: { actorKind: "principal" as const, principal: { principalType: "USER" as const, principalId: "prin-1" } } },
    scope: { kind: "approval" as const, approvalId: "app-1" },
    evidence: { ...evidence },
  };

  it("round-trips CONSUMED with its single attachment — an APPROVER challenge attaches to its scope's Approval or a Grant", () => {
    roundTrip(AuthenticationChallengeSchema, {
      ...approverCompleted,
      state: "CONSUMED",
      consumedBy: { kind: "approval", approvalId: "app-1" },
    });
    roundTrip(AuthenticationChallengeSchema, {
      ...approverCompleted,
      state: "CONSUMED",
      consumedBy: { kind: "grant", grantId: "gr-1" },
    });
    // an approval attachment naming a DIFFERENT approval than the scope is forged provenance
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...approverCompleted, state: "CONSUMED", consumedBy: { kind: "approval", approvalId: "app-OTHER" } }),
    ).toThrow(/scope.approvalId/);
    // an approver challenge is never consumed by an invocation
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...approverCompleted, state: "CONSUMED", consumedBy: { kind: "invocation", invocationId: "inv-1" } }),
    ).toThrow(/never consumed by an invocation/);
  });

  it("#123: a requester challenge is accepted by ITS invocation (Option A) — and only that one", () => {
    roundTrip(AuthenticationChallengeSchema, {
      ...completed,
      state: "CONSUMED",
      consumedBy: { kind: "invocation", invocationId: "inv-1" },
    });
    // a requester challenge cannot be attached to an Approval/Grant (review 2614 High: forged provenance)
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...completed, state: "CONSUMED", consumedBy: { kind: "approval", approvalId: "app-1" } }),
    ).toThrow(/requester challenge is consumed by its INVOCATION/);
    // and only by the invocation in its scope
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...completed, state: "CONSUMED", consumedBy: { kind: "invocation", invocationId: "inv-OTHER" } }),
    ).toThrow(/scope.invocationId/);
    // the union stays closed: an unknown kind is refused
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...completed, state: "CONSUMED", consumedBy: { kind: "command", commandId: "cmd-1" } }),
    ).toThrow();
  });

  it("#123: windowPolicyProvenance names a DIFFERENT window contributor, requires a window, and never duplicates the level source", () => {
    const withWindow = AuthenticationChallengeSchema.parse({
      ...completed,
      windowPolicyProvenance: { policyId: "pol-b", policyRevision: "7" },
    });
    expect(withWindow.windowPolicyProvenance).toEqual({ policyId: "pol-b", policyRevision: "7" });
    // duplicating the level source is refused (omit it instead)
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...completed, windowPolicyProvenance: { ...completed.policyProvenance } }),
    ).toThrow(/DIFFERENT source/);
    // a window provenance without a window to attribute is refused
    const { maxAgeSeconds: _drop, ...bareRequirement } = completed.requirement as { requirement: string; maxAgeSeconds?: number };
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...completed, requirement: bareRequirement, windowPolicyProvenance: { policyId: "pol-b", policyRevision: "7" } }),
    ).toThrow(/freshness window/);
  });

  it("EXPIRED/REVOKED keep the evidence of a completion that preceded them (review 2503: history-preserving)", () => {
    roundTrip(AuthenticationChallengeSchema, { ...completed, state: "EXPIRED" });
    roundTrip(AuthenticationChallengeSchema, { ...completed, state: "REVOKED" });
    // …and stay parseable without it (expired/revoked while still PENDING)
    roundTrip(AuthenticationChallengeSchema, { ...pending, state: "EXPIRED" });
    roundTrip(AuthenticationChallengeSchema, { ...pending, state: "REVOKED" });
  });

  it("rejects an inverted issue/expiry window", () => {
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...pending, issuedAtUnixSeconds: 2, expiresAtUnixSeconds: 1 }),
    ).toThrow(/expiresAtUnixSeconds/);
  });

  it("rejects the §35 workload/device split identity", () => {
    expect(() =>
      AuthenticationChallengeSchema.parse({
        ...pending,
        deviceWorkloadIdentity: { ...deviceWorkloadIdentity, deviceInstanceId: "di-OTHER" },
      }),
    ).toThrow(/single-instance/);
  });

  it("rejects evidence on an uncompleted state and missing evidence on a completed one", () => {
    expect(() => AuthenticationChallengeSchema.parse({ ...pending, evidence })).toThrow(/nothing has been proven yet/);
    expect(() => AuthenticationChallengeSchema.parse({ ...pending, state: "COMPLETED" })).toThrow(/completion evidence/);
  });

  it("rejects CONSUMED without its attachment and an attachment on other states", () => {
    expect(() => AuthenticationChallengeSchema.parse({ ...completed, state: "CONSUMED" })).toThrow(/consumedBy|single Approval/);
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...completed, consumedBy: { kind: "grant", grantId: "gr-1" } }),
    ).toThrow(/must not carry consumedBy/);
  });

  it("has NO self-declared reusable-evidence flag (fail closed until the policy algebra lands — review 2501)", () => {
    expect(() => AuthenticationChallengeSchema.parse({ ...pending, reusableEvidence: true })).toThrow();
    expect(() => AuthenticationChallengeSchema.parse({ ...pending, reusableEvidence: false })).toThrow();
  });

  it("rejects evidence produced by a different challenge, a session, another device, an insufficient level, or outside the window", () => {
    expect(() =>
      AuthenticationChallengeSchema.parse({
        ...completed,
        evidence: { ...evidence, sessionOrChallenge: { kind: "challenge", challengeId: "ch-OTHER" } },
      }),
    ).toThrow(/THIS challengeId/);
    expect(() =>
      AuthenticationChallengeSchema.parse({
        ...completed,
        evidence: { ...evidence, sessionOrChallenge: { kind: "session", sessionId: "sess-1" } },
      }),
    ).toThrow(/THIS challengeId/);
    expect(() =>
      AuthenticationChallengeSchema.parse({
        ...completed,
        evidence: { ...evidence, deviceInstance: { deviceType: "xtrape-mcp", deviceInstanceId: "di-OTHER" } },
      }),
    ).toThrow(/deviceInstance/);
    expect(() =>
      AuthenticationChallengeSchema.parse({
        ...completed,
        requirement: { requirement: "MFA" },
        evidence: { ...evidence, level: "REAUTH" },
      }),
    ).toThrow(/does not satisfy/);
    expect(() =>
      AuthenticationChallengeSchema.parse({
        ...completed,
        evidence: { ...evidence, authenticationAtUnixSeconds: 1_700_001_000 },
      }),
    ).toThrow(/within \[issuedAt, expiresAt\]/);
  });

  it("rejects a NONE requirement (a challenge exists to prove a required confirmation — review 2502)", () => {
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...pending, requirement: { requirement: "NONE" } }),
    ).toThrow(/cannot require NONE/);
  });

  it("an approver subject spans the FULL Approval actor domain — participant AND principal (review 2504 High)", () => {
    const approverBase = {
      ...pending,
      scope: { kind: "approval" as const, approvalId: "app-1" },
    };
    roundTrip(AuthenticationChallengeSchema, {
      ...approverBase,
      subject: { kind: "approver", actor: { actorKind: "participant", participant: { participantId: "p-approver" } } },
    });
    roundTrip(AuthenticationChallengeSchema, {
      ...approverBase,
      subject: { kind: "approver", actor: { actorKind: "principal", principal: { principalType: "AGENT", principalId: "pr-ai-1" } } },
    });
    // the pre-2504 narrow form no longer parses
    expect(() =>
      AuthenticationChallengeSchema.parse({
        ...approverBase,
        subject: { kind: "approver", participant: { participantId: "p-approver" } },
      }),
    ).toThrow();
  });

  it("rejects a mispaired subject/scope (requester⇔invocation, approver⇔approval)", () => {
    expect(() =>
      AuthenticationChallengeSchema.parse({ ...pending, scope: { kind: "approval", approvalId: "app-1" } }),
    ).toThrow(/invocation scope/);
    expect(() =>
      AuthenticationChallengeSchema.parse({
        ...pending,
        subject: { kind: "approver", actor: { actorKind: "participant", participant: { participantId: "p-9" } } },
      }),
    ).toThrow(/approval scope/);
  });

  it("has a collision-free key", () => {
    expect(authenticationChallengeKey(AuthenticationChallengeSchema.parse(pending) as never)).toBe(
      `challenge\u001fch-1`,
    );
  });
});

/* ================================================================== */

describe("#60 slice C2 — single-stage Approval (arch/16 §10)", () => {
  const pendingApproval = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    approvalId: "app-1",
    state: "PENDING" as const,
    requester: { actorKind: "participant" as const, participant: { participantId: "p-requester" } },
    reviewedScope,
    issuedAtUnixSeconds: 1_700_000_000,
    decisionDeadlineUnixSeconds: 1_700_003_600,
  };
  const approver = { actorKind: "participant" as const, participant: { participantId: "p-approver" } };
  // evidence at t=…500, decision at t=…600: fresh within the approver's 300s window.
  const approved = {
    ...pendingApproval,
    state: "APPROVED" as const,
    approver,
    decidedAtUnixSeconds: 1_700_000_600,
    approverEvidence: evidence,
  };

  it("exports the frozen six-state lifecycle", () => {
    expect([...ApprovalState]).toEqual(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED", "INVALIDATED"]);
  });

  it("round-trips PENDING, a decided APPROVED with fresh satisfying evidence, and a REJECTED without evidence", () => {
    roundTrip(ApprovalSchema, pendingApproval);
    roundTrip(ApprovalSchema, approved); // MFA evidence, 100s old at decision — within the 300s window
    // rejection confers no authority, so it stands without approver evidence
    roundTrip(ApprovalSchema, { ...approved, state: "REJECTED", approverEvidence: undefined });
  });

  it("requires approverEvidence on APPROVED when an approver requirement was resolved (review 2501 High)", () => {
    expect(() => ApprovalSchema.parse({ ...approved, approverEvidence: undefined })).toThrow(
      /must carry approverEvidence/,
    );
  });

  it("rejects stale or future approver evidence relative to the decision (review 2501 High)", () => {
    // evidence 400s old at decision — outside the resolved 300s window
    expect(() => ApprovalSchema.parse({ ...approved, decidedAtUnixSeconds: 1_700_000_900 })).toThrow(/stale/);
    // evidence timestamped AFTER the decision
    expect(() =>
      ApprovalSchema.parse({
        ...approved,
        approverEvidence: { ...evidence, authenticationAtUnixSeconds: 1_700_000_700 },
      }),
    ).toThrow(/after the decision/);
  });

  it("requester is an actor identity — participant or principal — not an AccountRef (review 2502 Medium)", () => {
    roundTrip(ApprovalSchema, {
      ...pendingApproval,
      requester: { actorKind: "principal", principal: { principalType: "AGENT", principalId: "pr-ai-1" } },
    });
    expect(() => ApprovalSchema.parse({ ...pendingApproval, requester: { accountId: "acct-42" } })).toThrow();
  });

  it("the approver must be a DIFFERENT party than the requester (§8.1 floor; SoD stays deferred)", () => {
    expect(() =>
      ApprovalSchema.parse({
        ...approved,
        approver: { actorKind: "participant", participant: { participantId: "p-requester" } },
      }),
    ).toThrow(/DIFFERENT party/);
    // different kind, same id string — different namespaces, allowed
    roundTrip(ApprovalSchema, {
      ...approved,
      approver: { actorKind: "principal", principal: { principalType: "USER", principalId: "p-requester" } },
    });
  });

  it("a resolved approver requirement of NONE demands no evidence (review 2502 High)", () => {
    roundTrip(ApprovalSchema, {
      ...approved,
      reviewedScope: scopeWithApproverNone,
      approverEvidence: undefined,
    });
  });

  it("REVOKED/INVALIDATED keep the decision record of a prior APPROVED (review 2503: history-preserving)", () => {
    roundTrip(ApprovalSchema, { ...approved, state: "REVOKED" });
    roundTrip(ApprovalSchema, { ...approved, state: "INVALIDATED" });
    // …and parse without one (revoked/invalidated while still PENDING)
    roundTrip(ApprovalSchema, {
      ...approved,
      state: "REVOKED",
      approver: undefined,
      decidedAtUnixSeconds: undefined,
      approverEvidence: undefined,
    });
  });

  it("a kept decision record must be whole and evidenced (no forged half-histories)", () => {
    // unpaired halves
    expect(() => ApprovalSchema.parse({ ...approved, state: "REVOKED", approver: undefined })).toThrow(/paired/);
    expect(() =>
      ApprovalSchema.parse({ ...approved, state: "REVOKED", decidedAtUnixSeconds: undefined }),
    ).toThrow(/paired|without its decision record/);
    // a conferring record under an MFA approver spec still requires evidence
    expect(() => ApprovalSchema.parse({ ...approved, state: "INVALIDATED", approverEvidence: undefined })).toThrow(
      /must carry approverEvidence/,
    );
    // EXPIRED never recorded a decision (only reachable from PENDING)
    expect(() => ApprovalSchema.parse({ ...approved, state: "EXPIRED" })).toThrow(/no decision was recorded/);
  });

  it("rejects a decision without approver/decidedAt, and decision fields on an undecided state", () => {
    expect(() => ApprovalSchema.parse({ ...pendingApproval, state: "APPROVED" })).toThrow(/approver and decidedAt/);
    expect(() => ApprovalSchema.parse({ ...pendingApproval, approver })).toThrow(/must not carry approver/);
    expect(() => ApprovalSchema.parse({ ...pendingApproval, approverEvidence: evidence })).toThrow(
      /must not carry approver/,
    );
  });

  it("rejects a decision outside [issuedAt, decisionDeadline] (an expired approval cannot later be approved)", () => {
    const rejected = { ...approved, state: "REJECTED" as const, approverEvidence: undefined };
    expect(() => ApprovalSchema.parse({ ...rejected, decidedAtUnixSeconds: 1_700_003_601 })).toThrow(
      /cannot later be approved/,
    );
    expect(() => ApprovalSchema.parse({ ...rejected, decidedAtUnixSeconds: 1_699_999_999 })).toThrow(
      />= issuedAtUnixSeconds/,
    );
    expect(() =>
      ApprovalSchema.parse({ ...pendingApproval, issuedAtUnixSeconds: 2, decisionDeadlineUnixSeconds: 1 }),
    ).toThrow(/decisionDeadlineUnixSeconds/);
  });

  it("rejects an Approval under an AUTO or DENY reviewed mode", () => {
    expect(() => ApprovalSchema.parse({ ...pendingApproval, reviewedScope: scopeWithMode("AUTO") })).toThrow(/AUTO/);
    expect(() => ApprovalSchema.parse({ ...pendingApproval, reviewedScope: scopeWithMode("DENY") })).toThrow(/DENY/);
  });

  it("rejects an issuance snapshot whose session has ended", () => {
    expect(() => ApprovalSchema.parse({ ...pendingApproval, reviewedScope: scopeWithEndedSession })).toThrow(/ACTIVE/);
  });

  it("rejects approver evidence below the resolved approver requirement", () => {
    // fresh (100s) and timely, so ONLY the §9 rank rule fires
    expect(() => ApprovalSchema.parse({ ...approved, approverEvidence: { ...evidence, level: "REAUTH" } })).toThrow(
      /approver requirement/,
    );
  });

  it("has a collision-free key", () => {
    expect(approvalKey(ApprovalSchema.parse(approved) as never)).toBe(`approval\u001fapp-1`);
  });
});

/* ================================================================== */

describe("#60 slice C2 — Authorization Grant (arch/16 §10)", () => {
  // slice B2 issuance binding (review 2518): expiresAt = issuedAt + resolved
  // effective TTL, and maxUses mirrors resolved.effectiveMaxUses exactly —
  // so a use-limit-bearing grant needs a scope whose resolution SOURCED one.
  const usesScope = {
    ...reviewedScope,
    resolved: {
      ...reviewedScope.resolved,
      controls: { ...reviewedScope.resolved.controls, maxUses: 5 },
      effectiveMaxUses: 5,
    },
  };
  const activeGrant = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    grantId: "gr-1",
    state: "ACTIVE" as const,
    mode: "SESSION_BOUND" as const, // equals the fixture's reviewed effective mode
    reviewedScope: usesScope,
    issuedAtUnixSeconds: 1_700_000_000,
    expiresAtUnixSeconds: 1_700_003_600, // = issuedAt + effectiveMaxTtlSeconds (3600)
    maxUses: 5,
    usedCount: 2,
    approvalRef: { approvalId: "app-1" },
  };
  const singleUseConsumed = {
    ...activeGrant,
    grantId: "gr-2",
    state: "CONSUMED" as const,
    mode: "SINGLE_USE" as const,
    reviewedScope: scopeWithMode("SINGLE_USE"),
    expiresAtUnixSeconds: 1_700_000_600, // = issuedAt + the lifetime profile's 600
    maxUses: 1,
    usedCount: 1,
  };

  it("exports the frozen five-state lifecycle", () => {
    expect([...AuthorizationGrantState]).toEqual(["ACTIVE", "CONSUMED", "EXPIRED", "REVOKED", "INVALIDATED"]);
  });

  it("round-trips an ACTIVE reusable grant and a CONSUMED single-use grant (with a retry relation)", () => {
    roundTrip(AuthorizationGrantSchema, activeGrant);
    roundTrip(AuthorizationGrantSchema, singleUseConsumed);
    roundTrip(AuthorizationGrantSchema, {
      ...singleUseConsumed,
      grantId: "gr-3",
      state: "ACTIVE",
      usedCount: 0,
      retryOf: { grantId: "gr-2" },
    });
  });

  it("a reusable-mode grant may omit the use limit — WHEN its resolution carried none (reviews 2501/2518)", () => {
    const { maxUses: _drop, ...unlimited } = { ...activeGrant, reviewedScope };
    void _drop;
    roundTrip(AuthorizationGrantSchema, unlimited);
    // …but an unlimited grant has nothing to exhaust: CONSUMED does not parse
    expect(() => AuthorizationGrantSchema.parse({ ...unlimited, state: "CONSUMED", usedCount: 7 })).toThrow(
      /nothing to exhaust/,
    );
    // and SINGLE_USE must state its limit of exactly 1
    const { maxUses: _drop2, ...singleUseNoLimit } = { ...singleUseConsumed, state: "ACTIVE" as const, usedCount: 0 };
    void _drop2;
    expect(() => AuthorizationGrantSchema.parse(singleUseNoLimit)).toThrow(/maxUses present and exactly 1/);
  });

  it("issuance is mechanical: the grant cannot deviate from its own resolved constraints (review 2518 High)", () => {
    // expiry: anything other than issuedAt + effective TTL does not parse
    expect(() =>
      AuthorizationGrantSchema.parse({ ...activeGrant, expiresAtUnixSeconds: 1_700_007_200 }),
    ).toThrow(/must equal issuedAtUnixSeconds \+ resolved.effectiveMaxTtlSeconds/);
    // overflow past MAX_SAFE_INTEGER fails closed rather than saturating
    expect(() =>
      AuthorizationGrantSchema.parse({
        ...activeGrant,
        issuedAtUnixSeconds: Number.MAX_SAFE_INTEGER - 100,
        expiresAtUnixSeconds: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(/exceeds Number.MAX_SAFE_INTEGER/);
    // use limit: must mirror the resolution exactly…
    expect(() => AuthorizationGrantSchema.parse({ ...activeGrant, maxUses: 3, usedCount: 2 })).toThrow(
      /must equal resolved.effectiveMaxUses/,
    );
    // …and a resolution WITHOUT a use limit forbids the grant from minting one
    expect(() => AuthorizationGrantSchema.parse({ ...activeGrant, reviewedScope })).toThrow(
      /cannot mint a use limit/,
    );
  });

  it("requires the producing approvalRef (review 2501 High: a grant that cannot name its approval breaks the §10 audit chain)", () => {
    const { approvalRef: _drop, ...noApproval } = activeGrant;
    void _drop;
    expect(() => AuthorizationGrantSchema.parse(noApproval)).toThrow();
  });

  it("rejects AUTO/DENY grants and a mode diverging from the reviewed effective mode", () => {
    expect(() =>
      AuthorizationGrantSchema.parse({ ...activeGrant, mode: "AUTO", reviewedScope: scopeWithMode("AUTO") }),
    ).toThrow(/AUTO/);
    expect(() =>
      AuthorizationGrantSchema.parse({ ...activeGrant, mode: "DENY", reviewedScope: scopeWithMode("DENY") }),
    ).toThrow(/DENY/);
    expect(() => AuthorizationGrantSchema.parse({ ...activeGrant, mode: "TIME_BOUND" })).toThrow(/effective mode/);
  });

  it("rejects a SINGLE_USE grant whose maxUses is not exactly 1", () => {
    expect(() => AuthorizationGrantSchema.parse({ ...singleUseConsumed, maxUses: 2, usedCount: 2 })).toThrow(
      /maxUses present and exactly 1/,
    );
  });

  it("rejects use-count contradictions (overuse; CONSUMED short of the limit; ACTIVE fully used)", () => {
    expect(() => AuthorizationGrantSchema.parse({ ...activeGrant, usedCount: 6 })).toThrow(/<= maxUses/);
    expect(() => AuthorizationGrantSchema.parse({ ...activeGrant, state: "CONSUMED", usedCount: 4 })).toThrow(
      /usedCount === maxUses/,
    );
    expect(() => AuthorizationGrantSchema.parse({ ...activeGrant, usedCount: 5 })).toThrow(/CONSUMED, not ACTIVE/);
  });

  it("a limit-reached grant parses ONLY as CONSUMED — exhaustion wins over other terminal states (review 2502 Medium)", () => {
    for (const state of ["EXPIRED", "REVOKED", "INVALIDATED"] as const) {
      expect(() => AuthorizationGrantSchema.parse({ ...activeGrant, state, usedCount: 5 })).toThrow(
        /parses only as CONSUMED/,
      );
    }
    // short of the limit the same terminal states parse fine
    roundTrip(AuthorizationGrantSchema, { ...activeGrant, state: "REVOKED", usedCount: 3 });
  });

  it("rejects an inverted issue/expiry window and an ended-session issuance snapshot", () => {
    expect(() =>
      AuthorizationGrantSchema.parse({ ...activeGrant, issuedAtUnixSeconds: 2, expiresAtUnixSeconds: 1 }),
    ).toThrow(/expiresAtUnixSeconds/);
    expect(() => AuthorizationGrantSchema.parse({ ...activeGrant, reviewedScope: scopeWithEndedSession })).toThrow(
      /ACTIVE/,
    );
  });

  it("rejects a self-referential retry relation", () => {
    expect(() => AuthorizationGrantSchema.parse({ ...activeGrant, retryOf: { grantId: "gr-1" } })).toThrow(
      /DIFFERENT grant/,
    );
  });

  it("has a collision-free key", () => {
    expect(authorizationGrantKey(AuthorizationGrantSchema.parse(activeGrant) as never)).toBe(`grant\u001fgr-1`);
  });
});

/* ================================================================== */

describe("#60 slice C2 — Confirmation Continuation (arch/16 §8.1)", () => {
  const issued = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    continuationId: "cc-1",
    state: "ISSUED" as const,
    requestId: "req-first-001",
    generation: "1",
    account: { accountId: "acct-42" },
    managedAccessSession,
    checkpoint: cpA,
    resource: resourceRef,
    parameterDigest,
    issuedAtUnixSeconds: 1_700_000_000,
    expiresAtUnixSeconds: 1_700_000_600,
  };
  const consumed = {
    ...issued,
    state: "CONSUMED" as const,
    consumedBy: { confirmedRequestId: "req-second-001", commandId: "cmd-1" },
  };

  it("exports the frozen four-state lifecycle", () => {
    expect([...ConfirmationContinuationState]).toEqual(["ISSUED", "CONSUMED", "EXPIRED", "INVALIDATED"]);
  });

  it("round-trips ISSUED and CONSUMED (the confirmed submission has its OWN requestId + the committed commandId)", () => {
    roundTrip(ConfirmationContinuationSchema, issued);
    roundTrip(ConfirmationContinuationSchema, consumed);
  });

  it("#123: a platform-internal (commandless) target consumes with the durable INVOCATION record (Option A)", () => {
    roundTrip(ConfirmationContinuationSchema, {
      ...issued,
      state: "CONSUMED" as const,
      consumedBy: { confirmedRequestId: "req-second-001", invocationId: "inv-1" },
    });
    // the union stays closed: carrying BOTH ids, or neither, is refused
    expect(() =>
      ConfirmationContinuationSchema.parse({ ...issued, state: "CONSUMED", consumedBy: { confirmedRequestId: "req-second-001", commandId: "cmd-1", invocationId: "inv-1" } }),
    ).toThrow();
    expect(() =>
      ConfirmationContinuationSchema.parse({ ...issued, state: "CONSUMED", consumedBy: { confirmedRequestId: "req-second-001" } }),
    ).toThrow();
    // §8.1: the confirmed submission is a NEW logical request on this branch too
    expect(() =>
      ConfirmationContinuationSchema.parse({ ...issued, state: "CONSUMED", consumedBy: { confirmedRequestId: issued.requestId, invocationId: "inv-1" } }),
    ).toThrow(/differ/);
  });

  it("rejects an inverted issue/expiry window", () => {
    expect(() =>
      ConfirmationContinuationSchema.parse({ ...issued, issuedAtUnixSeconds: 2, expiresAtUnixSeconds: 1 }),
    ).toThrow(/expiresAtUnixSeconds/);
  });

  it("rejects a handle bound to a session issued for a different Account", () => {
    expect(() => ConfirmationContinuationSchema.parse({ ...issued, account: { accountId: "acct-OTHER" } })).toThrow(
      /different Account/,
    );
  });

  it("rejects an ended-session issuance snapshot", () => {
    expect(() =>
      ConfirmationContinuationSchema.parse({
        ...issued,
        managedAccessSession: { ...managedAccessSession, state: "REVOKED" },
      }),
    ).toThrow(/ACTIVE/);
  });

  it("rejects consumption-shape contradictions (CONSUMED without consumedBy; consumedBy on ISSUED)", () => {
    expect(() => ConfirmationContinuationSchema.parse({ ...issued, state: "CONSUMED" })).toThrow(/consumedBy/);
    expect(() =>
      ConfirmationContinuationSchema.parse({ ...issued, consumedBy: consumed.consumedBy }),
    ).toThrow(/must not carry consumedBy/);
  });

  it("rejects a confirmed submission reusing the first submission's requestId (§8.1: it is a NEW logical request)", () => {
    expect(() =>
      ConfirmationContinuationSchema.parse({
        ...consumed,
        consumedBy: { confirmedRequestId: "req-first-001", commandId: "cmd-1" },
      }),
    ).toThrow(/NEW logical request/);
  });

  it("bounds the client-supplied requestId (free NFC text, max 256 chars)", () => {
    roundTrip(ConfirmationContinuationSchema, { ...issued, requestId: "任务-确认-001" });
    expect(() => ConfirmationContinuationSchema.parse({ ...issued, requestId: "x".repeat(257) })).toThrow(/256/);
    expect(() => ConfirmationContinuationSchema.parse({ ...issued, requestId: "" })).toThrow();
  });

  it("has a collision-free key on the Platform-issued id only (a requestId may contain U+001F)", () => {
    roundTrip(ConfirmationContinuationSchema, { ...issued, requestId: "a\u001fb" }); // legal in a requestId…
    expect(confirmationContinuationKey(ConfirmationContinuationSchema.parse(issued) as never)).toBe(
      `continuation\u001fcc-1`, // …and never embedded in the key
    );
  });
});

/* ================================================================== */

describe("#60 slice C2 — lifecycle transition machines (arch/16 §10 / §8.1, review 2502/2503)", () => {
  const t0 = 1_700_000_000; // inside every fixture window
  const late = 1_800_000_000; // after every fixture bound
  const at = (nowUnixSeconds: number) => ({ nowUnixSeconds });

  // durable-object fixtures in the states the machines transition FROM
  const chPending = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    challengeId: "ch-1",
    state: "PENDING" as const,
    subject: { kind: "requester" as const, account: { accountId: "acct-42" } },
    deviceWorkloadIdentity,
    deviceInstance,
    requirement: { requirement: "REAUTH" as const, maxAgeSeconds: 300 },
    scope: { kind: "invocation" as const, invocationId: "inv-1" },
    nonce: "nonce-0001",
    policyProvenance: { policyId: "pol-sys", policyRevision: "9" },
    issuedAtUnixSeconds: t0,
    expiresAtUnixSeconds: t0 + 900,
  };
  const chCompleted = { ...chPending, state: "COMPLETED" as const, evidence };
  // #123 pairing: a requester challenge (this fixture's subject) is consumed by
  // ITS scope invocation, never by an Approval/Grant.
  const chConsumed = { ...chCompleted, state: "CONSUMED" as const, consumedBy: { kind: "invocation" as const, invocationId: chPending.scope.invocationId } };
  const chExpired = { ...chPending, state: "EXPIRED" as const };

  const apPending = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    approvalId: "app-1",
    state: "PENDING" as const,
    requester: { actorKind: "participant" as const, participant: { participantId: "p-requester" } },
    reviewedScope,
    issuedAtUnixSeconds: t0,
    decisionDeadlineUnixSeconds: t0 + 3600,
  };
  const apApproved = {
    ...apPending,
    state: "APPROVED" as const,
    approver: { actorKind: "participant" as const, participant: { participantId: "p-approver" } },
    decidedAtUnixSeconds: t0 + 600,
    approverEvidence: evidence,
  };
  const apRejected = { ...apApproved, state: "REJECTED" as const };
  const apExpired = { ...apPending, state: "EXPIRED" as const };

  // slice B2 issuance binding (review 2518): scopes source the use limit and
  // the expiry is exactly issuedAt + effective TTL.
  const grUsesScope = {
    ...reviewedScope,
    resolved: {
      ...reviewedScope.resolved,
      controls: { ...reviewedScope.resolved.controls, maxUses: 5 },
      effectiveMaxUses: 5,
    },
  };
  const grActive = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    grantId: "gr-1",
    state: "ACTIVE" as const,
    mode: "SESSION_BOUND" as const,
    reviewedScope: grUsesScope,
    issuedAtUnixSeconds: t0,
    expiresAtUnixSeconds: t0 + 3600, // = issuedAt + effectiveMaxTtlSeconds
    maxUses: 5,
    usedCount: 2,
    approvalRef: { approvalId: "app-1" },
  };
  const grFinalUse = { ...grActive, usedCount: 4 };
  const grUnlimited = (({ maxUses: _m, ...rest }) => rest)({ ...grActive, reviewedScope });
  const grConsumed = {
    ...grActive,
    state: "CONSUMED" as const,
    mode: "SINGLE_USE" as const,
    reviewedScope: scopeWithMode("SINGLE_USE"),
    expiresAtUnixSeconds: t0 + 600, // = issuedAt + the lifetime profile's 600
    maxUses: 1,
    usedCount: 1,
  };
  const grRevoked = { ...grActive, state: "REVOKED" as const, usedCount: 3 };

  const ccIssued = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    continuationId: "cc-1",
    state: "ISSUED" as const,
    requestId: "req-first-001",
    generation: "1",
    account: { accountId: "acct-42" },
    managedAccessSession,
    checkpoint: cpA,
    resource: resourceRef,
    parameterDigest,
    issuedAtUnixSeconds: t0,
    expiresAtUnixSeconds: t0 + 600,
  };
  const ccExpired = { ...ccIssued, state: "EXPIRED" as const };
  const ccInvalidated = { ...ccIssued, state: "INVALIDATED" as const };

  it("exports the frozen denial-reason enum and the four legal-edge tables", () => {
    expect([...TransitionDenialReason]).toEqual([
      "NOT_A_TRANSITION",
      "TERMINAL_STATE",
      "ILLEGAL_EDGE",
      "NOT_YET_EXPIRED",
      "WINDOW_PASSED",
      "NO_USE_LIMIT",
      "NOT_FINAL_USE",
      "EVIDENCE_STALE",
      "EVIDENCE_FUTURE",
    ]);
    // terminal rows are empty — nothing revives
    expect(CHALLENGE_LEGAL_TRANSITIONS.EXPIRED).toEqual([]);
    expect(CHALLENGE_LEGAL_TRANSITIONS.CONSUMED).toEqual([]);
    expect(APPROVAL_LEGAL_TRANSITIONS.REJECTED).toEqual([]);
    expect(APPROVAL_LEGAL_TRANSITIONS.INVALIDATED).toEqual([]);
    expect(GRANT_LEGAL_TRANSITIONS.CONSUMED).toEqual([]);
    expect(CONTINUATION_LEGAL_TRANSITIONS.INVALIDATED).toEqual([]);
  });

  it("challenge: legal edges pass their guards; terminal objects never revive", () => {
    expect(evaluateChallengeTransition(chPending, "COMPLETED", at(t0 + 100))).toEqual({ allowed: true });
    // consume AFTER the evidence exists (t0+500) and inside the 300s window
    expect(evaluateChallengeTransition(chCompleted, "CONSUMED", at(t0 + 600))).toEqual({ allowed: true });
    expect(evaluateChallengeTransition(chPending, "REVOKED", at(t0 + 100))).toEqual({ allowed: true });
    expect(evaluateChallengeTransition(chPending, "PENDING", at(t0 + 100))).toEqual({ allowed: false, reason: "NOT_A_TRANSITION" });
    expect(evaluateChallengeTransition(chConsumed, "PENDING", at(t0 + 100))).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
    expect(evaluateChallengeTransition(chExpired, "COMPLETED", at(t0 + 100))).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
    // PENDING cannot skip straight to CONSUMED (evidence must exist first)
    expect(evaluateChallengeTransition(chPending, "CONSUMED", at(t0 + 100))).toEqual({ allowed: false, reason: "ILLEGAL_EDGE" });
  });

  it("challenge: one clock cannot satisfy both sides of the expiry bound (read from the object)", () => {
    expect(evaluateChallengeTransition(chPending, "EXPIRED", at(t0))).toEqual({ allowed: false, reason: "NOT_YET_EXPIRED" });
    expect(evaluateChallengeTransition(chPending, "COMPLETED", at(late))).toEqual({ allowed: false, reason: "WINDOW_PASSED" });
    expect(evaluateChallengeTransition(chCompleted, "CONSUMED", at(late))).toEqual({ allowed: false, reason: "WINDOW_PASSED" });
    expect(evaluateChallengeTransition(chPending, "EXPIRED", at(late))).toEqual({ allowed: true });
  });

  it("challenge consumption enforces the §9 freshness window even while unexpired (review 2504 High)", () => {
    // evidence at t0+500; window 300s; challenge expires t0+900
    expect(evaluateChallengeTransition(chCompleted, "CONSUMED", at(t0 + 600))).toEqual({ allowed: true }); // age 100
    expect(evaluateChallengeTransition(chCompleted, "CONSUMED", at(t0 + 900))).toEqual({
      allowed: false,
      reason: "EVIDENCE_STALE", // age 400 > 300, challenge itself still unexpired (boundary)
    });
    // no window declared -> only the absolute expiry bounds STALENESS
    const chNoWindow = { ...chCompleted, requirement: { requirement: "REAUTH" as const } };
    expect(evaluateChallengeTransition(chNoWindow, "CONSUMED", at(t0 + 900))).toEqual({ allowed: true });
  });

  it("challenge consumption rejects future-dated evidence unconditionally (review 2505 High)", () => {
    // evidence at t0+500, challenge unexpired; consuming at t0+400 means the
    // authentication claims to have happened in the consumer's future
    expect(evaluateChallengeTransition(chCompleted, "CONSUMED", at(t0 + 400))).toEqual({
      allowed: false,
      reason: "EVIDENCE_FUTURE",
    });
    // the same rejection holds with NO maxAgeSeconds declared — future
    // evidence cannot prove authentication has already happened, window or not
    const chNoWindow = { ...chCompleted, requirement: { requirement: "REAUTH" as const } };
    expect(evaluateChallengeTransition(chNoWindow, "CONSUMED", at(t0 + 400))).toEqual({
      allowed: false,
      reason: "EVIDENCE_FUTURE",
    });
    // at exactly authenticationAt the evidence is current, not future
    expect(evaluateChallengeTransition(chCompleted, "CONSUMED", at(t0 + 500))).toEqual({ allowed: true });
  });

  it("approval: decisions are deadline-bounded; APPROVED stays revocable/invalidatable; decided-terminal objects never revive", () => {
    expect(evaluateApprovalTransition(apPending, "APPROVED", at(t0 + 100))).toEqual({ allowed: true });
    expect(evaluateApprovalTransition(apPending, "REJECTED", at(t0 + 100))).toEqual({ allowed: true });
    expect(evaluateApprovalTransition(apApproved, "REVOKED", at(t0 + 100))).toEqual({ allowed: true });
    expect(evaluateApprovalTransition(apApproved, "INVALIDATED", at(t0 + 100))).toEqual({ allowed: true });
    expect(evaluateApprovalTransition(apPending, "APPROVED", at(late))).toEqual({ allowed: false, reason: "WINDOW_PASSED" });
    expect(evaluateApprovalTransition(apPending, "EXPIRED", at(t0 + 100))).toEqual({ allowed: false, reason: "NOT_YET_EXPIRED" });
    expect(evaluateApprovalTransition(apRejected, "APPROVED", at(t0 + 100))).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
    expect(evaluateApprovalTransition(apExpired, "APPROVED", at(t0 + 100))).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
    expect(evaluateApprovalTransition(apApproved, "REJECTED", at(t0 + 100))).toEqual({ allowed: false, reason: "ILLEGAL_EDGE" });
  });

  it("grant: CONSUMED needs a limit, the final use, and a live window — all read from the grant; end states are terminal", () => {
    expect(evaluateGrantTransition(grFinalUse, "CONSUMED", at(t0 + 100))).toEqual({ allowed: true });
    expect(evaluateGrantTransition(grActive, "CONSUMED", at(t0 + 100))).toEqual({ allowed: false, reason: "NOT_FINAL_USE" });
    expect(evaluateGrantTransition(grUnlimited, "CONSUMED", at(t0 + 100))).toEqual({ allowed: false, reason: "NO_USE_LIMIT" });
    expect(evaluateGrantTransition(grFinalUse, "CONSUMED", at(late))).toEqual({ allowed: false, reason: "WINDOW_PASSED" });
    expect(evaluateGrantTransition(grActive, "EXPIRED", at(t0 + 100))).toEqual({ allowed: false, reason: "NOT_YET_EXPIRED" });
    expect(evaluateGrantTransition(grActive, "EXPIRED", at(late))).toEqual({ allowed: true });
    expect(evaluateGrantTransition(grActive, "REVOKED", at(t0 + 100))).toEqual({ allowed: true });
    // a failed single-use execution does not silently restore the grant
    expect(evaluateGrantTransition(grConsumed, "ACTIVE", at(t0 + 100))).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
    expect(evaluateGrantTransition(grRevoked, "ACTIVE", at(t0 + 100))).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
  });

  it("continuation: ISSUED is the only usable state; an expired handle can never be consumed; nothing revives", () => {
    expect(evaluateConfirmationContinuationTransition(ccIssued, "CONSUMED", at(t0 + 100))).toEqual({ allowed: true });
    expect(evaluateConfirmationContinuationTransition(ccIssued, "INVALIDATED", at(t0 + 100))).toEqual({ allowed: true });
    expect(evaluateConfirmationContinuationTransition(ccIssued, "EXPIRED", at(t0 + 100))).toEqual({ allowed: false, reason: "NOT_YET_EXPIRED" });
    expect(evaluateConfirmationContinuationTransition(ccIssued, "CONSUMED", at(late))).toEqual({ allowed: false, reason: "WINDOW_PASSED" });
    expect(evaluateConfirmationContinuationTransition(ccExpired, "ISSUED", at(t0 + 100))).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
    expect(evaluateConfirmationContinuationTransition(ccInvalidated, "CONSUMED", at(t0 + 100))).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
  });

  it("evaluators are object-aware and fail closed: fabricated guard data has no entry point, invalid objects and clocks throw", () => {
    // the guard inputs are READ FROM the parsed object — there is no parameter
    // through which a caller could supply a different expiry/limit/count
    expect(evaluateGrantTransition(grActive, "CONSUMED", at(t0 + 100))).toEqual({ allowed: false, reason: "NOT_FINAL_USE" });
    // an object that violates its own schema is refused outright
    expect(() => evaluateChallengeTransition({ ...chPending, state: "DONE" as never }, "COMPLETED", at(t0))).toThrow();
    expect(() => evaluateGrantTransition({ ...grActive, usedCount: 9 }, "REVOKED", at(t0))).toThrow();
    expect(() => evaluateApprovalTransition(apPending, "APPROVED", at(-1))).toThrow();
  });
});

/* ================================================================== */

describe("#137 establishing-authority dual form × C2 lifecycles (review 2802: the approval-only round boundary)", () => {
  const { accountToken: _mTok, deviceWorkloadIdentity: _mWl, ...masDeviceRest } = managedAccessSession;
  const masDevice = { ...masDeviceRest, establishment: "device-authenticated" as const };
  const { accountToken: _sTok, deviceWorkloadIdentity: _sWl, ...scopeDeviceRest } = reviewedScope;
  const scopeDevice = {
    ...scopeDeviceRest,
    establishment: "device-authenticated" as const,
    authenticationContext: { authenticationContextId: "auth-001" },
    managedAccessSession: masDevice,
  };

  it("a device-authenticated ReviewedScope rides Approval AND Grant — the APPROVAL leg is open on both paths", () => {
    const pendingDevice = {
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      approvalId: "app-dev-1",
      state: "PENDING" as const,
      requester: { actorKind: "participant" as const, participant: { participantId: "acct-42" } },
      reviewedScope: scopeDevice,
      issuedAtUnixSeconds: 1_700_000_000,
      decisionDeadlineUnixSeconds: 1_700_003_600,
    };
    expect(ApprovalSchema.parse(pendingDevice).state).toBe("PENDING");
    const deviceUsesScope = {
      ...scopeDevice,
      resolved: { ...scopeDevice.resolved, controls: { ...scopeDevice.resolved.controls, maxUses: 5 }, effectiveMaxUses: 5 },
    };
    const grantDevice = {
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      grantId: "gr-dev-1",
      state: "ACTIVE" as const,
      mode: "SESSION_BOUND" as const,
      reviewedScope: deviceUsesScope,
      issuedAtUnixSeconds: 1_700_000_000,
      expiresAtUnixSeconds: 1_700_003_600,
      maxUses: 5,
      usedCount: 0,
      approvalRef: { approvalId: "app-dev-1" },
    };
    expect(AuthorizationGrantSchema.parse(grantDevice).state).toBe("ACTIVE");
  });

  it("a device-authenticated ConfirmationContinuation does NOT parse — the confirmation completion wire is credential-pair-only this round", () => {
    const issuedDevice = {
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      continuationId: "cc-dev-1",
      state: "ISSUED" as const,
      requestId: "req-dev-001",
      generation: "1",
      account: { accountId: "acct-42" },
      managedAccessSession: masDevice,
      checkpoint: cpA,
      resource: resourceRef,
      parameterDigest,
      issuedAtUnixSeconds: 1_700_000_000,
      expiresAtUnixSeconds: 1_700_000_600,
    };
    expect(() => ConfirmationContinuationSchema.parse(issuedDevice)).toThrow(/credential-pair-established/);
    // the credential-pair continuation is untouched by the boundary
    expect(
      ConfirmationContinuationSchema.parse({ ...issuedDevice, continuationId: "cc-cp-1", managedAccessSession }).state,
    ).toBe("ISSUED");
  });
});

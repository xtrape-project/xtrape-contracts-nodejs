import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_CONTRACT_VERSION,
  ExecutionAuthorizationMode,
  ExecutionAuthorizationModeSchema,
  isReusableGrantMode,
  AuthenticationRequirement,
  AuthenticationRequirementSchema,
  authenticationRequirementRank,
  AuthenticationRequirementSpecSchema,
  AuthenticationPolicySchema,
  AuthenticationEvidenceSchema,
  SessionOrChallengeRefSchema,
  CheckpointGroupSchema,
  checkpointGroupKey,
  canonicalizeCheckpointMembers,
  ParticipantRefSchema,
  PolicySubjectSchema,
  BindingTargetSchema,
  RevisionClass,
  RevisionClassSchema,
  ControlRequirementsSchema,
  PolicyBindingSchema,
  policyBindingKey,
  PolicyBindingContributionSchema,
  ResolvedAuthorizationSchema,
} from "../src/index";

/* -------- shared fixtures -------- */

const cpA = { serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: "1.0.0" };
const cpB = { serviceId: "linux-ops-widget-nodejs", checkpointId: "service.restart", checkpointVersion: "1.0.0" };

const resourceRef = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  segments: [
    { type: "host", id: "host-001" },
    { type: "service", id: "nginx" },
  ],
};

const selector = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  segments: [
    { type: "host", match: "exact" as const, id: "host-001" },
    { type: "service", match: "any" as const },
  ],
  matchDescendants: false,
};

const authPolicy = {
  requester: { requirement: "REAUTH" as const, maxAgeSeconds: 300 },
  approver: { requirement: "MFA" as const, maxAgeSeconds: 300 },
};

const controls = { mode: "SINGLE_USE" as const, authentication: authPolicy };

// canonical ascending order by checkpointVersionKey: "…/service.restart@1.0.0"
// (cpB) sorts before "…/service.status@1.0.0" (cpA), so [cpB, cpA] is canonical.
const cpsCanonical = [cpB, cpA];

const group = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  groupId: "grp-restart-set",
  members: cpsCanonical,
  groupRevision: "7",
};

const binding = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  policyId: "pol-sys",
  bindingId: "bind-001",
  subject: { subjectKind: "account" as const, account: { accountId: "acct-42" } },
  target: { targetKind: "checkpoints" as const, checkpoints: cpsCanonical },
  resourceSelector: selector,
  controls,
  revisionClass: "SNAPSHOT_STABLE" as const,
  invalidateDerivedAuthority: false,
  bindingRevision: "4",
  policyRevision: "9",
};

// a snapshot-stable contribution + consistent effective sensitivity.
const contribStable = {
  layer: "policy-binding" as const,
  resolvedThrough: { kind: "direct" as const },
  policyId: "pol-sys",
  bindingId: "bind-001",
  policyRevision: "9",
  bindingRevision: "4",
  revisionClass: "SNAPSHOT_STABLE" as const,
  invalidateDerivedAuthority: false,
};

// the two mandatory deny-by-default axes (review 2520): every non-blocked
// resolution must carry one contribution from each (XOR its blocker).
const entAxis = {
  layer: "account-entitlement" as const,
  entitlementId: "ent-1",
  entitlementRevision: "2",
  revisionClass: "SNAPSHOT_STABLE" as const,
  invalidateDerivedAuthority: false,
  resolvedThrough: { kind: "direct" as const },
};
const expAxis = {
  layer: "system-exposure-rule" as const,
  ruleId: "rule-1",
  ruleRevision: "3",
  revisionClass: "SNAPSHOT_STABLE" as const,
  invalidateDerivedAuthority: false,
  resolvedThrough: { kind: "direct" as const },
};
/** canonical (layer-ordered) contributions: entitlement, then bindings, then exposure. */
const withAxes = (bindings: object[]) => [entAxis, ...bindings, expAxis];

const resolvedExact = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  service: "linux-ops-widget-nodejs",
  checkpoint: cpA, // cpA.serviceId === service ("linux-ops-widget-nodejs") — identity consistent
  resourceBinding: { kind: "exact" as const, resource: resourceRef },
  controls,
  contributions: withAxes([contribStable]),
  effectiveRevisionClass: "SNAPSHOT_STABLE" as const,
  effectiveInvalidateDerivedAuthority: false,
  // slice B2: SINGLE_USE with no policy TTL — the evaluator froze the
  // lifetime profile's value and the mode-invariant use count
  effectiveMaxTtlSeconds: 600,
  ttlProvenance: { source: "lifetime-profile" as const, profileId: "lt-platform-r1", profileRevision: "1" },
  effectiveMaxUses: 1,
};

const resolvedSelector = {
  ...resolvedExact,
  resourceBinding: { kind: "selector" as const, selector },
};

const roundTrip = (schema: { parse: (v: unknown) => unknown }, sample: unknown) => {
  const parsed = schema.parse(sample);
  const round = schema.parse(JSON.parse(JSON.stringify(parsed)));
  expect(round).toEqual(parsed);
  return parsed;
};

/* ================================================================== */

describe("#59 part 2 slice B — ExecutionAuthorizationMode (arch/16 §8)", () => {
  it("has exactly the five §8 modes and accepts each", () => {
    expect(ExecutionAuthorizationMode).toEqual(["AUTO", "TIME_BOUND", "SESSION_BOUND", "SINGLE_USE", "DENY"]);
    for (const m of ExecutionAuthorizationMode) {
      expect(() => ExecutionAuthorizationModeSchema.parse(m)).not.toThrow();
    }
  });

  it("rejects an unknown mode", () => {
    expect(() => ExecutionAuthorizationModeSchema.parse("ALLOW")).toThrow();
    expect(() => ExecutionAuthorizationModeSchema.parse("time_bound")).toThrow();
  });

  it("isReusableGrantMode: true only for TIME_BOUND/SESSION_BOUND (truth table)", () => {
    expect(isReusableGrantMode("AUTO")).toBe(false);
    expect(isReusableGrantMode("TIME_BOUND")).toBe(true);
    expect(isReusableGrantMode("SESSION_BOUND")).toBe(true);
    expect(isReusableGrantMode("SINGLE_USE")).toBe(false);
    expect(isReusableGrantMode("DENY")).toBe(false);
  });

  it("isReusableGrantMode fails closed on an illegal value", () => {
    expect(() => isReusableGrantMode("ALLOW" as never)).toThrow();
  });
});

describe("#59 part 2 slice B — AuthenticationRequirement (arch/16 §9)", () => {
  it("has exactly NONE/REAUTH/MFA and accepts each", () => {
    expect(AuthenticationRequirement).toEqual(["NONE", "REAUTH", "MFA"]);
    for (const r of AuthenticationRequirement) {
      expect(() => AuthenticationRequirementSchema.parse(r)).not.toThrow();
    }
  });

  it("rejects an unknown requirement", () => {
    expect(() => AuthenticationRequirementSchema.parse("PASSKEY")).toThrow();
  });

  it("authenticationRequirementRank is the frozen total order NONE<REAUTH<MFA", () => {
    expect(authenticationRequirementRank("NONE")).toBe(0);
    expect(authenticationRequirementRank("REAUTH")).toBe(1);
    expect(authenticationRequirementRank("MFA")).toBe(2);
    expect(authenticationRequirementRank("NONE")).toBeLessThan(authenticationRequirementRank("REAUTH"));
    expect(authenticationRequirementRank("REAUTH")).toBeLessThan(authenticationRequirementRank("MFA"));
  });

  it("authenticationRequirementRank fails closed on an illegal value", () => {
    expect(() => authenticationRequirementRank("PASSKEY" as never)).toThrow();
  });
});

describe("#59 part 2 slice B — AuthenticationRequirementSpec (§9 freshness window)", () => {
  it("round-trips with and without a freshness window", () => {
    roundTrip(AuthenticationRequirementSpecSchema, { requirement: "REAUTH", maxAgeSeconds: 300 });
    roundTrip(AuthenticationRequirementSpecSchema, { requirement: "NONE" });
  });

  it("accepts a large real-seconds window (86400 = one day) — seconds, not a version tick", () => {
    expect(() => AuthenticationRequirementSpecSchema.parse({ requirement: "MFA", maxAgeSeconds: 86400 })).not.toThrow();
  });

  it("rejects a negative freshness window and an unknown field", () => {
    expect(() => AuthenticationRequirementSpecSchema.parse({ requirement: "MFA", maxAgeSeconds: -1 })).toThrow();
    expect(() => AuthenticationRequirementSpecSchema.parse({ requirement: "MFA", extra: 1 })).toThrow();
  });

  it("(Med1) maxAgeSeconds is bounded to Number.MAX_SAFE_INTEGER (JSON-number-safe)", () => {
    expect(() =>
      AuthenticationRequirementSpecSchema.parse({ requirement: "MFA", maxAgeSeconds: Number.MAX_SAFE_INTEGER }),
    ).not.toThrow();
    expect(() =>
      AuthenticationRequirementSpecSchema.parse({ requirement: "MFA", maxAgeSeconds: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
  });
});

describe("#59 part 2 slice B — AuthenticationPolicy (§9 requester/approver)", () => {
  it("round-trips with and without an approver", () => {
    roundTrip(AuthenticationPolicySchema, authPolicy);
    roundTrip(AuthenticationPolicySchema, { requester: { requirement: "NONE" } });
  });

  it("requires a requester and rejects an unknown field", () => {
    expect(() => AuthenticationPolicySchema.parse({ approver: { requirement: "MFA" } })).toThrow();
    expect(() => AuthenticationPolicySchema.parse({ ...authPolicy, extra: 1 })).toThrow();
  });
});

describe("#59 part 2 slice B — AuthenticationEvidence (§9)", () => {
  const evidence = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    level: "MFA" as const,
    methodClass: "webauthn-platform",
    authenticationAtUnixSeconds: 1_700_000_000,
    sessionOrChallenge: { kind: "challenge" as const, challengeId: "chal-001" },
    deviceInstance: { deviceType: "xtrape-mcp", deviceInstanceId: "di-001" },
  };

  it("round-trips full evidence", () => {
    roundTrip(AuthenticationEvidenceSchema, evidence);
  });

  it("methodClass is a free string, not an enum (a novel class is accepted)", () => {
    expect(() => AuthenticationEvidenceSchema.parse({ ...evidence, methodClass: "future-quantum-auth" })).not.toThrow();
  });

  it("rejects a non-authoritative level outside the enum, a negative time, and an unknown field", () => {
    expect(() => AuthenticationEvidenceSchema.parse({ ...evidence, level: "PASSKEY" })).toThrow();
    expect(() => AuthenticationEvidenceSchema.parse({ ...evidence, authenticationAtUnixSeconds: -1 })).toThrow();
    expect(() => AuthenticationEvidenceSchema.parse({ ...evidence, extra: 1 })).toThrow();
  });

  it("(Med2) carries contractVersion and rejects a wrong literal / missing it", () => {
    expect(AuthenticationEvidenceSchema.parse(evidence).contractVersion).toBe(CHECKPOINT_CONTRACT_VERSION);
    expect(() => AuthenticationEvidenceSchema.parse({ ...evidence, contractVersion: 2 })).toThrow();
    const { contractVersion: _drop, ...noVersion } = evidence;
    expect(() => AuthenticationEvidenceSchema.parse(noVersion)).toThrow();
  });

  it("(Med1) authenticationAtUnixSeconds is bounded to Number.MAX_SAFE_INTEGER", () => {
    expect(() =>
      AuthenticationEvidenceSchema.parse({ ...evidence, authenticationAtUnixSeconds: Number.MAX_SAFE_INTEGER }),
    ).not.toThrow();
    expect(() =>
      AuthenticationEvidenceSchema.parse({ ...evidence, authenticationAtUnixSeconds: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
  });

  it("(Med3) session and challenge variants round-trip; unknown kind and hybrid rejected", () => {
    roundTrip(SessionOrChallengeRefSchema, { kind: "session", sessionId: "sess-1" });
    roundTrip(SessionOrChallengeRefSchema, { kind: "challenge", challengeId: "chal-1" });
    roundTrip(AuthenticationEvidenceSchema, { ...evidence, sessionOrChallenge: { kind: "session", sessionId: "sess-1" } });
    // unknown kind rejected
    expect(() => SessionOrChallengeRefSchema.parse({ kind: "token", tokenId: "t-1" })).toThrow();
    // hybrid: a "session" kind must not carry a challengeId (strict closed arm)
    expect(() => SessionOrChallengeRefSchema.parse({ kind: "session", challengeId: "chal-1" })).toThrow();
    expect(() =>
      SessionOrChallengeRefSchema.parse({ kind: "session", sessionId: "sess-1", challengeId: "chal-1" }),
    ).toThrow();
  });
});

describe("#59 part 2 slice B — CheckpointGroup (arch/16 §2/§7.1)", () => {
  it("round-trips a valid group", () => {
    roundTrip(CheckpointGroupSchema, group);
  });

  it("carries contractVersion and rejects a wrong literal / missing it", () => {
    expect(CheckpointGroupSchema.parse(group).contractVersion).toBe(CHECKPOINT_CONTRACT_VERSION);
    expect(() => CheckpointGroupSchema.parse({ ...group, contractVersion: 2 })).toThrow();
    const { contractVersion: _drop, ...noVersion } = group;
    expect(() => CheckpointGroupSchema.parse(noVersion)).toThrow();
  });

  it("rejects empty members", () => {
    expect(() => CheckpointGroupSchema.parse({ ...group, members: [] })).toThrow();
  });

  it("rejects duplicate members (by canonical checkpointVersionKey)", () => {
    expect(() => CheckpointGroupSchema.parse({ ...group, members: [cpA, cpA] })).toThrow();
  });

  it("(Med4) rejects members not in canonical ascending order (reject-not-sort)", () => {
    // [cpA, cpB] = [status, restart] is DESCENDING by checkpointVersionKey.
    expect(() => CheckpointGroupSchema.parse({ ...group, members: [cpA, cpB] })).toThrow();
    // canonical order accepted.
    expect(() => CheckpointGroupSchema.parse({ ...group, members: [cpB, cpA] })).not.toThrow();
  });

  it("(Med4) canonicalizeCheckpointMembers sorts + dedups to schema-valid ascending output", () => {
    const out = canonicalizeCheckpointMembers([cpA, cpB, cpA]);
    expect(out).toEqual([cpB, cpA]); // deduped + ascending
    // output satisfies the schema's canonical-order invariant.
    expect(() => CheckpointGroupSchema.parse({ ...group, members: out })).not.toThrow();
    // fails closed on the input (empty / malformed rejected).
    expect(() => canonicalizeCheckpointMembers([])).toThrow();
    expect(() => canonicalizeCheckpointMembers([{ serviceId: "svc_ops", checkpointId: "a", checkpointVersion: "1.0.0" }] as never)).toThrow();
  });

  it("rejects an unknown field (strict, closed surface)", () => {
    expect(() => CheckpointGroupSchema.parse({ ...group, extra: true })).toThrow();
  });

  it("checkpointGroupKey is stable, fails closed, and distinguishes revisions", () => {
    expect(checkpointGroupKey(group)).toBe(checkpointGroupKey(CheckpointGroupSchema.parse(group)));
    expect(checkpointGroupKey(group)).not.toBe(checkpointGroupKey({ ...group, groupRevision: "8" }));
    expect(() => checkpointGroupKey({ ...group, members: [] } as never)).toThrow();
  });
});

describe("#59 part 2 slice B — PolicySubject (arch/16 §7.1 closed union)", () => {
  const subjects = [
    { subjectKind: "account" as const, account: { accountId: "acct-42" } },
    { subjectKind: "participant" as const, participant: { participantId: "p-1" } },
    { subjectKind: "organization" as const, organizationId: "org-1" },
    { subjectKind: "deviceInstance" as const, deviceInstance: { deviceType: "cli", deviceInstanceId: "di-1" } },
    { subjectKind: "resourceSelector" as const, resourceSelector: selector },
  ];

  it("round-trips each subject kind", () => {
    for (const s of subjects) roundTrip(PolicySubjectSchema, s);
  });

  it("(High3) ParticipantRef round-trips as a minimal invocation-relative id ref", () => {
    roundTrip(ParticipantRefSchema, { participantId: "p-1" });
    // NO fixed USER/AGENT/SYSTEM label field is allowed (strict, closed).
    expect(() => ParticipantRefSchema.parse({ participantId: "p-1", principalType: "AGENT" })).toThrow();
  });

  it("(High3) participant branch is a ParticipantRef, NOT a PrincipalRef (rejects a stray principalType)", () => {
    expect(() =>
      PolicySubjectSchema.parse({ subjectKind: "participant", participant: { participantId: "p-1" } }),
    ).not.toThrow();
    // a PrincipalRef-shaped subject (fixed type label) must be rejected.
    expect(() =>
      PolicySubjectSchema.parse({
        subjectKind: "participant",
        participant: { principalType: "AGENT", principalId: "p-1" },
      }),
    ).toThrow();
    expect(() =>
      PolicySubjectSchema.parse({
        subjectKind: "participant",
        participant: { participantId: "p-1", principalType: "AGENT" },
      }),
    ).toThrow();
  });

  it("rejects an unknown subjectKind branch", () => {
    expect(() => PolicySubjectSchema.parse({ subjectKind: "role", roleId: "r-1" })).toThrow();
  });

  it("rejects a hybrid/mixed subject (fields from two branches)", () => {
    expect(() =>
      PolicySubjectSchema.parse({ subjectKind: "account", account: { accountId: "a-1" }, organizationId: "org-1" }),
    ).toThrow();
  });
});

describe("#59 part 2 slice B — BindingTarget (arch/16 §7.1 closed union)", () => {
  it("round-trips a group target and a checkpoints target", () => {
    roundTrip(BindingTargetSchema, { targetKind: "group", groupRef: "grp-1", groupRevision: "3" });
    roundTrip(BindingTargetSchema, { targetKind: "checkpoints", checkpoints: cpsCanonical });
  });

  it("(High2) group target requires groupRevision (exact resolved group version)", () => {
    expect(() => BindingTargetSchema.parse({ targetKind: "group", groupRef: "grp-1" })).toThrow();
  });

  it("rejects an unknown targetKind branch", () => {
    expect(() => BindingTargetSchema.parse({ targetKind: "service", serviceId: "linux-ops-widget-nodejs" })).toThrow();
  });

  it("rejects a hybrid/mixed target", () => {
    expect(() =>
      BindingTargetSchema.parse({ targetKind: "group", groupRef: "grp-1", groupRevision: "3", checkpoints: [cpA] }),
    ).toThrow();
  });

  it("rejects empty, duplicate, and non-canonical-order checkpoints (Med4)", () => {
    expect(() => BindingTargetSchema.parse({ targetKind: "checkpoints", checkpoints: [] })).toThrow();
    expect(() => BindingTargetSchema.parse({ targetKind: "checkpoints", checkpoints: [cpA, cpA] })).toThrow();
    // [cpA, cpB] = descending by key -> rejected (reject-not-sort).
    expect(() => BindingTargetSchema.parse({ targetKind: "checkpoints", checkpoints: [cpA, cpB] })).toThrow();
  });
});

describe("#59 part 2 slice B — RevisionClass + ControlRequirements", () => {
  it("RevisionClass has exactly SNAPSHOT_STABLE/REVOCATION_SENSITIVE", () => {
    expect(RevisionClass).toEqual(["SNAPSHOT_STABLE", "REVOCATION_SENSITIVE"]);
    for (const c of RevisionClass) expect(() => RevisionClassSchema.parse(c)).not.toThrow();
    expect(() => RevisionClassSchema.parse("MUTABLE")).toThrow();
  });

  it("ControlRequirements round-trips and rejects unknown control sub-structures (not frozen here)", () => {
    roundTrip(ControlRequirementsSchema, controls);
    expect(() => ControlRequirementsSchema.parse({ ...controls, rateLimit: { perMinute: 5 } })).toThrow();
  });
});

describe("#59 part 2 slice B — PolicyBinding (arch/16 §7.1)", () => {
  it("round-trips a full binding", () => {
    roundTrip(PolicyBindingSchema, binding);
  });

  it("round-trips with the optional resourceSelector omitted", () => {
    const { resourceSelector: _drop, ...noSelector } = binding;
    roundTrip(PolicyBindingSchema, noSelector);
  });

  it("carries contractVersion and rejects a wrong literal", () => {
    expect(() => PolicyBindingSchema.parse({ ...binding, contractVersion: 2 })).toThrow();
  });

  it("accepts each subject kind and each target kind", () => {
    const subjects = [
      { subjectKind: "account" as const, account: { accountId: "acct-42" } },
      { subjectKind: "participant" as const, participant: { participantId: "p-1" } },
      { subjectKind: "organization" as const, organizationId: "org-1" },
      { subjectKind: "deviceInstance" as const, deviceInstance: { deviceType: "cli", deviceInstanceId: "di-1" } },
      { subjectKind: "resourceSelector" as const, resourceSelector: selector },
    ];
    for (const subject of subjects) expect(() => PolicyBindingSchema.parse({ ...binding, subject })).not.toThrow();
    for (const target of [
      { targetKind: "group" as const, groupRef: "grp-1", groupRevision: "3" },
      { targetKind: "checkpoints" as const, checkpoints: cpsCanonical },
    ]) {
      expect(() => PolicyBindingSchema.parse({ ...binding, target })).not.toThrow();
    }
  });

  it("accepts both revisionClass values and both invalidateDerivedAuthority booleans", () => {
    for (const revisionClass of RevisionClass) {
      for (const invalidateDerivedAuthority of [true, false]) {
        expect(() => PolicyBindingSchema.parse({ ...binding, revisionClass, invalidateDerivedAuthority })).not.toThrow();
      }
    }
  });

  it("rejects a negative revision counter and an unknown field", () => {
    expect(() => PolicyBindingSchema.parse({ ...binding, bindingRevision: -1 })).toThrow();
    expect(() => PolicyBindingSchema.parse({ ...binding, policyRevision: 1.5 } as never)).toThrow(); // a JS number is rejected (RevisionSchema is a decimal string)
    expect(() => PolicyBindingSchema.parse({ ...binding, policyRevision: "01" } as never)).toThrow(); // leading zero rejected
    expect(() => PolicyBindingSchema.parse({ ...binding, extra: true })).toThrow();
  });

  it("policyBindingKey is stable, fails closed, and distinguishes revisions", () => {
    expect(policyBindingKey(binding)).toBe(policyBindingKey(PolicyBindingSchema.parse(binding)));
    expect(policyBindingKey(binding)).not.toBe(policyBindingKey({ ...binding, bindingRevision: "5" }));
    expect(policyBindingKey(binding)).not.toBe(policyBindingKey({ ...binding, policyRevision: "10" }));
    expect(() => policyBindingKey({ ...binding, bindingRevision: -1 } as never)).toThrow();
  });
});

describe("#59 part 2 slice B — ResolvedAuthorization (arch/16 §7.1)", () => {
  it("round-trips an exact resourceBinding and a selector resourceBinding", () => {
    roundTrip(ResolvedAuthorizationSchema, resolvedExact);
    roundTrip(ResolvedAuthorizationSchema, resolvedSelector);
  });

  it("carries contractVersion and rejects a wrong literal", () => {
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedExact, contractVersion: 2 })).toThrow();
  });

  it("rejects a legacy svc_* service id", () => {
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedExact, service: "svc_ops" })).toThrow();
  });

  it("rejects mixing exact + selector in resourceBinding (closed union)", () => {
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...resolvedExact,
        resourceBinding: { kind: "exact", resource: resourceRef, selector },
      }),
    ).toThrow();
    expect(() =>
      ResolvedAuthorizationSchema.parse({ ...resolvedExact, resourceBinding: { kind: "both", resource: resourceRef } }),
    ).toThrow();
  });

  it("rejects an unknown field (strict, closed surface)", () => {
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedExact, extra: true })).toThrow();
  });

  it("(High1) rejects checkpoint.serviceId != service; accepts when equal", () => {
    // checkpoint names a different service than `service` — identity forks.
    const forked = { ...resolvedExact, checkpoint: { ...cpA, serviceId: "ops-windows" } };
    expect(() => ResolvedAuthorizationSchema.parse(forked)).toThrow();
    // equal -> accepted (baseline fixture already has them equal).
    expect(() => ResolvedAuthorizationSchema.parse(resolvedExact)).not.toThrow();
  });

  it("(High2) rejects contributions not in strict ascending order by bindingId, and duplicates", () => {
    const c1 = { ...contribStable, bindingId: "bind-001" };
    const c2 = { ...contribStable, bindingId: "bind-002" };
    // ascending accepted
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedExact, contributions: withAxes([c1, c2]) })).not.toThrow();
    // descending rejected
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedExact, contributions: withAxes([c2, c1]) })).toThrow();
    // duplicate rejected (not strictly increasing)
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedExact, contributions: withAxes([c1, c1]) })).toThrow();
  });

  it("(High-policyId) provenance carries policyId; same bindingId under two policies is distinct and orderable", () => {
    // same bindingId + same revision, DIFFERENT policy — must be representable and distinguishable.
    const a = { ...contribStable, policyId: "pol-account", bindingId: "bind-001", policyRevision: "9" };
    const b = { ...contribStable, policyId: "pol-system", bindingId: "bind-001", policyRevision: "9" };
    // composite (policyId, bindingId) ascending: "pol-account.." < "pol-system.." → [a,b] accepted
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedExact, contributions: withAxes([a, b]) })).not.toThrow();
    // reversed rejected by the composite ordering
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedExact, contributions: withAxes([b, a]) })).toThrow();
    // the two bindings' keys differ despite identical bindingId + revisions
    expect(policyBindingKey({ ...binding, policyId: "pol-account" })).not.toBe(
      policyBindingKey({ ...binding, policyId: "pol-system" }),
    );
  });

  it("(High-policyId) rejects a resolved contribution missing policyId", () => {
    const { policyId, ...noPolicy } = contribStable;
    void policyId;
    expect(() => PolicyBindingContributionSchema.parse(noPolicy as never)).toThrow();
    expect(() =>
      ResolvedAuthorizationSchema.parse({ ...resolvedExact, contributions: [noPolicy] } as never),
    ).toThrow();
    // PolicyBinding likewise requires policyId
    const { policyId: _p, ...bindingNoPolicy } = binding;
    void _p;
    expect(() => PolicyBindingSchema.parse(bindingNoPolicy as never)).toThrow();
  });

  it("(High4) an invalidateDerivedAuthority contribution cannot resolve to a non-invalidating effective flag", () => {
    const contribInvalidate = { ...contribStable, invalidateDerivedAuthority: true };
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...resolvedExact,
        contributions: withAxes([contribInvalidate]),
        effectiveRevisionClass: "REVOCATION_SENSITIVE",
        effectiveInvalidateDerivedAuthority: false, // must be true -> rejected
      }),
    ).toThrow();
  });

  it("(High4) a REVOCATION_SENSITIVE contribution cannot resolve to SNAPSHOT_STABLE effective class", () => {
    const contribSensitive = { ...contribStable, revisionClass: "REVOCATION_SENSITIVE" as const };
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...resolvedExact,
        contributions: withAxes([contribSensitive]),
        effectiveRevisionClass: "SNAPSHOT_STABLE", // must be REVOCATION_SENSITIVE -> rejected
        effectiveInvalidateDerivedAuthority: true,
      }),
    ).toThrow();
  });

  it("(High4) the consistent revocation-sensitive resolution is accepted", () => {
    const contribSensitive = { ...contribStable, revisionClass: "REVOCATION_SENSITIVE" as const, invalidateDerivedAuthority: true };
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...resolvedExact,
        contributions: withAxes([contribSensitive]),
        effectiveRevisionClass: "REVOCATION_SENSITIVE",
        effectiveInvalidateDerivedAuthority: true,
      }),
    ).not.toThrow();
  });

  it("(High2/2520) PolicyBindingContribution resolves direct XOR through a group (closed union — the group path cannot drop its revision), and carries NO contractVersion", () => {
    roundTrip(PolicyBindingContributionSchema, contribStable); // resolvedThrough: direct
    roundTrip(PolicyBindingContributionSchema, {
      ...contribStable,
      resolvedThrough: { kind: "group", groupRef: "grp-1", groupRevision: "7" },
    });
    // the old optional-group spelling is gone: a bare `group` is an unknown field…
    expect(() =>
      PolicyBindingContributionSchema.parse({ ...contribStable, group: { groupRef: "grp-1", groupRevision: "7" } }),
    ).toThrow();
    // …and a group WITHOUT its exact revision does not parse (2519's freeze, now contract-guaranteed)
    expect(() =>
      PolicyBindingContributionSchema.parse({ ...contribStable, resolvedThrough: { kind: "group", groupRef: "grp-1" } }),
    ).toThrow();
    // it is a sub-record, not a top-level document -> contractVersion is an unknown field.
    expect(() =>
      PolicyBindingContributionSchema.parse({ ...contribStable, contractVersion: CHECKPOINT_CONTRACT_VERSION }),
    ).toThrow();
  });
});

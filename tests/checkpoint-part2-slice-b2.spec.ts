import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_CONTRACT_VERSION,
  ControlRequirementsSchema,
  ResolvedAuthorizationSchema,
  SystemExposureRuleSchema,
  systemExposureRuleKey,
  AccountEntitlementSchema,
  accountEntitlementKey,
  type SystemExposureRule,
  type AccountEntitlement,
} from "../src/index";

/* -------- shared fixtures -------- */

const cpA = { serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: "1.0.0" };

const authentication = {
  requester: { requirement: "REAUTH" as const, maxAgeSeconds: 300 },
};

const resourceRef = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  segments: [{ type: "host", id: "host-001" }],
};

const contrib = {
  layer: "policy-binding" as const,
  policyId: "pol-sys",
  bindingId: "bind-001",
  policyRevision: "9",
  bindingRevision: "4",
  revisionClass: "SNAPSHOT_STABLE" as const,
  invalidateDerivedAuthority: false,
  resolvedThrough: { kind: "direct" as const },
};

// the two mandatory deny-by-default axes (review 2520)
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

const resolvedBase = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  service: "linux-ops-widget-nodejs",
  checkpoint: cpA,
  resourceBinding: { kind: "exact" as const, resource: resourceRef },
  contributions: [entAxis, contrib, expAxis],
  effectiveRevisionClass: "SNAPSHOT_STABLE" as const,
  effectiveInvalidateDerivedAuthority: false,
};

const roundTrip = (schema: { parse: (v: unknown) => unknown }, sample: unknown) => {
  const parsed = schema.parse(sample);
  const round = schema.parse(JSON.parse(JSON.stringify(parsed)));
  expect(round).toEqual(parsed);
  return parsed;
};

/* ================================================================== */

describe("slice B2 — ControlRequirements lifetime/use-count carriers (§5/§8)", () => {
  it("TIME_BOUND and SESSION_BOUND REQUIRE maxTtlSeconds; carrying one round-trips", () => {
    for (const mode of ["TIME_BOUND", "SESSION_BOUND"] as const) {
      roundTrip(ControlRequirementsSchema, { mode, authentication, maxTtlSeconds: 3600 });
      expect(() => ControlRequirementsSchema.parse({ mode, authentication })).toThrow(/requires maxTtlSeconds/);
    }
  });

  it("SINGLE_USE: maxTtlSeconds optional; maxUses when present is exactly 1", () => {
    roundTrip(ControlRequirementsSchema, { mode: "SINGLE_USE", authentication });
    roundTrip(ControlRequirementsSchema, { mode: "SINGLE_USE", authentication, maxTtlSeconds: 600, maxUses: 1 });
    expect(() => ControlRequirementsSchema.parse({ mode: "SINGLE_USE", authentication, maxUses: 2 })).toThrow(
      /exactly 1/,
    );
  });

  it("AUTO/DENY carry NEITHER (no grant is minted — nothing to bound)", () => {
    for (const mode of ["AUTO", "DENY"] as const) {
      roundTrip(ControlRequirementsSchema, { mode, authentication });
      expect(() => ControlRequirementsSchema.parse({ mode, authentication, maxTtlSeconds: 60 })).toThrow(/cannot carry/);
      expect(() => ControlRequirementsSchema.parse({ mode, authentication, maxUses: 3 })).toThrow(/cannot carry/);
    }
  });

  it("reusable modes may carry a use limit (§8 'deadline or use limit')", () => {
    roundTrip(ControlRequirementsSchema, { mode: "TIME_BOUND", authentication, maxTtlSeconds: 3600, maxUses: 5 });
  });
});

/* ================================================================== */

describe("slice B2 — ResolvedAuthorization effective lifetime/use fields", () => {
  const controlsSession = { mode: "SESSION_BOUND" as const, authentication, maxTtlSeconds: 3600 };
  const resolvedSession = {
    ...resolvedBase,
    controls: controlsSession,
    effectiveMaxTtlSeconds: 3600,
    ttlProvenance: { source: "policy" as const },
  };
  const controlsSingle = { mode: "SINGLE_USE" as const, authentication };
  const resolvedSingleDefault = {
    ...resolvedBase,
    controls: controlsSingle,
    effectiveMaxTtlSeconds: 600,
    ttlProvenance: { source: "lifetime-profile" as const, profileId: "lt-platform-r1", profileRevision: "1" },
    effectiveMaxUses: 1,
  };

  it("round-trips the policy-sourced and lifetime-profile-sourced forms", () => {
    roundTrip(ResolvedAuthorizationSchema, resolvedSession);
    roundTrip(ResolvedAuthorizationSchema, resolvedSingleDefault);
  });

  it("every grant-minting mode REQUIRES the effective TTL; AUTO/DENY forbid all three fields", () => {
    const { effectiveMaxTtlSeconds: _t, ttlProvenance: _p, ...missing } = resolvedSession;
    void _t; void _p;
    expect(() => ResolvedAuthorizationSchema.parse(missing)).toThrow(/requires effectiveMaxTtlSeconds/);
    const auto = { ...resolvedBase, controls: { mode: "AUTO" as const, authentication } };
    roundTrip(ResolvedAuthorizationSchema, auto);
    expect(() =>
      ResolvedAuthorizationSchema.parse({ ...auto, effectiveMaxTtlSeconds: 60, ttlProvenance: { source: "policy" } }),
    ).toThrow(/cannot carry/);
    expect(() => ResolvedAuthorizationSchema.parse({ ...auto, effectiveMaxUses: 1 })).toThrow(/cannot carry/);
  });

  it("TTL and its provenance travel together", () => {
    const { ttlProvenance: _p, ...noProv } = resolvedSession;
    void _p;
    expect(() => ResolvedAuthorizationSchema.parse(noProv)).toThrow(/travel together/);
  });

  it("a TTL stated by the resolved controls is policy-sourced and equal; a controls-less TTL is profile-sourced", () => {
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedSession, effectiveMaxTtlSeconds: 1800 })).toThrow(
      /must equal controls.maxTtlSeconds/,
    );
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...resolvedSession,
        ttlProvenance: { source: "lifetime-profile", profileId: "lt-platform-r1", profileRevision: "1" },
      }),
    ).toThrow(/provenance `policy`/);
    expect(() =>
      ResolvedAuthorizationSchema.parse({ ...resolvedSingleDefault, ttlProvenance: { source: "policy" } }),
    ).toThrow(/lifetime profile/);
  });

  it("SINGLE_USE freezes effectiveMaxUses to exactly 1 — even with no policy maxUses (A1-v4)", () => {
    const { effectiveMaxUses: _u, ...missing } = resolvedSingleDefault;
    void _u;
    expect(() => ResolvedAuthorizationSchema.parse(missing)).toThrow(/exactly 1/);
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedSingleDefault, effectiveMaxUses: 2 })).toThrow(
      /exactly 1/,
    );
  });

  it("a reusable-mode use limit needs a policy source: controls.maxUses absent ⇔ effectiveMaxUses absent (review 2518 Medium)", () => {
    expect(() => ResolvedAuthorizationSchema.parse({ ...resolvedSession, effectiveMaxUses: 3 })).toThrow(
      /has no source/,
    );
  });

  it("contributions are a CLOSED per-layer union: exposure-rule and entitlement provenance carry their own identity, revision, and invalidation (review 2518 High)", () => {
    const layered = {
      ...resolvedSession,
      contributions: [entAxis, contrib, expAxis],
    };
    roundTrip(ResolvedAuthorizationSchema, layered);
    // canonical order is by (layer, identity) — swapping two entries fails
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...layered,
        contributions: [layered.contributions[1], layered.contributions[0], layered.contributions[2]],
      }),
    ).toThrow(/strict ascending/);
    // an exposure-rule's OWN revocation sensitivity enters no-lost-invalidation
    const sensitiveRule = {
      ...layered,
      contributions: [entAxis, contrib, { ...expAxis, revisionClass: "REVOCATION_SENSITIVE" as const }],
    };
    expect(() => ResolvedAuthorizationSchema.parse(sensitiveRule)).toThrow(/REVOCATION_SENSITIVE/);
    roundTrip(ResolvedAuthorizationSchema, {
      ...sensitiveRule,
      effectiveRevisionClass: "REVOCATION_SENSITIVE" as const,
      effectiveInvalidateDerivedAuthority: true,
    });
    // a fourth, undeclared layer does not parse (closed union)
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...resolvedSession,
        contributions: [{ layer: "organization-policy", orgId: "o-1", revisionClass: "SNAPSHOT_STABLE", invalidateDerivedAuthority: false }],
      }),
    ).toThrow();
  });

  it("deny-by-absence is expressible without forging provenance: empty baseline → blockers + DENY (review 2519 High)", () => {
    const denyControls = { mode: "DENY" as const, authentication: { requester: { requirement: "NONE" as const } } };
    const blocked = {
      ...resolvedBase,
      controls: denyControls,
      contributions: [],
      resolutionBlockers: [
        { axis: "account-entitlement" as const, reason: "no-matching-row" as const },
        { axis: "system-exposure" as const, reason: "no-matching-rule" as const },
      ],
    };
    roundTrip(ResolvedAuthorizationSchema, blocked);
    // silence is not expressible: no contributions AND no blockers now fails
    // PER AXIS (the 2520 XOR subsumed the 2519 blanket check)
    expect(() => ResolvedAuthorizationSchema.parse({ ...blocked, resolutionBlockers: undefined })).toThrow(
      /axis is unaccounted for/,
    );
    // absence can only deny
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...blocked,
        controls: { mode: "SESSION_BOUND", authentication, maxTtlSeconds: 3600 },
        effectiveMaxTtlSeconds: 3600,
        ttlProvenance: { source: "policy" },
      }),
    ).toThrow(/absence can only deny/);
    // canonical order + dedup on the blockers themselves
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...blocked,
        resolutionBlockers: [...blocked.resolutionBlockers].reverse(),
      }),
    ).toThrow(/strict ascending order by axis/);
    // a blocker with real contributions is legal too (entitlement + binding
    // matched, but the exposure axis was empty — the deny names its true cause)
    roundTrip(ResolvedAuthorizationSchema, {
      ...blocked,
      contributions: [entAxis, contrib],
      resolutionBlockers: [{ axis: "system-exposure" as const, reason: "no-matching-rule" as const }],
    });
  });

  it("每个 mandatory axis:真实 contribution XOR absence blocker(review 2520 High)", () => {
    // omitting the exposure axis entirely — no contribution, no blocker — is
    // an authority-widening hole and does not parse
    expect(() =>
      ResolvedAuthorizationSchema.parse({ ...resolvedSession, contributions: [entAxis, contrib] }),
    ).toThrow(/mandatory system-exposure axis is unaccounted for/);
    expect(() =>
      ResolvedAuthorizationSchema.parse({ ...resolvedSession, contributions: [contrib, expAxis] }),
    ).toThrow(/mandatory account-entitlement axis is unaccounted for/);
    // one axis, one truth: a matched axis cannot also claim nothing matched
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...resolvedSession,
        controls: { mode: "DENY", authentication },
        effectiveMaxTtlSeconds: undefined,
        ttlProvenance: undefined,
        resolutionBlockers: [{ axis: "system-exposure", reason: "no-matching-rule" }],
      }),
    ).toThrow(/one axis, one truth/);
  });

  it("exposure-rule and entitlement contributions freeze the exact group revision when resolved through a group (review 2519 Medium)", () => {
    const throughGroup = { kind: "group" as const, groupRef: "grp-diagnostics", groupRevision: "2" };
    const layered = {
      ...resolvedSession,
      contributions: [
        { ...entAxis, resolvedThrough: throughGroup },
        { ...expAxis, resolvedThrough: throughGroup },
      ],
    };
    roundTrip(ResolvedAuthorizationSchema, layered);
    // resolvedThrough is a CLOSED union (review 2520 Medium): direct XOR group,
    // and the group spelling cannot drop its exact revision
    expect(() =>
      ResolvedAuthorizationSchema.parse({
        ...layered,
        contributions: [
          layered.contributions[0],
          { ...expAxis, resolvedThrough: { kind: "group", groupRef: "grp-diagnostics" } },
        ],
      }),
    ).toThrow();
    // …and omitting resolvedThrough entirely does not parse either (required field)
    const { resolvedThrough: _rt, ...bare } = expAxis;
    void _rt;
    expect(() =>
      ResolvedAuthorizationSchema.parse({ ...layered, contributions: [layered.contributions[0], bare] }),
    ).toThrow();
  });

  it("effectiveMaxUses equals controls.maxUses when the controls state one (min already folded into controls)", () => {
    const withUses = {
      ...resolvedSession,
      controls: { ...controlsSession, maxUses: 5 },
      effectiveMaxUses: 5,
    };
    roundTrip(ResolvedAuthorizationSchema, withUses);
    expect(() => ResolvedAuthorizationSchema.parse({ ...withUses, effectiveMaxUses: 3 })).toThrow(
      /must equal controls.maxUses/,
    );
  });
});

/* ================================================================== */

describe("slice B2 — System Exposure Rule minimal baseline (§5)", () => {
  const rule: SystemExposureRule = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    ruleId: "rule-1",
    target: { targetKind: "checkpoints", checkpoints: [cpA] },
    deviceTypes: ["xtrape-mcp", "xtrape-panel"],
    accounts: [{ accountId: "acct-1" }, { accountId: "acct-2" }],
    resourceSelector: {
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      segments: [{ type: "host", match: "exact", id: "host-001" }],
      matchDescendants: true,
    },
    controls: { mode: "SESSION_BOUND", authentication, maxTtlSeconds: 3600 },
    riskCeiling: "HIGH",
    ruleRevision: "3",
    revisionClass: "SNAPSHOT_STABLE",
    invalidateDerivedAuthority: false,
  };

  it("round-trips the full form and the minimal form (absent lists = any device type / any account)", () => {
    roundTrip(SystemExposureRuleSchema, rule);
    const { deviceTypes: _d, accounts: _a, resourceSelector: _r, riskCeiling: _c, ...minimal } = rule;
    void _d; void _a; void _r; void _c;
    roundTrip(SystemExposureRuleSchema, minimal);
  });

  it("rejects unsorted or duplicated deviceTypes/accounts (canonical wire order)", () => {
    expect(() => SystemExposureRuleSchema.parse({ ...rule, deviceTypes: ["xtrape-panel", "xtrape-mcp"] })).toThrow(
      /strict ascending/,
    );
    expect(() =>
      SystemExposureRuleSchema.parse({ ...rule, accounts: [{ accountId: "acct-2" }, { accountId: "acct-2" }] }),
    ).toThrow(/strict ascending/);
    expect(() => SystemExposureRuleSchema.parse({ ...rule, deviceTypes: [] })).toThrow(); // empty list is not "any" — omit instead
  });

  it("controls follow the B2 presence rules here too (a rule imposing DENY carries no TTL)", () => {
    roundTrip(SystemExposureRuleSchema, { ...rule, controls: { mode: "DENY", authentication } });
    expect(() =>
      SystemExposureRuleSchema.parse({ ...rule, controls: { mode: "SESSION_BOUND", authentication } }),
    ).toThrow(/requires maxTtlSeconds/);
  });

  it("has a collision-free revision-scoped key", () => {
    expect(systemExposureRuleKey(SystemExposureRuleSchema.parse(rule) as never)).toBe(`exposure-rule\u001frule-1\u001f3`);
  });
});

/* ================================================================== */

describe("slice B2 — Account Entitlement minimal baseline (§2/§7)", () => {
  const entitlement: AccountEntitlement = {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    entitlementId: "ent-1",
    account: { accountId: "acct-42" },
    target: { targetKind: "group", groupRef: "grp-diagnostics", groupRevision: "2" },
    entitlementRevision: "2",
    revisionClass: "REVOCATION_SENSITIVE",
    invalidateDerivedAuthority: true,
  };

  it("round-trips with and without optional tightening controls / resource bound", () => {
    roundTrip(AccountEntitlementSchema, entitlement);
    roundTrip(AccountEntitlementSchema, {
      ...entitlement,
      controls: { mode: "SINGLE_USE", authentication, maxUses: 1 },
      resourceSelector: {
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        segments: [{ type: "host", match: "any" }],
        matchDescendants: false,
      },
    });
  });

  it("is per-Account state: strict shape, one account, no subject union", () => {
    expect(() =>
      AccountEntitlementSchema.parse({ ...entitlement, subject: { subjectKind: "account" } }),
    ).toThrow();
    expect(() => AccountEntitlementSchema.parse({ ...entitlement, account: { participantId: "p-1" } })).toThrow();
  });

  it("has a collision-free revision-scoped key", () => {
    expect(accountEntitlementKey(AccountEntitlementSchema.parse(entitlement) as never)).toBe(
      `entitlement\u001fent-1\u001f2`,
    );
  });
});

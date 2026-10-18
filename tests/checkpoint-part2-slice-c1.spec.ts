import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_CONTRACT_VERSION,
  ParameterDigestSchema,
  PathRole,
  PathRoleSchema,
  PathHopSchema,
  InvocationPathSchema,
  TargetAdmissionRefSchema,
  ManagedAccessSessionBindingSchema,
  ReviewedScopeSchema,
  DecisionOutcome,
  DecisionOutcomeSchema,
  DecisionReasonCode,
  DecisionReasonCodeSchema,
  DecisionSchema,
  AuditSnapshotSchema,
  auditSnapshotKey,
} from "../src/index";

/* -------- shared fixtures -------- */

const cpA = { serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: "1.0.0" };

const resourceRef = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  segments: [
    { type: "host", id: "host-001" },
    { type: "service", id: "nginx" },
  ],
};

const controls = {
  mode: "SESSION_BOUND" as const,
  authentication: {
    requester: { requirement: "REAUTH" as const, maxAgeSeconds: 300 },
    approver: { requirement: "MFA" as const, maxAgeSeconds: 300 },
  },
  maxTtlSeconds: 3600, // slice B2: SESSION_BOUND also carries a TTL (§8)
};

const resolved = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  service: "linux-ops-widget-nodejs",
  checkpoint: cpA, // cpA.serviceId === service ("linux-ops-widget-nodejs") — identity consistent
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
  effectiveMaxTtlSeconds: 3600, // slice B2: = controls.maxTtlSeconds, policy-sourced
  ttlProvenance: { source: "policy" as const },
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
  checkpoint: cpA, // admission is scoped to the resolved Checkpoint (§7.2)
  artifactDigest,
  serviceInstanceRef: "inst-001",
  admissionRevision: "1",
  runtimeTrustRevision: "1",
};

const deviceInstanceHop = {
  pathRole: "originator" as const,
  hopIdentity: {
    entityKind: "device-instance" as const,
    deviceInstance: { deviceType: "xtrape-mcp", deviceInstanceId: "di-001" },
  },
};

const serviceInstanceHop = {
  pathRole: "target" as const,
  hopIdentity: {
    entityKind: "service-instance" as const,
    service: "linux-ops-widget-nodejs",
    serviceVersion: "2.1.0",
    serviceInstanceRef: "inst-001",
  },
};

const participantHop = {
  pathRole: "intermediary" as const,
  hopIdentity: {
    entityKind: "participant-instance" as const,
    participant: { participantId: "p-relay" },
    instanceId: "relay-inst-001",
  },
};

const invocationPath = [deviceInstanceHop, participantHop, serviceInstanceHop];

// the workload identity's (deviceType, deviceInstanceId) equals the instance's.
const deviceInstance = { deviceType: "xtrape-mcp", deviceInstanceId: "di-001" };
const deviceWorkloadIdentity = {
  workloadIdentityId: "wl-001",
  credentialRevision: "3",
  deviceType: "xtrape-mcp",
  deviceInstanceId: "di-001",
};

// The immutable session-binding snapshot (PR #89 review High): the session's
// complete composite binding, field-consistent with the reviewed identities.
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

const decisionAllow = { outcome: "ALLOW" as const, reasonCode: "ALLOWED" as const };

const auditSnapshot = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  auditId: "aud-123",
  reviewedScope,
  decision: decisionAllow,
  actor: { actorKind: "participant" as const, participant: { participantId: "p-1" } },
  grantRef: { grantId: "grant-1" },
  atUnixSeconds: 1_700_000_000,
};

const roundTrip = (schema: { parse: (v: unknown) => unknown }, sample: unknown) => {
  const parsed = schema.parse(sample);
  const round = schema.parse(JSON.parse(JSON.stringify(parsed)));
  expect(round).toEqual(parsed);
  return parsed;
};

/* ================================================================== */

describe("#59 part 2 slice C1 — ParameterDigest (arch/16 §4)", () => {
  it("round-trips a valid digest (with the normalization profile)", () => {
    roundTrip(ParameterDigestSchema, parameterDigest);
  });

  it("rejects a wrong algo", () => {
    expect(() => ParameterDigestSchema.parse({ ...parameterDigest, algo: "sha-512" })).toThrow();
  });

  it("rejects a wrong preimage literal (the preimage algorithm descriptor is frozen)", () => {
    expect(() => ParameterDigestSchema.parse({ ...parameterDigest, preimage: "rfc8785-jcs" })).toThrow();
    expect(() =>
      ParameterDigestSchema.parse({ ...parameterDigest, preimage: "checkpoint-semantic-normalization" }),
    ).toThrow();
  });

  it("(High 2) rejects a missing normalizationProfile — the concrete profile is required", () => {
    const { normalizationProfile: _drop, ...noProfile } = parameterDigest;
    void _drop;
    expect(() => ParameterDigestSchema.parse(noProfile as never)).toThrow();
  });

  it("(High 2) rejects a normalizationProfile missing profileId / profileRevision or with an extra field", () => {
    expect(() =>
      ParameterDigestSchema.parse({
        ...parameterDigest,
        normalizationProfile: { profileDigest: "c".repeat(64), profileRevision: "2" },
      }),
    ).toThrow(); // no profileId
    expect(() =>
      ParameterDigestSchema.parse({
        ...parameterDigest,
        normalizationProfile: { profileDigest: "c".repeat(64), profileId: "np-1" },
      }),
    ).toThrow(); // no profileRevision
    expect(() =>
      ParameterDigestSchema.parse({
        ...parameterDigest,
        normalizationProfile: { profileDigest: "c".repeat(64), profileId: "np-1", profileRevision: "2", extra: true },
      }),
    ).toThrow(); // strict
  });

  it("(High 2) rejects a non-decimal-string profileRevision (JSON-number-safe revision)", () => {
    expect(() =>
      ParameterDigestSchema.parse({
        ...parameterDigest,
        normalizationProfile: { profileDigest: "c".repeat(64), profileId: "np-1", profileRevision: 2 as unknown as string },
      }),
    ).toThrow();
    expect(() =>
      ParameterDigestSchema.parse({
        ...parameterDigest,
        normalizationProfile: { profileDigest: "c".repeat(64), profileId: "np-1", profileRevision: "02" },
      }),
    ).toThrow();
  });

  it("(Med 1) rejects a normalizationProfile missing profileDigest — the profile is content-addressed", () => {
    expect(() =>
      ParameterDigestSchema.parse({
        ...parameterDigest,
        normalizationProfile: { profileId: "np-checkpoint", profileRevision: "2" },
      }),
    ).toThrow();
  });

  it("(Med 1) rejects a normalizationProfile with a bad profileDigest hex (non-hex / short / uppercase)", () => {
    for (const bad of ["z".repeat(64), "c".repeat(63), "C".repeat(64)]) {
      expect(() =>
        ParameterDigestSchema.parse({
          ...parameterDigest,
          normalizationProfile: { profileDigest: bad, profileId: "np-checkpoint", profileRevision: "2" },
        }),
      ).toThrow();
    }
  });

  it("(Med 1) round-trips a valid content-addressed normalization profile", () => {
    const parsed = roundTrip(ParameterDigestSchema, parameterDigest) as {
      normalizationProfile: { profileDigest: string; profileId: string; profileRevision: string };
    };
    expect(parsed.normalizationProfile.profileDigest).toBe("c".repeat(64));
  });

  it("rejects a non-hex / short / uppercase digest", () => {
    expect(() => ParameterDigestSchema.parse({ ...parameterDigest, digest: "z".repeat(64) })).toThrow(); // non-hex
    expect(() => ParameterDigestSchema.parse({ ...parameterDigest, digest: "a".repeat(63) })).toThrow(); // short
    expect(() => ParameterDigestSchema.parse({ ...parameterDigest, digest: "A".repeat(64) })).toThrow(); // uppercase
  });

  it("rejects a negative byteLength and one above Number.MAX_SAFE_INTEGER", () => {
    expect(() => ParameterDigestSchema.parse({ ...parameterDigest, byteLength: -1 })).toThrow();
    expect(() =>
      ParameterDigestSchema.parse({ ...parameterDigest, byteLength: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
    expect(() =>
      ParameterDigestSchema.parse({ ...parameterDigest, byteLength: Number.MAX_SAFE_INTEGER }),
    ).not.toThrow();
  });

  it("rejects an unknown field (strict, closed surface)", () => {
    expect(() => ParameterDigestSchema.parse({ ...parameterDigest, extra: true })).toThrow();
  });

  it("carries NO contractVersion (it is a sub-ref)", () => {
    expect(() =>
      ParameterDigestSchema.parse({ ...parameterDigest, contractVersion: CHECKPOINT_CONTRACT_VERSION }),
    ).toThrow();
  });
});

describe("#59 part 2 slice C1 — InvocationPath / PathHop (arch/16 §3)", () => {
  it("PathRole enum accepts its members and rejects unknowns", () => {
    expect(PathRole).toEqual(["originator", "intermediary", "target"]);
    for (const r of PathRole) expect(() => PathRoleSchema.parse(r)).not.toThrow();
    expect(() => PathRoleSchema.parse("device")).toThrow();
  });

  it("(High 5) round-trips each entityKind (device-instance / service-instance / participant)", () => {
    roundTrip(PathHopSchema, deviceInstanceHop);
    roundTrip(PathHopSchema, serviceInstanceHop);
    roundTrip(PathHopSchema, participantHop);
  });

  it("(High 5) binds instance identity: a device-instance hop differs from a hop on another instance", () => {
    const a = PathHopSchema.parse(deviceInstanceHop);
    const b = PathHopSchema.parse({
      ...deviceInstanceHop,
      hopIdentity: {
        entityKind: "device-instance" as const,
        deviceInstance: { deviceType: "xtrape-mcp", deviceInstanceId: "di-999" },
      },
    });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("(High 5) a service-instance hop differs when the Service Instance changes", () => {
    const a = PathHopSchema.parse(serviceInstanceHop);
    const b = PathHopSchema.parse({
      ...serviceInstanceHop,
      hopIdentity: { ...serviceInstanceHop.hopIdentity, serviceInstanceRef: "inst-999" },
    });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("(High 5) rejects an unknown pathRole", () => {
    expect(() => PathHopSchema.parse({ ...deviceInstanceHop, pathRole: "gateway" })).toThrow();
  });

  it("(High 5) rejects an unknown entityKind", () => {
    expect(() =>
      PathHopSchema.parse({ pathRole: "target", hopIdentity: { entityKind: "adapter", adapterId: "a-1" } }),
    ).toThrow();
  });

  it("(High 5) rejects a service-instance hop missing serviceVersion / serviceInstanceRef", () => {
    expect(() =>
      PathHopSchema.parse({
        pathRole: "target",
        hopIdentity: { entityKind: "service-instance", service: "linux-ops-widget-nodejs", serviceInstanceRef: "inst-1" },
      }),
    ).toThrow(); // no serviceVersion
    expect(() =>
      PathHopSchema.parse({
        pathRole: "target",
        hopIdentity: { entityKind: "service-instance", service: "linux-ops-widget-nodejs", serviceVersion: "1.0.0" },
      }),
    ).toThrow(); // no serviceInstanceRef
  });

  it("rejects an unknown field on a hop (strict)", () => {
    expect(() => PathHopSchema.parse({ ...deviceInstanceHop, extra: true })).toThrow();
  });

  it("(High 1) a service-instance hop accepts an OPAQUE serviceVersion (rc/build) and rejects empty", () => {
    for (const serviceVersion of ["1.0.0-rc1", "1.0.0+build", "2.1.0"]) {
      expect(() =>
        PathHopSchema.parse({ ...serviceInstanceHop, hopIdentity: { ...serviceInstanceHop.hopIdentity, serviceVersion } }),
      ).not.toThrow();
    }
    expect(() =>
      PathHopSchema.parse({ ...serviceInstanceHop, hopIdentity: { ...serviceInstanceHop.hopIdentity, serviceVersion: "" } }),
    ).toThrow();
  });

  it("(High 2) rejects a path shorter than 2 hops (originator .. target)", () => {
    expect(() => InvocationPathSchema.parse([])).toThrow();
    expect(() => InvocationPathSchema.parse([deviceInstanceHop])).toThrow();
    expect(() => InvocationPathSchema.parse(invocationPath)).not.toThrow();
  });

  it("(High 2) accepts a valid ordered originator .. intermediary .. target path", () => {
    expect(() => InvocationPathSchema.parse([deviceInstanceHop, participantHop, serviceInstanceHop])).not.toThrow();
    // minimal 2-hop originator .. target is also valid.
    expect(() => InvocationPathSchema.parse([deviceInstanceHop, serviceInstanceHop])).not.toThrow();
  });

  it("(High 2) rejects a path whose first hop is not the originator", () => {
    // first hop is an intermediary, not the originator.
    expect(() => InvocationPathSchema.parse([participantHop, serviceInstanceHop])).toThrow();
  });

  it("(High 2) rejects a path whose last hop is not the target", () => {
    // last hop is an intermediary, not the target.
    expect(() => InvocationPathSchema.parse([deviceInstanceHop, participantHop])).toThrow();
  });

  it("(High 2) rejects two originators", () => {
    const secondOriginator = { ...deviceInstanceHop, hopIdentity: { ...deviceInstanceHop.hopIdentity } };
    expect(() => InvocationPathSchema.parse([deviceInstanceHop, secondOriginator, serviceInstanceHop])).toThrow();
  });

  it("(High 2) rejects the target appearing before the originator (reversed path)", () => {
    const originatorLast = { ...deviceInstanceHop, pathRole: "originator" as const };
    expect(() => InvocationPathSchema.parse([serviceInstanceHop, originatorLast])).toThrow();
  });

  it("(High 2) rejects a middle hop that is an originator (interior must be intermediary)", () => {
    const middleOriginator = { ...participantHop, pathRole: "originator" as const };
    expect(() => InvocationPathSchema.parse([deviceInstanceHop, middleOriginator, serviceInstanceHop])).toThrow();
  });

  it("(High 2) rejects a target hop whose entityKind is participant or device-instance", () => {
    const participantTarget = { pathRole: "target" as const, hopIdentity: participantHop.hopIdentity };
    const deviceTarget = { pathRole: "target" as const, hopIdentity: deviceInstanceHop.hopIdentity };
    expect(() => InvocationPathSchema.parse([deviceInstanceHop, participantTarget])).toThrow();
    expect(() => InvocationPathSchema.parse([deviceInstanceHop, deviceTarget])).toThrow();
  });

  it("(High 1) rejects a bare-participant intermediary (instance switch would be undetectable)", () => {
    const bareIntermediary = {
      pathRole: "intermediary" as const,
      hopIdentity: { entityKind: "participant" as const, participant: { participantId: "p-relay" } },
    };
    expect(() => InvocationPathSchema.parse([deviceInstanceHop, bareIntermediary, serviceInstanceHop])).toThrow();
  });

  it("(High 1) accepts a bare-participant ORIGINATOR (an Account or autonomous AI originator has no runtime instance)", () => {
    const bareOriginator = {
      pathRole: "originator" as const,
      hopIdentity: { entityKind: "participant" as const, participant: { participantId: "agent-ops" } },
    };
    expect(() => InvocationPathSchema.parse([bareOriginator, participantHop, serviceInstanceHop])).not.toThrow();
  });

  it("(High 1) a participant-instance intermediary makes a running-instance switch detectable", () => {
    const p1 = {
      pathRole: "intermediary" as const,
      hopIdentity: { entityKind: "participant-instance" as const, participant: { participantId: "p-relay" }, instanceId: "relay-inst-001" },
    };
    const p2 = {
      pathRole: "intermediary" as const,
      hopIdentity: { entityKind: "participant-instance" as const, participant: { participantId: "p-relay" }, instanceId: "relay-inst-002" },
    };
    const path1 = InvocationPathSchema.parse([deviceInstanceHop, p1, serviceInstanceHop]);
    const path2 = InvocationPathSchema.parse([deviceInstanceHop, p2, serviceInstanceHop]);
    // same participantId, different running instance => different serialized path.
    expect(JSON.stringify(path1)).not.toBe(JSON.stringify(path2));
  });
});

describe("#59 part 2 slice C1 — TargetAdmissionRef (arch/16 §7.2)", () => {
  it("(High 3) round-trips a full exact admission identity", () => {
    roundTrip(TargetAdmissionRefSchema, targetAdmission);
  });

  it("(High 3) rejects each newly-required field being absent", () => {
    for (const key of [
      "artifactDigest",
      "serviceInstanceRef",
      "admissionRevision",
      "runtimeTrustRevision",
    ] as const) {
      const { [key]: _drop, ...missing } = targetAdmission;
      void _drop;
      expect(() => TargetAdmissionRefSchema.parse(missing as never), `missing ${key}`).toThrow();
    }
  });

  it("(High 3) rejects a bad artifactDigest hex / algo / extra field", () => {
    expect(() =>
      TargetAdmissionRefSchema.parse({ ...targetAdmission, artifactDigest: { algo: "sha-256", digest: "z".repeat(64) } }),
    ).toThrow(); // non-hex
    expect(() =>
      TargetAdmissionRefSchema.parse({ ...targetAdmission, artifactDigest: { algo: "sha-256", digest: "b".repeat(63) } }),
    ).toThrow(); // short
    expect(() =>
      TargetAdmissionRefSchema.parse({ ...targetAdmission, artifactDigest: { algo: "sha-512", digest: "b".repeat(64) } }),
    ).toThrow(); // wrong algo
    expect(() =>
      TargetAdmissionRefSchema.parse({
        ...targetAdmission,
        artifactDigest: { algo: "sha-256", digest: "b".repeat(64), extra: true },
      }),
    ).toThrow(); // strict
  });

  it("(High 1) accepts an OPAQUE serviceVersion (vendor rc/build strings) and rejects empty", () => {
    for (const serviceVersion of ["1.0.0-rc1", "1.0.0+build", "1.0", "v3", "2.1.0"]) {
      expect(() => TargetAdmissionRefSchema.parse({ ...targetAdmission, serviceVersion })).not.toThrow();
    }
    expect(() => TargetAdmissionRefSchema.parse({ ...targetAdmission, serviceVersion: "" })).toThrow();
  });

  it("(High 2 standalone) rejects checkpoint.serviceId != service without relying on an enclosing scope", () => {
    // cpA.serviceId is "linux-ops-widget-nodejs"; a checkpoint from a different Service must be
    // rejected by TargetAdmissionRefSchema ITSELF (it is exported as the exact
    // target-admission identity).
    const forkedCheckpoint = { ...cpA, serviceId: "anyapi" };
    expect(() =>
      TargetAdmissionRefSchema.parse({ ...targetAdmission, checkpoint: forkedCheckpoint }),
    ).toThrow();
    // the consistent identity still parses standalone.
    expect(() => TargetAdmissionRefSchema.parse(targetAdmission)).not.toThrow();
  });

  it("(High 3) requires the checkpoint the admission is scoped to (§7.2)", () => {
    const { checkpoint: _drop, ...noCheckpoint } = targetAdmission;
    void _drop;
    expect(() => TargetAdmissionRefSchema.parse(noCheckpoint as never)).toThrow();
    // a malformed checkpoint (non-core-SemVer version) is rejected — the Checkpoint
    // authorization identity IS core SemVer even though serviceVersion is opaque.
    expect(() =>
      TargetAdmissionRefSchema.parse({ ...targetAdmission, checkpoint: { ...cpA, checkpointVersion: "1.0.0-rc1" } }),
    ).toThrow();
  });

  it("rejects a non-decimal-string admission/runtime-trust revision", () => {
    expect(() => TargetAdmissionRefSchema.parse({ ...targetAdmission, admissionRevision: "01" })).toThrow();
    expect(() =>
      TargetAdmissionRefSchema.parse({ ...targetAdmission, runtimeTrustRevision: 1 as unknown as string }),
    ).toThrow();
  });

  it("rejects a legacy svc_* service id and an unknown field", () => {
    expect(() => TargetAdmissionRefSchema.parse({ ...targetAdmission, service: "svc_ops" })).toThrow();
    expect(() => TargetAdmissionRefSchema.parse({ ...targetAdmission, extra: true })).toThrow();
  });
});

describe("#59 part 2 slice C1 — ManagedAccessSessionBinding (arch/16 §2/§6/§8, review High)", () => {
  it("round-trips a valid session-binding snapshot", () => {
    roundTrip(ManagedAccessSessionBindingSchema, managedAccessSession);
  });

  it("rejects the legacy id-only form ({ sessionId }) — an opaque id is not a session binding", () => {
    expect(() => ManagedAccessSessionBindingSchema.parse({ sessionId: "sess-1" })).toThrow();
  });

  it("rejects each missing binding field and an unknown field (strict, closed)", () => {
    for (const key of [
      "sessionId",
      "account",
      "accountToken",
      "deviceWorkloadIdentity",
      "deviceInstance",
      "serviceSelection",
      "authenticationContext",
      "createdAtVersion",
      "expiresAtVersion",
      "state",
    ] as const) {
      const { [key]: _drop, ...missing } = managedAccessSession;
      void _drop;
      expect(() => ManagedAccessSessionBindingSchema.parse(missing as never), `missing ${key}`).toThrow();
    }
    expect(() => ManagedAccessSessionBindingSchema.parse({ ...managedAccessSession, extra: true })).toThrow();
  });

  it("carries NO contractVersion of its own (it is a sub-ref of the audit document)", () => {
    expect(() =>
      ManagedAccessSessionBindingSchema.parse({ ...managedAccessSession, contractVersion: CHECKPOINT_CONTRACT_VERSION }),
    ).toThrow();
  });

  it("(§35) rejects an internally-inconsistent workload/instance device pair", () => {
    expect(() =>
      ManagedAccessSessionBindingSchema.parse({
        ...managedAccessSession,
        deviceWorkloadIdentity: { ...deviceWorkloadIdentity, deviceInstanceId: "di-999" },
      }),
    ).toThrow();
  });

  it("rejects an inverted lifetime window (createdAtVersion > expiresAtVersion)", () => {
    expect(() =>
      ManagedAccessSessionBindingSchema.parse({
        ...managedAccessSession,
        createdAtVersion: "3.0.0",
        expiresAtVersion: "2.0.0",
      }),
    ).toThrow();
  });

  it("records (does not constrain) a non-ACTIVE reviewed state, and rejects an unknown state", () => {
    expect(() =>
      ManagedAccessSessionBindingSchema.parse({ ...managedAccessSession, state: "EXPIRED" }),
    ).not.toThrow();
    expect(() => ManagedAccessSessionBindingSchema.parse({ ...managedAccessSession, state: "CANCELLED" })).toThrow();
  });
});

describe("#59 part 2 slice C1 — ReviewedScope (arch/16 §7.1/§7.2/§8/§10)", () => {
  it("round-trips a full reviewed scope", () => {
    roundTrip(ReviewedScopeSchema, reviewedScope);
  });

  it("rejects each missing binding", () => {
    for (const key of [
      "account",
      "accountToken",
      "deviceWorkloadIdentity",
      "deviceInstance",
      "managedAccessSession",
      "serviceSelection",
      "resolved",
      "invocationPath",
      "targetAdmission",
      "outputClassificationUpperBound",
      "parameterDigest",
    ] as const) {
      const { [key]: _drop, ...missing } = reviewedScope;
      void _drop;
      expect(() => ReviewedScopeSchema.parse(missing as never), `missing ${key}`).toThrow();
    }
  });

  it("rejects the retired deviceToken key (renamed to accountToken)", () => {
    const { accountToken, ...rest } = reviewedScope;
    expect(() => ReviewedScopeSchema.parse({ ...rest, deviceToken: accountToken } as never)).toThrow();
  });

  it("rejects an unknown field (strict, closed surface)", () => {
    expect(() => ReviewedScopeSchema.parse({ ...reviewedScope, extra: true })).toThrow();
  });

  it("(§35) rejects a deviceType mismatch between workload identity and instance", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        deviceWorkloadIdentity: { ...deviceWorkloadIdentity, deviceType: "xtrape-panel" },
      }),
    ).toThrow();
  });

  it("(§35) rejects a deviceInstanceId mismatch between workload identity and instance", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        deviceWorkloadIdentity: { ...deviceWorkloadIdentity, deviceInstanceId: "di-999" },
      }),
    ).toThrow();
  });

  it("(High 4) rejects targetAdmission.service != resolved.service", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        targetAdmission: { ...targetAdmission, service: "self" },
      }),
    ).toThrow();
  });

  it("(High 4) rejects an explicit serviceSelection that does NOT include resolved.service", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        serviceSelection: { scope: "explicit" as const, services: ["self"] },
      }),
    ).toThrow();
  });

  it("(High 4) accepts scope:'all' (no explicit membership check) and the consistent explicit case", () => {
    // the session snapshot must agree with the reviewed selection (§8), so
    // switching to scope:'all' switches BOTH sides.
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        serviceSelection: { scope: "all" as const },
        managedAccessSession: { ...managedAccessSession, serviceSelection: { scope: "all" as const } },
      }),
    ).not.toThrow();
    expect(() => ReviewedScopeSchema.parse(reviewedScope)).not.toThrow();
  });

  it("rejects an empty invocation path", () => {
    expect(() => ReviewedScopeSchema.parse({ ...reviewedScope, invocationPath: [] })).toThrow();
  });

  it("rejects an unknown entityKind inside the invocation path", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        invocationPath: [{ pathRole: "target", hopIdentity: { entityKind: "gateway", id: "g-1" } }],
      }),
    ).toThrow();
  });

  it("(High 3) rejects targetAdmission.checkpoint != resolved.checkpoint", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        targetAdmission: { ...targetAdmission, checkpoint: { ...cpA, checkpointVersion: "2.0.0" } },
      }),
    ).toThrow();
  });

  it("(High 3) rejects a target hop whose service/version/instance mismatch targetAdmission", () => {
    // serviceVersion mismatch
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        invocationPath: [
          deviceInstanceHop,
          participantHop,
          { ...serviceInstanceHop, hopIdentity: { ...serviceInstanceHop.hopIdentity, serviceVersion: "9.9.9" } },
        ],
      }),
    ).toThrow();
    // serviceInstanceRef mismatch
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        invocationPath: [
          deviceInstanceHop,
          participantHop,
          { ...serviceInstanceHop, hopIdentity: { ...serviceInstanceHop.hopIdentity, serviceInstanceRef: "inst-999" } },
        ],
      }),
    ).toThrow();
  });

  it("(High 3) rejects a scope whose deviceInstance is absent from the path", () => {
    const otherDeviceHop = {
      pathRole: "originator" as const,
      hopIdentity: {
        entityKind: "device-instance" as const,
        deviceInstance: { deviceType: "xtrape-mcp", deviceInstanceId: "di-999" },
      },
    };
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        invocationPath: [otherDeviceHop, participantHop, serviceInstanceHop],
      }),
    ).toThrow();
  });

  it("(High 3) accepts the fully-consistent reviewed scope", () => {
    expect(() => ReviewedScopeSchema.parse(reviewedScope)).not.toThrow();
  });

  it("carries NO contractVersion of its own (it is a sub-ref)", () => {
    expect(() =>
      ReviewedScopeSchema.parse({ ...reviewedScope, contractVersion: CHECKPOINT_CONTRACT_VERSION }),
    ).toThrow();
  });

  /* -------- §8 session-binding agreement (review High): for the SAME
   * sessionId, substituting any bound identity must fail closed -------- */

  it("(review High) rejects the legacy id-only managedAccessSession form", () => {
    expect(() =>
      ReviewedScopeSchema.parse({ ...reviewedScope, managedAccessSession: { sessionId: "sess-1" } }),
    ).toThrow();
  });

  it("(review High) rejects a session snapshot bound to a different Account (same sessionId)", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        managedAccessSession: { ...managedAccessSession, account: { accountId: "acct-99" } },
      }),
    ).toThrow();
  });

  it("(review High) rejects an accountToken tokenId swap under the same sessionId", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        managedAccessSession: { ...managedAccessSession, accountToken: { tokenId: "tok-999", revision: "5" } },
      }),
    ).toThrow();
  });

  it("(review High) rejects an accountToken revision swap under the same sessionId — both directions", () => {
    // stale/substituted revision in the session snapshot
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        managedAccessSession: { ...managedAccessSession, accountToken: { tokenId: "tok-1", revision: "4" } },
      }),
    ).toThrow();
    // substituted revision at top level, session snapshot unchanged
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        accountToken: { tokenId: "tok-1", revision: "6" },
      }),
    ).toThrow();
  });

  it("(review High) rejects a Device Instance swap under the same sessionId (internally-consistent snapshot)", () => {
    // The snapshot itself is internally coherent (workload pair === instance
    // pair) — ONLY the cross-check against the reviewed identities fires.
    const swappedWorkload = { ...deviceWorkloadIdentity, deviceInstanceId: "di-999" };
    const swappedInstance = { deviceType: "xtrape-mcp", deviceInstanceId: "di-999" };
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        managedAccessSession: {
          ...managedAccessSession,
          deviceWorkloadIdentity: swappedWorkload,
          deviceInstance: swappedInstance,
        },
      }),
    ).toThrow();
  });

  it("(review High) rejects a workload credentialRevision swap under the same sessionId", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        managedAccessSession: {
          ...managedAccessSession,
          deviceWorkloadIdentity: { ...deviceWorkloadIdentity, credentialRevision: "4" },
        },
      }),
    ).toThrow();
  });

  it("(review High) rejects a Service Selection swap under the same sessionId — explicit list and scope kind", () => {
    // narrower explicit list in the snapshot
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        managedAccessSession: {
          ...managedAccessSession,
          serviceSelection: { scope: "explicit" as const, services: ["linux-ops-widget-nodejs"] },
        },
      }),
    ).toThrow();
    // scope-kind mismatch (all vs explicit)
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        managedAccessSession: { ...managedAccessSession, serviceSelection: { scope: "all" as const } },
      }),
    ).toThrow();
  });

  it("(review High) accepts the fully-agreeing session snapshot (and with scope 'all' on both sides)", () => {
    expect(() => ReviewedScopeSchema.parse(reviewedScope)).not.toThrow();
    expect(() =>
      ReviewedScopeSchema.parse({
        ...reviewedScope,
        serviceSelection: { scope: "all" as const },
        managedAccessSession: { ...managedAccessSession, serviceSelection: { scope: "all" as const } },
      }),
    ).not.toThrow();
  });
});

describe("#59 part 2 slice C1 — Decision (arch/16 §10, 4-branch discriminated union)", () => {
  it("DecisionOutcome / DecisionReasonCode enums accept their members and reject unknowns", () => {
    // CONFIRMATION_REQUIRED joined the closed set in slice C2 (§8.1).
    expect(DecisionOutcome).toEqual([
      "ALLOW",
      "DENY",
      "REAUTHENTICATION_REQUIRED",
      "APPROVAL_REQUIRED",
      "CONFIRMATION_REQUIRED",
    ]);
    for (const o of DecisionOutcome) expect(() => DecisionOutcomeSchema.parse(o)).not.toThrow();
    expect(() => DecisionOutcomeSchema.parse("CHALLENGE")).toThrow();
    for (const c of DecisionReasonCode) expect(() => DecisionReasonCodeSchema.parse(c)).not.toThrow();
    expect(() => DecisionReasonCodeSchema.parse("DENIED_OTHER")).toThrow();
  });

  it("each of the 4 branches round-trips with exactly its legal fields", () => {
    roundTrip(DecisionSchema, { outcome: "ALLOW", reasonCode: "ALLOWED" });
    roundTrip(DecisionSchema, { outcome: "DENY", reasonCode: "DENIED_POLICY" });
    roundTrip(DecisionSchema, {
      outcome: "REAUTHENTICATION_REQUIRED",
      reasonCode: "CHALLENGE_REAUTH",
      challengeRef: { challengeId: "chal-1" },
    });
    roundTrip(DecisionSchema, {
      outcome: "APPROVAL_REQUIRED",
      reasonCode: "CHALLENGE_APPROVAL",
      approvalRef: { approvalId: "appr-1" },
    });
  });

  it("DENY round-trips with each DENIED_* reasonCode", () => {
    for (const reasonCode of [
      "DENIED_POLICY",
      "DENIED_AUTH",
      "DENIED_APPROVAL",
      "DENIED_TARGET_ADMISSION",
      "DENIED_DATA_FLOW",
    ] as const) {
      roundTrip(DecisionSchema, { outcome: "DENY", reasonCode });
    }
  });

  it("rejects an unknown outcome (closed discriminated union)", () => {
    expect(() => DecisionSchema.parse({ outcome: "CHALLENGE", reasonCode: "ALLOWED" })).toThrow();
  });

  it("rejects ALLOW carrying a challengeRef (unknown field on the ALLOW branch)", () => {
    expect(() =>
      DecisionSchema.parse({ outcome: "ALLOW", reasonCode: "ALLOWED", challengeRef: { challengeId: "chal-1" } }),
    ).toThrow();
  });

  it("rejects ALLOW carrying an approvalRef (unknown field on the ALLOW branch)", () => {
    expect(() =>
      DecisionSchema.parse({ outcome: "ALLOW", reasonCode: "ALLOWED", approvalRef: { approvalId: "appr-1" } }),
    ).toThrow();
  });

  it("rejects DENY with the ALLOWED reasonCode (not in the DENY branch's enum)", () => {
    expect(() => DecisionSchema.parse({ outcome: "DENY", reasonCode: "ALLOWED" })).toThrow();
  });

  it("rejects DENY carrying a challenge/approval ref (unknown field)", () => {
    expect(() =>
      DecisionSchema.parse({ outcome: "DENY", reasonCode: "DENIED_POLICY", challengeRef: { challengeId: "chal-1" } }),
    ).toThrow();
    expect(() =>
      DecisionSchema.parse({ outcome: "DENY", reasonCode: "DENIED_POLICY", approvalRef: { approvalId: "appr-1" } }),
    ).toThrow();
  });

  it("rejects REAUTHENTICATION_REQUIRED without a challengeRef (required on its branch)", () => {
    expect(() =>
      DecisionSchema.parse({ outcome: "REAUTHENTICATION_REQUIRED", reasonCode: "CHALLENGE_REAUTH" }),
    ).toThrow();
  });

  it("rejects REAUTHENTICATION_REQUIRED carrying an approvalRef (unknown field)", () => {
    expect(() =>
      DecisionSchema.parse({
        outcome: "REAUTHENTICATION_REQUIRED",
        reasonCode: "CHALLENGE_REAUTH",
        challengeRef: { challengeId: "chal-1" },
        approvalRef: { approvalId: "appr-1" },
      }),
    ).toThrow();
  });

  it("rejects APPROVAL_REQUIRED without an approvalRef; and carrying a challengeRef", () => {
    expect(() =>
      DecisionSchema.parse({ outcome: "APPROVAL_REQUIRED", reasonCode: "CHALLENGE_APPROVAL" }),
    ).toThrow();
    expect(() =>
      DecisionSchema.parse({
        outcome: "APPROVAL_REQUIRED",
        reasonCode: "CHALLENGE_APPROVAL",
        approvalRef: { approvalId: "appr-1" },
        challengeRef: { challengeId: "chal-1" },
      }),
    ).toThrow();
  });

  it("rejects a wrong reasonCode per async branch (literal mismatch)", () => {
    expect(() =>
      DecisionSchema.parse({
        outcome: "REAUTHENTICATION_REQUIRED",
        reasonCode: "CHALLENGE_APPROVAL",
        challengeRef: { challengeId: "chal-1" },
      }),
    ).toThrow();
    expect(() =>
      DecisionSchema.parse({
        outcome: "APPROVAL_REQUIRED",
        reasonCode: "CHALLENGE_REAUTH",
        approvalRef: { approvalId: "appr-1" },
      }),
    ).toThrow();
  });

  it("rejects an unknown field (strict, closed surface)", () => {
    expect(() => DecisionSchema.parse({ outcome: "ALLOW", reasonCode: "ALLOWED", extra: true })).toThrow();
  });
});

describe("#59 part 2 slice C1 — AuditSnapshot (arch/16 §7.1)", () => {
  it("round-trips with the participant actor kind", () => {
    roundTrip(AuditSnapshotSchema, auditSnapshot);
  });

  it("round-trips with the principal actor kind", () => {
    roundTrip(AuditSnapshotSchema, {
      ...auditSnapshot,
      actor: { actorKind: "principal", principal: { principalType: "AGENT", principalId: "p-1" } },
    });
  });

  it("carries contractVersion and rejects a wrong literal / missing it", () => {
    expect(AuditSnapshotSchema.parse(auditSnapshot).contractVersion).toBe(CHECKPOINT_CONTRACT_VERSION);
    expect(() => AuditSnapshotSchema.parse({ ...auditSnapshot, contractVersion: 2 })).toThrow();
    const { contractVersion: _drop, ...noVersion } = auditSnapshot;
    void _drop;
    expect(() => AuditSnapshotSchema.parse(noVersion)).toThrow();
  });

  it("rejects an unknown field (strict, closed surface)", () => {
    expect(() => AuditSnapshotSchema.parse({ ...auditSnapshot, extra: true })).toThrow();
  });

  it("rejects a stray `state` field (a record, not a live object)", () => {
    expect(() => AuditSnapshotSchema.parse({ ...auditSnapshot, state: "ACTIVE" })).toThrow();
  });

  it("grantRef is optional (omitted round-trips)", () => {
    const { grantRef: _drop, ...noGrant } = auditSnapshot;
    void _drop;
    roundTrip(AuditSnapshotSchema, noGrant);
  });

  it("(Med 1) accepts a grantRef with an ALLOW decision", () => {
    expect(() => AuditSnapshotSchema.parse(auditSnapshot)).not.toThrow();
  });

  it("(Med 1) rejects a grantRef with a DENY decision", () => {
    expect(() =>
      AuditSnapshotSchema.parse({
        ...auditSnapshot,
        decision: { outcome: "DENY", reasonCode: "DENIED_POLICY" },
      }),
    ).toThrow();
  });

  it("(Med 1) rejects a grantRef with an async (non-ALLOW) decision", () => {
    expect(() =>
      AuditSnapshotSchema.parse({
        ...auditSnapshot,
        decision: {
          outcome: "APPROVAL_REQUIRED",
          reasonCode: "CHALLENGE_APPROVAL",
          approvalRef: { approvalId: "appr-1" },
        },
      }),
    ).toThrow();
  });

  it("(Med 1) accepts an absent grantRef with a non-ALLOW decision", () => {
    const { grantRef: _drop, ...noGrant } = auditSnapshot;
    void _drop;
    roundTrip(AuditSnapshotSchema, {
      ...noGrant,
      decision: { outcome: "DENY", reasonCode: "DENIED_AUTH" },
    });
  });

  // §8: the decision must respect the effective authorization mode
  // (reviewedScope.resolved.controls.mode).
  // slice B2: TTL/use presence follows the mode on BOTH layers, so a mode
  // swap rebuilds controls and the resolved effectives rather than spreading.
  const withMode = (mode: string) => {
    const { effectiveMaxTtlSeconds: _t, ttlProvenance: _p, ...bare } = resolved;
    void _t; void _p;
    const { maxTtlSeconds: _m, ...bareControls } = controls;
    void _m;
    const ttlControls = mode === "TIME_BOUND" || mode === "SESSION_BOUND" ? { maxTtlSeconds: 3600 } : {};
    const effective =
      mode === "AUTO" || mode === "DENY"
        ? {}
        : mode === "SINGLE_USE"
          ? {
              effectiveMaxTtlSeconds: 600,
              ttlProvenance: { source: "lifetime-profile" as const, profileId: "lt-platform-r1", profileRevision: "1" },
              effectiveMaxUses: 1,
            }
          : { effectiveMaxTtlSeconds: 3600, ttlProvenance: { source: "policy" as const } };
    return {
      ...reviewedScope,
      resolved: { ...bare, controls: { ...bareControls, mode, ...ttlControls }, ...effective },
    };
  };
  const noGrant = (() => {
    const { grantRef: _drop, ...rest } = auditSnapshot;
    void _drop;
    return rest;
  })();

  it("(High 4) rejects mode DENY with an ALLOW decision", () => {
    expect(() =>
      AuditSnapshotSchema.parse({ ...noGrant, reviewedScope: withMode("DENY"), decision: decisionAllow }),
    ).toThrow();
  });

  it("(High 4) rejects mode AUTO carrying a grantRef", () => {
    expect(() =>
      AuditSnapshotSchema.parse({ ...auditSnapshot, reviewedScope: withMode("AUTO"), decision: decisionAllow }),
    ).toThrow();
  });

  it("(High 4) rejects mode AUTO with an APPROVAL_REQUIRED outcome", () => {
    expect(() =>
      AuditSnapshotSchema.parse({
        ...noGrant,
        reviewedScope: withMode("AUTO"),
        decision: { outcome: "APPROVAL_REQUIRED", reasonCode: "CHALLENGE_APPROVAL", approvalRef: { approvalId: "appr-1" } },
      }),
    ).toThrow();
  });

  it("(High 4) accepts mode SINGLE_USE with an ALLOW + grantRef (a normal grant-bearing allow)", () => {
    roundTrip(AuditSnapshotSchema, { ...auditSnapshot, reviewedScope: withMode("SINGLE_USE"), decision: decisionAllow });
  });

  it("(High 4) accepts mode DENY with a DENY decision (no grantRef)", () => {
    roundTrip(AuditSnapshotSchema, {
      ...noGrant,
      reviewedScope: withMode("DENY"),
      decision: { outcome: "DENY", reasonCode: "DENIED_POLICY" },
    });
  });

  /* -------- §6/§8 session-state consistency (review 2): a non-ACTIVE
   * reviewed session can only produce DENY and never a Grant -------- */

  const NON_ACTIVE_STATES = ["CLOSED", "EXPIRED", "REVOKED", "INVALIDATED"] as const;
  const withSessionState = (state: string) => ({
    ...reviewedScope,
    managedAccessSession: { ...managedAccessSession, state },
  });

  it("(review 2) rejects each non-ACTIVE state with an ALLOW decision (no grantRef — the outcome alone is the violation)", () => {
    for (const state of NON_ACTIVE_STATES) {
      expect(
        () => AuditSnapshotSchema.parse({ ...noGrant, reviewedScope: withSessionState(state), decision: decisionAllow }),
        `${state} + ALLOW`,
      ).toThrow();
    }
  });

  it("(review 2) rejects each non-ACTIVE state with REAUTHENTICATION_REQUIRED", () => {
    for (const state of NON_ACTIVE_STATES) {
      expect(
        () =>
          AuditSnapshotSchema.parse({
            ...noGrant,
            reviewedScope: withSessionState(state),
            decision: { outcome: "REAUTHENTICATION_REQUIRED", reasonCode: "CHALLENGE_REAUTH", challengeRef: { challengeId: "chal-1" } },
          }),
        `${state} + REAUTHENTICATION_REQUIRED`,
      ).toThrow();
    }
  });

  it("(review 2) rejects each non-ACTIVE state with APPROVAL_REQUIRED", () => {
    for (const state of NON_ACTIVE_STATES) {
      expect(
        () =>
          AuditSnapshotSchema.parse({
            ...noGrant,
            reviewedScope: withSessionState(state),
            decision: { outcome: "APPROVAL_REQUIRED", reasonCode: "CHALLENGE_APPROVAL", approvalRef: { approvalId: "appr-1" } },
          }),
        `${state} + APPROVAL_REQUIRED`,
      ).toThrow();
    }
  });

  it("(review 2) rejects a non-ACTIVE state carrying a grantRef (even alongside ALLOW)", () => {
    for (const state of NON_ACTIVE_STATES) {
      expect(
        () => AuditSnapshotSchema.parse({ ...auditSnapshot, reviewedScope: withSessionState(state), decision: decisionAllow }),
        `${state} + ALLOW + grantRef`,
      ).toThrow();
    }
  });

  it("(review 2) accepts each non-ACTIVE state with a DENY decision and no grantRef (recording stays legal)", () => {
    for (const state of NON_ACTIVE_STATES) {
      roundTrip(AuditSnapshotSchema, {
        ...noGrant,
        reviewedScope: withSessionState(state),
        decision: { outcome: "DENY", reasonCode: "DENIED_AUTH" },
      });
    }
  });

  it("(review 2) regression: ACTIVE + ALLOW + grantRef still round-trips", () => {
    roundTrip(AuditSnapshotSchema, auditSnapshot);
  });

  it("rejects a hybrid/mixed actor (fields from two branches)", () => {
    expect(() =>
      AuditSnapshotSchema.parse({
        ...auditSnapshot,
        actor: {
          actorKind: "participant",
          participant: { participantId: "p-1" },
          principal: { principalType: "AGENT", principalId: "p-1" },
        },
      }),
    ).toThrow();
    expect(() => AuditSnapshotSchema.parse({ ...auditSnapshot, actor: { actorKind: "role", roleId: "r-1" } })).toThrow();
  });

  it("rejects an inconsistent embedded decision (the discriminated union propagates)", () => {
    // an illegal decision (ALLOW carrying a challengeRef) is rejected even when
    // embedded in an otherwise-valid audit snapshot.
    expect(() =>
      AuditSnapshotSchema.parse({
        ...auditSnapshot,
        decision: { outcome: "ALLOW", reasonCode: "ALLOWED", challengeRef: { challengeId: "chal-1" } },
      }),
    ).toThrow();
  });

  it("auditSnapshotKey is stable, fails closed, and distinguishes audit ids", () => {
    expect(auditSnapshotKey(auditSnapshot)).toBe(auditSnapshotKey(AuditSnapshotSchema.parse(auditSnapshot) as never));
    expect(auditSnapshotKey(auditSnapshot)).not.toBe(auditSnapshotKey({ ...auditSnapshot, auditId: "aud-999" }));
    expect(() => auditSnapshotKey({ ...auditSnapshot, auditId: "" } as never)).toThrow();
  });
});

/* ================================================================== */

describe("#137 establishing-authority dual form (arch/16 §6.1; docs#278)", () => {
  const { accountToken: _mTok, deviceWorkloadIdentity: _mWl, ...masDeviceRest } = managedAccessSession;
  const masDevice = { ...masDeviceRest, establishment: "device-authenticated" as const };
  const { accountToken: _sTok, deviceWorkloadIdentity: _sWl, ...scopeDeviceRest } = reviewedScope;
  const scopeDevice = {
    ...scopeDeviceRest,
    establishment: "device-authenticated" as const,
    authenticationContext: { authenticationContextId: "auth-001" },
    managedAccessSession: masDevice,
  };

  it("an absent establishment discriminator parses AS credential-pair — the pre-dual-form bytes are unchanged, and the parse OUTPUT states the path explicitly", () => {
    const { establishment: _e, ...bare } = reviewedScope;
    const parsed = ReviewedScopeSchema.parse(bare) as { establishment: string };
    expect(parsed.establishment).toBe("credential-pair");
    const { establishment: _e2, ...bareMas } = managedAccessSession;
    const parsedMas = ManagedAccessSessionBindingSchema.parse(bareMas) as { establishment: string };
    expect(parsedMas.establishment).toBe("credential-pair");
  });

  it("a device-authenticated session binding round-trips with NO token identities — the authenticationContext reference is the establishing authority", () => {
    roundTrip(ManagedAccessSessionBindingSchema, masDevice);
  });

  it("a device-authenticated binding REJECTS a present accountToken / deviceWorkloadIdentity (no token identity may be fabricated)", () => {
    expect(() => ManagedAccessSessionBindingSchema.parse({ ...masDevice, accountToken: { tokenId: "tok-1", revision: "5" } })).toThrow();
    expect(() => ManagedAccessSessionBindingSchema.parse({ ...masDevice, deviceWorkloadIdentity })).toThrow();
  });

  it("a device-authenticated ReviewedScope round-trips: authenticationContext + deviceInstance, no token fields", () => {
    roundTrip(ReviewedScopeSchema, scopeDevice);
  });

  it("a device-authenticated scope REJECTS token identities at top level", () => {
    expect(() => ReviewedScopeSchema.parse({ ...scopeDevice, accountToken: { tokenId: "tok-1", revision: "5" } })).toThrow();
    expect(() => ReviewedScopeSchema.parse({ ...scopeDevice, deviceWorkloadIdentity })).toThrow();
  });

  it("a device-authenticated scope REQUIRES its authenticationContext (the establishing authority is not optional)", () => {
    const { authenticationContext: _a, ...missing } = scopeDevice;
    expect(() => ReviewedScopeSchema.parse(missing as never)).toThrow();
  });

  it("the scope and its embedded session snapshot must agree on the establishing-authority path (a cross-path binding is a fork)", () => {
    expect(() => ReviewedScopeSchema.parse({ ...scopeDevice, managedAccessSession })).toThrow();
    // and the mirror image: a credential-pair scope binding a device-authenticated session
    expect(() => ReviewedScopeSchema.parse({ ...reviewedScope, managedAccessSession: masDevice })).toThrow();
  });

  it("an authentication-generation substitution under the same sessionId is rejected (§6.1 rule 5: the identifier IS the revision)", () => {
    expect(() =>
      ReviewedScopeSchema.parse({
        ...scopeDevice,
        managedAccessSession: { ...masDevice, authenticationContext: { authenticationContextId: "auth-002" } },
      }),
    ).toThrow();
  });

  it("a device-authenticated reviewedScope rides the enclosing AuditSnapshot unchanged (common-field consumers)", () => {
    roundTrip(AuditSnapshotSchema, {
      ...auditSnapshot,
      auditId: "aud-dev-1",
      reviewedScope: scopeDevice,
      decision: { outcome: "DENY" as const, reasonCode: "DENIED_POLICY" as const },
      grantRef: undefined,
    });
  });
});

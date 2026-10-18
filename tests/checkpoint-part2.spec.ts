import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_CONTRACT_VERSION,
  WorkloadRefSchema,
  workloadKey,
  AccountTokenClaimsSchema, // Account Token (formerly Device Token, docs#180)
  isTightening,
  ManagedAccessSessionSchema,
  ManagedAccessSessionState,
  ManagedAccessSessionStateSchema,
  ServiceSelectionSchema,
  isAllServicesSelection,
  canonicalizeServiceSelection,
  PrincipalRefSchema,
  AccountRefSchema,
  AccountTokenRefSchema,
  ChannelBindingSchema,
  DeviceInstanceRefSchema,
  DeviceWorkloadIdentityRefSchema,
  AuthenticationContextRefSchema,
  compareVersionTick,
  RevisionSchema,
  compareRevision,
} from "../src/index";
import * as contractsApi from "../src/index";

/* -------- shared fixtures -------- */

const checkpointRef = {
  serviceId: "linux-ops-widget-nodejs",
  workloadKind: "checkpoint" as const,
  ref: { serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: "1.0.0" },
};

const resourceRef = {
  serviceId: "linux-ops-widget-nodejs",
  workloadKind: "resource" as const,
  ref: {
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    segments: [
      { type: "host", id: "host-001" },
      { type: "service", id: "nginx" },
    ],
  },
};

// device-bound base fixture; unbound / instance-bound variants are derived in
// the channel-binding tests below.
const baseClaims = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  token: { tokenId: "tok-001", revision: "3" },
  account: { accountId: "acct-42" },
  channelBinding: { kind: "device" as const, deviceId: "device-0001" },
  issuedAtVersion: "1.0.0",
  notBeforeVersion: "1.0.0",
  expiresAtVersion: "2.0.0",
  boundWorkloads: [checkpointRef, resourceRef],
  tighteningOnly: true as const,
};


describe("#117 narrow-only scope axes on AccountTokenClaims", () => {
  it("accepts the three axes and keeps absence = unlimited", () => {
    const scoped = AccountTokenClaimsSchema.parse({
      ...baseClaims,
      allowedServices: ["linux-ops-widget-nodejs", "self"],
      allowedCheckpoints: ["self.whoami", "svc.restart"],
      riskCeiling: "MEDIUM",
    });
    expect(scoped.allowedServices).toEqual(["linux-ops-widget-nodejs", "self"]);
    expect(AccountTokenClaimsSchema.parse(baseClaims).allowedServices).toBeUndefined();
  });

  it("enforces the canonical wire order (strict ascending, duplicates rejected) and BARE checkpointIds", () => {
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, allowedServices: ["self", "linux-ops-widget-nodejs"] })).toThrow(/ascending/);
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, allowedServices: ["self", "self"] })).toThrow(/ascending/);
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, allowedCheckpoints: ["svc.restart", "self.whoami"] })).toThrow(/ascending/);
    // bare logical ids only: a versioned or uppercase spelling is refused
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, allowedCheckpoints: ["self.whoami@1.0.0"] })).toThrow(/BARE/);
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, allowedCheckpoints: ["Self.Whoami"] })).toThrow(/BARE/);
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, allowedServices: [] })).toThrow();
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, riskCeiling: "EXTREME" })).toThrow();
  });

  it("isTightening: absent→present narrows; present→absent (return to unlimited) is refused, per axis", () => {
    const prev = AccountTokenClaimsSchema.parse(baseClaims);
    const scoped = AccountTokenClaimsSchema.parse({ ...baseClaims, allowedServices: ["self"], allowedCheckpoints: ["self.whoami"], riskCeiling: "HIGH" });
    expect(isTightening(prev, scoped)).toBe(true); // unlimited -> scoped
    expect(isTightening(scoped, prev)).toBe(false); // scoped -> unlimited
    expect(isTightening(scoped, AccountTokenClaimsSchema.parse({ ...baseClaims, allowedCheckpoints: ["self.whoami"], riskCeiling: "HIGH" }))).toBe(false); // allowedServices returned to unlimited
    expect(isTightening(scoped, AccountTokenClaimsSchema.parse({ ...baseClaims, allowedServices: ["self"], allowedCheckpoints: ["self.whoami"] }))).toBe(false); // riskCeiling returned to unlimited
  });

  it("isTightening: a present list may only shrink; a present ceiling may only lower", () => {
    const scoped = AccountTokenClaimsSchema.parse({ ...baseClaims, allowedServices: ["linux-ops-widget-nodejs", "self"], riskCeiling: "MEDIUM" });
    expect(isTightening(scoped, AccountTokenClaimsSchema.parse({ ...baseClaims, allowedServices: ["self"], riskCeiling: "LOW" }))).toBe(true);
    expect(isTightening(scoped, AccountTokenClaimsSchema.parse({ ...baseClaims, allowedServices: ["another-widget", "self"], riskCeiling: "MEDIUM" }))).toBe(false); // added a service
    expect(isTightening(scoped, AccountTokenClaimsSchema.parse({ ...baseClaims, allowedServices: ["linux-ops-widget-nodejs", "self"], riskCeiling: "HIGH" }))).toBe(false); // raised the ceiling
  });
});

// "linux-ops-widget-nodejs" < "self" by Unicode code unit ('l'=0x6c < 's'=0x73), so the
// canonical strict-ascending explicit selection is ["linux-ops-widget-nodejs","self"].
const session = {
  establishment: "credential-pair" as const,
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  sessionId: "sess_ABC123",
  account: { accountId: "acct-42" },
  accountToken: { tokenId: "tok-001", revision: "3" },
  deviceWorkloadIdentity: {
    workloadIdentityId: "wl-001",
    credentialRevision: "1",
    deviceType: "xtrape-mcp",
    deviceInstanceId: "di-001",
  },
  deviceInstance: { deviceType: "xtrape-mcp", deviceInstanceId: "di-001" },
  serviceSelection: { scope: "explicit" as const, services: ["linux-ops-widget-nodejs", "self"] },
  authenticationContext: { authenticationContextId: "auth-001" },
  createdAtVersion: "1.0.0",
  expiresAtVersion: "2.0.0",
  state: "ACTIVE" as const,
};

/* ================================================================== */

describe("#59 part 2 slice A — WorkloadRef (arch/16 §2)", () => {
  it("round-trips a checkpoint and a resource workload (parse -> JSON -> parse)", () => {
    for (const sample of [checkpointRef, resourceRef]) {
      const parsed = WorkloadRefSchema.parse(sample);
      const round = WorkloadRefSchema.parse(JSON.parse(JSON.stringify(parsed)));
      expect(round).toEqual(parsed);
    }
  });

  it("serviceId is a logical Service id, not a legacy svc_* instance id", () => {
    expect(() => WorkloadRefSchema.parse({ ...checkpointRef, serviceId: "svc_ops" })).toThrow();
  });

  it("rejects an unknown field (strict, closed surface)", () => {
    expect(() => WorkloadRefSchema.parse({ ...checkpointRef, extra: true })).toThrow();
    expect(() => WorkloadRefSchema.parse({ ...resourceRef, extra: true })).toThrow();
  });

  it("rejects an unknown workloadKind branch", () => {
    expect(() =>
      WorkloadRefSchema.parse({ serviceId: "linux-ops-widget-nodejs", workloadKind: "action", ref: checkpointRef.ref }),
    ).toThrow();
  });

  it("rejects a ref that does not match its kind", () => {
    expect(() =>
      WorkloadRefSchema.parse({ serviceId: "linux-ops-widget-nodejs", workloadKind: "checkpoint", ref: resourceRef.ref }),
    ).toThrow();
    expect(() =>
      WorkloadRefSchema.parse({ serviceId: "linux-ops-widget-nodejs", workloadKind: "resource", ref: checkpointRef.ref }),
    ).toThrow();
  });

  it("rejects a checkpoint whose ref.serviceId contradicts the workload serviceId", () => {
    expect(() =>
      WorkloadRefSchema.parse({
        serviceId: "linux-ops-widget-nodejs",
        workloadKind: "checkpoint",
        ref: { serviceId: "anyapi", checkpointId: "service.status", checkpointVersion: "1.0.0" },
      }),
    ).toThrow();
  });
});

describe("#59 part 2 slice A — workloadKey stability + fail-closed", () => {
  it("is stable and distinguishes kinds and services", () => {
    expect(workloadKey(checkpointRef)).toBe(workloadKey(WorkloadRefSchema.parse(checkpointRef)));
    expect(workloadKey(checkpointRef)).not.toBe(workloadKey(resourceRef));
    expect(workloadKey(resourceRef)).toContain("resource");
    expect(workloadKey(checkpointRef)).toContain("checkpoint");
  });

  it("fails closed: an invalid ref cannot produce a colliding key (re-parsed at entry)", () => {
    // a serviceId carrying the U+001F key separator would be needed to forge a
    // collision; the kebab regex rejects it before any key is built.
    const forged = { serviceId: "opslinux", workloadKind: "resource", ref: resourceRef.ref };
    expect(() => workloadKey(forged as never)).toThrow();
  });

  it("distinct resources under the same service produce distinct keys", () => {
    const other = {
      ...resourceRef,
      ref: { contractVersion: CHECKPOINT_CONTRACT_VERSION, segments: [{ type: "host", id: "host-002" }] },
    };
    expect(workloadKey(resourceRef)).not.toBe(workloadKey(other));
  });
});

describe("#59 part 2 slice A — AccountTokenClaims (arch/16 §2/§6)", () => {
  it("round-trips valid claims", () => {
    const parsed = AccountTokenClaimsSchema.parse(baseClaims);
    const round = AccountTokenClaimsSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(round).toEqual(parsed);
  });

  it("carries contractVersion and rejects a wrong literal", () => {
    expect(AccountTokenClaimsSchema.parse(baseClaims).contractVersion).toBe(CHECKPOINT_CONTRACT_VERSION);
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, contractVersion: 2 })).toThrow();
    const { contractVersion: _drop, ...noVersion } = baseClaims;
    expect(() => AccountTokenClaimsSchema.parse(noVersion)).toThrow();
  });

  it("requires at least one bound workload", () => {
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, boundWorkloads: [] })).toThrow();
  });

  it("freezes tighteningOnly to the literal true", () => {
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, tighteningOnly: false })).toThrow();
  });

  it("rejects an unknown field and a wall-clock-style version tick", () => {
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, extra: 1 })).toThrow();
    expect(() => AccountTokenClaimsSchema.parse({ ...baseClaims, expiresAtVersion: "2026-07-26T00:00:00Z" })).toThrow();
  });

  it("channelBinding is optional: unbound / device-bound / instance-bound all parse", () => {
    const { channelBinding: _drop, ...unbound } = baseClaims;
    expect(AccountTokenClaimsSchema.parse(unbound).channelBinding).toBeUndefined();
    expect(AccountTokenClaimsSchema.parse(baseClaims).channelBinding).toEqual({
      kind: "device",
      deviceId: "device-0001",
    });
    const instanceBound = {
      ...baseClaims,
      channelBinding: { kind: "device-instance" as const, deviceId: "device-0001", deviceInstanceId: "di-001" },
    };
    expect(AccountTokenClaimsSchema.parse(instanceBound).channelBinding).toEqual(instanceBound.channelBinding);
  });

  it("channel binding requires an opaque, non-PII deviceId", () => {
    expect(() => ChannelBindingSchema.parse({ kind: "device", deviceId: "short" })).toThrow();
    expect(() => ChannelBindingSchema.parse({ kind: "device", deviceId: "Device_0001" })).toThrow(); // uppercase stays out
    // #118: the Platform-minted handle shape (`dev_` + 32 hex) parses; the
    // 128-char bound holds; a leading separator stays out
    expect(() =>
      ChannelBindingSchema.parse({ kind: "device", deviceId: `dev_${"a1".repeat(16)}` }),
    ).not.toThrow();
    expect(() => ChannelBindingSchema.parse({ kind: "device", deviceId: `d${"x".repeat(128)}` })).toThrow();
    expect(() => ChannelBindingSchema.parse({ kind: "device", deviceId: "_dev00000" })).toThrow();
  });

  it("channel binding is a CLOSED strict union: unknown kind / missing pair / extra keys rejected", () => {
    expect(() => ChannelBindingSchema.parse({ kind: "workload", deviceId: "device-0001" })).toThrow();
    // an instance binding must carry its device: the instance id alone would be
    // a second, ambiguous spelling of the device identity (platform-ce#150
    // boundDeviceId/boundDeviceInstanceId: both or neither).
    expect(() => ChannelBindingSchema.parse({ kind: "device-instance", deviceInstanceId: "di-001" })).toThrow();
    expect(() => ChannelBindingSchema.parse({ kind: "device", deviceId: "device-0001", extra: 1 })).toThrow();
    expect(() =>
      ChannelBindingSchema.parse({ kind: "device", deviceId: "device-0001", deviceInstanceId: "di-001" }),
    ).toThrow();
  });

  it("REGRESSION docs#180: the retired flat deviceId claims key is rejected (strict)", () => {
    const { channelBinding: _drop, ...unbound } = baseClaims;
    expect(() => AccountTokenClaimsSchema.parse({ ...unbound, deviceId: "device-0001" })).toThrow();
  });

  it("binds the token identity and the delegated Account (§165/§192)", () => {
    const parsed = AccountTokenClaimsSchema.parse(baseClaims);
    expect(parsed.token).toEqual({ tokenId: "tok-001", revision: "3" });
    expect(parsed.account).toEqual({ accountId: "acct-42" });
    const { token: _t, ...noToken } = baseClaims;
    const { account: _a, ...noAccount } = baseClaims;
    expect(() => AccountTokenClaimsSchema.parse(noToken)).toThrow();
    expect(() => AccountTokenClaimsSchema.parse(noAccount)).toThrow();
  });
});

describe("#59 part 2 slice A — isTightening (narrow-only re-derivation)", () => {
  it("identical claims are a (trivial) tightening", () => {
    expect(isTightening(baseClaims, baseClaims)).toBe(true);
  });

  it("a subset of workloads with a shrunk window is a tightening", () => {
    const next = {
      ...baseClaims,
      notBeforeVersion: "1.5.0",
      expiresAtVersion: "1.9.0",
      boundWorkloads: [checkpointRef],
    };
    expect(isTightening(baseClaims, next)).toBe(true);
  });

  it("adding a workload is a widening -> false", () => {
    const extra = {
      ...resourceRef,
      ref: { contractVersion: CHECKPOINT_CONTRACT_VERSION, segments: [{ type: "host", id: "host-002" }] },
    };
    const next = { ...baseClaims, boundWorkloads: [...baseClaims.boundWorkloads, extra] };
    expect(isTightening(baseClaims, next)).toBe(false);
  });

  it("widening the expiry -> false", () => {
    expect(isTightening(baseClaims, { ...baseClaims, expiresAtVersion: "3.0.0" })).toBe(false);
  });

  it("moving notBefore earlier -> false", () => {
    const prev = { ...baseClaims, notBeforeVersion: "1.5.0" };
    expect(isTightening(prev, { ...prev, notBeforeVersion: "1.0.0" })).toBe(false);
  });

  // Channel-binding lattice (docs#180): unbound ⊒ device-bound ⊒ instance-bound
  // on the SAME device. Round-1 runtime (platform-ce#148) may refuse sessions
  // from unbound tokens — a runtime profile, not part of this predicate.
  const { channelBinding: _cb, ...unboundClaims } = baseClaims;
  const deviceBound = baseClaims; // { kind: "device", deviceId: "device-0001" }
  const instanceBound = {
    ...baseClaims,
    channelBinding: { kind: "device-instance" as const, deviceId: "device-0001", deviceInstanceId: "di-001" },
  };

  it("unbound -> unbound / device-bound / instance-bound are all tightenings", () => {
    expect(isTightening(unboundClaims, unboundClaims)).toBe(true);
    expect(isTightening(unboundClaims, deviceBound)).toBe(true);
    expect(isTightening(unboundClaims, instanceBound)).toBe(true);
  });

  it("device-bound -> same device (kept, or narrowed to one of its instances) tightens", () => {
    expect(isTightening(deviceBound, deviceBound)).toBe(true);
    expect(isTightening(deviceBound, instanceBound)).toBe(true);
  });

  it("removing a binding is a widening -> false", () => {
    expect(isTightening(deviceBound, unboundClaims)).toBe(false);
    expect(isTightening(instanceBound, unboundClaims)).toBe(false);
  });

  it("swapping to a different device or an unrelated instance -> false", () => {
    expect(
      isTightening(deviceBound, { ...baseClaims, channelBinding: { kind: "device", deviceId: "device-0002" } }),
    ).toBe(false);
    expect(
      isTightening(deviceBound, {
        ...baseClaims,
        channelBinding: { kind: "device-instance", deviceId: "device-0002", deviceInstanceId: "di-001" },
      }),
    ).toBe(false);
  });

  it("instance-bound -> only the IDENTICAL (deviceId, deviceInstanceId) tightens", () => {
    expect(isTightening(instanceBound, instanceBound)).toBe(true);
    expect(
      isTightening(instanceBound, {
        ...baseClaims,
        channelBinding: { kind: "device-instance", deviceId: "device-0001", deviceInstanceId: "di-002" },
      }),
    ).toBe(false);
    // relaxing back to device-bound un-narrows -> false
    expect(isTightening(instanceBound, deviceBound)).toBe(false);
  });

  it("a different delegated Account is never a tightening", () => {
    expect(isTightening(baseClaims, { ...baseClaims, account: { accountId: "acct-99" } })).toBe(false);
  });

  it("a different token identity is never a tightening (must be a new revision of the SAME token)", () => {
    // a different tokenId is a different token, not a narrowing of this one;
    // a new revision of the SAME token, with a subset+shrink, still tightens.
    expect(isTightening(baseClaims, { ...baseClaims, token: { tokenId: "tok-999", revision: "4" } })).toBe(false);
    const narrowerNewRevision = {
      ...baseClaims,
      token: { tokenId: "tok-001", revision: "4" },
      expiresAtVersion: "1.9.0",
      boundWorkloads: [checkpointRef],
    };
    expect(isTightening(baseClaims, narrowerNewRevision)).toBe(true);
  });

  it("fails closed on structurally invalid claims", () => {
    expect(() => isTightening({ ...baseClaims, tighteningOnly: false } as never, baseClaims)).toThrow();
  });

  it("rejects a widened expiry that differs only BEYOND 2^53 (BigInt precision)", () => {
    // 9007199254740993 vs …992 are indistinguishable as JS numbers; a widened
    // expiry beyond 2^53 must NOT be silently accepted as a tightening.
    const prev = { ...baseClaims, expiresAtVersion: "0.0.9007199254740992" };
    const widened = { ...baseClaims, expiresAtVersion: "0.0.9007199254740993" };
    expect(isTightening(prev, widened)).toBe(false);
    // and the symmetric shrink IS a tightening
    expect(isTightening(widened, prev)).toBe(true);
  });
});

describe("#59 part 2 slice A — version tick ordering (BigInt precision)", () => {
  it("compares SemVer components numerically and fails closed", () => {
    expect(compareVersionTick("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersionTick("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersionTick("10.0.0", "2.0.0")).toBe(1);
    expect(() => compareVersionTick("1.0", "1.0.0")).toThrow();
  });

  it("distinguishes segments far above 2^53 (no Number precision loss)", () => {
    // Number("...993") === Number("...992") === 9007199254740992 -> would give 0.
    expect(compareVersionTick("0.0.9007199254740993", "0.0.9007199254740992")).toBe(1);
    expect(compareVersionTick("0.0.9007199254740992", "0.0.9007199254740993")).toBe(-1);
    expect(compareVersionTick("0.0.9007199254740993", "0.0.9007199254740993")).toBe(0);
  });
});

describe("#59 part 2 slice A — Revision (JSON-number-safe decimal string)", () => {
  it("accepts a non-negative integer as a decimal string, including beyond 2^53", () => {
    for (const v of ["0", "1", "9007199254740993"]) {
      expect(RevisionSchema.parse(v)).toBe(v);
    }
  });

  it("rejects leading zeros, negatives, decimals, empty, and a JS number", () => {
    for (const v of ["01", "-1", "1.0", ""]) {
      expect(() => RevisionSchema.parse(v)).toThrow();
    }
    // a JS number is not a string on the wire and must be rejected.
    expect(() => RevisionSchema.parse(1 as never)).toThrow();
  });

  it("compareRevision orders exactly beyond 2^53 (BigInt) and fails closed", () => {
    expect(compareRevision("0", "0")).toBe(0);
    expect(compareRevision("2", "10")).toBe(-1);
    expect(compareRevision("9007199254740993", "9007199254740992")).toBe(1);
    expect(() => compareRevision("01", "1")).toThrow();
  });
});

describe("#59 part 2 slice A — Principal ref (arch/16 §2)", () => {
  it("aligns principalType with AuditActorType (USER/AGENT/SYSTEM) and rejects others", () => {
    for (const t of ["USER", "AGENT", "SYSTEM"]) {
      expect(() => PrincipalRefSchema.parse({ principalType: t, principalId: "p-1234" })).not.toThrow();
    }
    expect(() => PrincipalRefSchema.parse({ principalType: "ROBOT", principalId: "p-1234" })).toThrow();
  });

  it("rejects an unknown field", () => {
    expect(() => PrincipalRefSchema.parse({ principalType: "USER", principalId: "p-1", extra: 1 })).toThrow();
  });
});

describe("#59 part 2 slice A — ServiceSelection (arch/16 §49, §440-§465)", () => {
  it("scope:all round-trips and is recognized by the helper", () => {
    const parsed = ServiceSelectionSchema.parse({ scope: "all" });
    expect(ServiceSelectionSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(isAllServicesSelection({ scope: "all" })).toBe(true);
    expect(isAllServicesSelection({ scope: "explicit", services: ["linux-ops-widget-nodejs"] })).toBe(false);
  });

  it("accepts a strict-ascending explicit selection (self is a valid Service id, §12/§498)", () => {
    // sanity: verify the ordering direction with a real JS `<` comparison so the
    // test asserts the correct canonical direction ('l'=0x6c < 's'=0x73).
    expect("linux-ops-widget-nodejs" < "self").toBe(true);
    const parsed = ServiceSelectionSchema.parse({ scope: "explicit", services: ["linux-ops-widget-nodejs", "self"] });
    expect(parsed).toEqual({ scope: "explicit", services: ["linux-ops-widget-nodejs", "self"] });
  });

  it("rejects a non-canonical (non-ascending) explicit selection (§454/§462 wire order)", () => {
    // ["self","linux-ops-widget-nodejs"] is semantically equal but NOT strict-ascending -> rejected, not sorted.
    expect(() => ServiceSelectionSchema.parse({ scope: "explicit", services: ["self", "linux-ops-widget-nodejs"] })).toThrow();
  });

  it("rejects duplicate services (strict-ascending subsumes the §454 fail-safe)", () => {
    expect(() => ServiceSelectionSchema.parse({ scope: "explicit", services: ["linux-ops-widget-nodejs", "linux-ops-widget-nodejs"] })).toThrow();
  });

  it("canonicalizeServiceSelection sorts + dedups into a schema-valid selection", () => {
    const canonical = canonicalizeServiceSelection({
      scope: "explicit",
      services: ["self", "linux-ops-widget-nodejs", "linux-ops-widget-nodejs", "anyapi"],
    });
    expect(canonical).toEqual({ scope: "explicit", services: ["anyapi", "linux-ops-widget-nodejs", "self"] });
    // its output passes the schema (canonical wire order, no duplicates).
    expect(() => ServiceSelectionSchema.parse(canonical)).not.toThrow();
    // scope:all passes through unchanged.
    expect(canonicalizeServiceSelection({ scope: "all" })).toEqual({ scope: "all" });
  });

  it("canonicalizeServiceSelection fails closed on malformed input (parses at entry)", () => {
    // an empty explicit array must not yield the schema-invalid {scope:"explicit",services:[]}
    expect(() => canonicalizeServiceSelection({ scope: "explicit", services: [] } as never)).toThrow();
    // an unknown scope must not be silently rewritten to "explicit"
    expect(() => canonicalizeServiceSelection({ scope: "some", services: ["linux-ops-widget-nodejs"] } as never)).toThrow();
    // an unknown field on scope:all must not be accepted-and-dropped
    expect(() => canonicalizeServiceSelection({ scope: "all", extra: 1 } as never)).toThrow();
    // an unknown field on an explicit selection is rejected too
    expect(() =>
      canonicalizeServiceSelection({ scope: "explicit", services: ["linux-ops-widget-nodejs"], extra: 1 } as never),
    ).toThrow();
    // an invalid Service id is rejected
    expect(() => canonicalizeServiceSelection({ scope: "explicit", services: ["Bad_Id"] } as never)).toThrow();
  });

  it("rejects an empty explicit services array", () => {
    expect(() => ServiceSelectionSchema.parse({ scope: "explicit", services: [] })).toThrow();
  });

  it("rejects an unknown scope branch", () => {
    expect(() => ServiceSelectionSchema.parse({ scope: "some", services: ["linux-ops-widget-nodejs"] })).toThrow();
  });

  it("rejects a stray checkpoint field (a filter carries no authorization identity)", () => {
    expect(() =>
      ServiceSelectionSchema.parse({
        scope: "explicit",
        services: ["linux-ops-widget-nodejs"],
        checkpoint: { serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: "1.0.0" },
      }),
    ).toThrow();
    expect(() => ServiceSelectionSchema.parse({ scope: "all", extra: 1 })).toThrow();
  });

  it("rejects a legacy svc_* Service id in an explicit selection", () => {
    expect(() => ServiceSelectionSchema.parse({ scope: "explicit", services: ["svc_ops"] })).toThrow();
  });
});

describe("#59 part 2 slice A — Managed Access Session identity sub-refs", () => {
  it("each ref rejects an unknown field (strict, closed)", () => {
    expect(() => AccountRefSchema.parse({ accountId: "acct-1", extra: 1 })).toThrow();
    expect(() => AccountTokenRefSchema.parse({ tokenId: "tok-1", revision: "0", extra: 1 })).toThrow();
    expect(() => DeviceInstanceRefSchema.parse({ deviceType: "cli", deviceInstanceId: "di-1", extra: 1 })).toThrow();
    expect(() =>
      DeviceWorkloadIdentityRefSchema.parse({
        workloadIdentityId: "wl-1",
        credentialRevision: "0",
        deviceType: "cli",
        deviceInstanceId: "di-1",
        extra: 1,
      }),
    ).toThrow();
    expect(() => AuthenticationContextRefSchema.parse({ authenticationContextId: "auth-1", extra: 1 })).toThrow();
  });

  it("revision counters are JSON-number-safe decimal strings (reject numbers/negatives/leading-zeros)", () => {
    expect(() => AccountTokenRefSchema.parse({ tokenId: "tok-1", revision: 0 })).toThrow(); // a JS number, not a string
    expect(() => AccountTokenRefSchema.parse({ tokenId: "tok-1", revision: "-1" })).toThrow();
    expect(() => AccountTokenRefSchema.parse({ tokenId: "tok-1", revision: "01" })).toThrow();
    expect(AccountTokenRefSchema.parse({ tokenId: "tok-1", revision: "0" }).revision).toBe("0");
    expect(() =>
      DeviceWorkloadIdentityRefSchema.parse({
        workloadIdentityId: "wl-1",
        credentialRevision: "-1",
        deviceType: "cli",
        deviceInstanceId: "di-1",
      }),
    ).toThrow();
  });

  it("DeviceWorkloadIdentityRef requires the full Device Instance identity (deviceType + deviceInstanceId)", () => {
    const { deviceType: _dt, ...noType } = session.deviceWorkloadIdentity;
    expect(() => DeviceWorkloadIdentityRefSchema.parse(noType)).toThrow();
    expect(() => DeviceWorkloadIdentityRefSchema.parse({ ...session.deviceWorkloadIdentity, deviceType: "svc_mcp" })).toThrow();
    expect(() => DeviceWorkloadIdentityRefSchema.parse(session.deviceWorkloadIdentity)).not.toThrow();
  });

  it("deviceType is a logical kebab Device type (rejects svc_* / uppercase)", () => {
    expect(() => DeviceInstanceRefSchema.parse({ deviceType: "svc_mcp", deviceInstanceId: "di-1" })).toThrow();
    expect(() => DeviceInstanceRefSchema.parse({ deviceType: "XtrapeMcp", deviceInstanceId: "di-1" })).toThrow();
    expect(() => DeviceInstanceRefSchema.parse({ deviceType: "xtrape-mcp", deviceInstanceId: "di-1" })).not.toThrow();
  });
});

describe("#59 part 2 slice A — ManagedAccessSession (composite binding, arch/16 §2/§6)", () => {
  it("round-trips a full valid composite session", () => {
    const parsed = ManagedAccessSessionSchema.parse(session);
    const round = ManagedAccessSessionSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(round).toEqual(parsed);
  });

  it("also accepts a scope:all Service Selection", () => {
    expect(() => ManagedAccessSessionSchema.parse({ ...session, serviceSelection: { scope: "all" } })).not.toThrow();
  });

  it("carries contractVersion first and rejects a wrong literal", () => {
    expect(() => ManagedAccessSessionSchema.parse({ ...session, contractVersion: 2 })).toThrow();
  });

  it("rejects each missing composite binding", () => {
    for (const key of [
      "account",
      "accountToken",
      "deviceWorkloadIdentity",
      "deviceInstance",
      "serviceSelection",
      "authenticationContext",
    ] as const) {
      const { [key]: _drop, ...rest } = session;
      expect(() => ManagedAccessSessionSchema.parse(rest)).toThrow();
    }
  });

  it("rejects an unknown field (strict, closed surface)", () => {
    expect(() => ManagedAccessSessionSchema.parse({ ...session, extra: true })).toThrow();
  });

  it("REGRESSION docs#180: wire field is accountToken; the retired deviceToken key is rejected", () => {
    // the fixture itself carries accountToken and parses (asserted above); a
    // document still spelling the pre-rename deviceToken key must fail strict.
    expect(ManagedAccessSessionSchema.parse(session).accountToken).toEqual({ tokenId: "tok-001", revision: "3" });
    const { accountToken, ...rest } = session;
    expect(() => ManagedAccessSessionSchema.parse({ ...rest, deviceToken: accountToken })).toThrow();
  });

  it("binds the FULL Device Instance identity: rejects a deviceInstanceId OR deviceType mismatch (§35/§2)", () => {
    const instanceMismatch = {
      ...session,
      deviceWorkloadIdentity: { ...session.deviceWorkloadIdentity, deviceInstanceId: "di-999" },
    };
    expect(() => ManagedAccessSessionSchema.parse(instanceMismatch)).toThrow();
    // deviceType mismatches even though deviceInstanceId matches -> still rejected.
    const typeMismatch = {
      ...session,
      deviceWorkloadIdentity: { ...session.deviceWorkloadIdentity, deviceType: "cli" },
    };
    expect(() => ManagedAccessSessionSchema.parse(typeMismatch)).toThrow();
    // both matching -> accepted.
    expect(() => ManagedAccessSessionSchema.parse(session)).not.toThrow();
  });

  it("rejects created > expires (bounded lifetime ordering)", () => {
    expect(() =>
      ManagedAccessSessionSchema.parse({ ...session, createdAtVersion: "3.0.0", expiresAtVersion: "2.0.0" }),
    ).toThrow();
    // equal is allowed (well-ordered)
    expect(() =>
      ManagedAccessSessionSchema.parse({ ...session, createdAtVersion: "2.0.0", expiresAtVersion: "2.0.0" }),
    ).not.toThrow();
  });
});

describe("#59 part 2 slice A — ManagedAccessSessionState (§219 propagation, no cancel)", () => {
  it("has exactly ACTIVE/CLOSED/EXPIRED/REVOKED/INVALIDATED and no CANCELLED/OPENED", () => {
    expect(ManagedAccessSessionState).toEqual(["ACTIVE", "CLOSED", "EXPIRED", "REVOKED", "INVALIDATED"]);
    expect(() => ManagedAccessSessionStateSchema.parse("CANCELLED")).toThrow();
    expect(() => ManagedAccessSessionStateSchema.parse("OPENED")).toThrow();
  });

  it("accepts every enum value in a full session and rejects an unknown state", () => {
    for (const state of ManagedAccessSessionState) {
      expect(() => ManagedAccessSessionSchema.parse({ ...session, state })).not.toThrow();
    }
    expect(() => ManagedAccessSessionSchema.parse({ ...session, state: "PAUSED" })).toThrow();
  });
});

describe("docs#180 — exported API surface: AccountToken*, no DeviceToken*", () => {
  it("exports the AccountToken* schemas and ChannelBindingSchema", () => {
    expect(contractsApi.AccountTokenRefSchema).toBeDefined();
    expect(contractsApi.AccountTokenClaimsSchema).toBeDefined();
    expect(contractsApi.ChannelBindingSchema).toBeDefined();
  });

  it("no longer exports any DeviceToken* identifier (pre-release rename, no alias)", () => {
    const legacyExports = Object.keys(contractsApi).filter((name) => name.includes("DeviceToken"));
    expect(legacyExports).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_CONTRACT_VERSION,
  CheckpointDefinitionSchema,
  CheckpointVersionIdSchema,
  checkpointVersionKey,
  ResourceReferenceSchema,
  ResourceSelectorSchema,
  canonicalResourceString,
  encodeResourceId,
  resourceContains,
  selectorMatches,
  riskRank,
  dataClassificationRank,
  RiskLevel,
  DataClassification,
} from "../src/index";

const DIGEST = "sha256:" + "a".repeat(64);

const SCHEMA_REF = { schemaRecord: DIGEST };

/** The arch/16 §17 reference Checkpoint: linux-ops-widget-nodejs.service.status (READ_ONLY, low risk). */
const statusCheckpoint = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  id: { serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: "1.0.0" },
  inputSchema: SCHEMA_REF,
  outputSchema: SCHEMA_REF,
  resourceExtraction: {
    kind: "extractor-artifact" as const,
    artifactDigest: DIGEST,
    executionProfileRecord: DIGEST,
    artifactId: "linux-ops-widget-nodejs-resource-extractor",
  },
  sideEffect: "READ_ONLY" as const,
  risk: "LOW" as const,
  sensitivity: { inputUpperBound: "INTERNAL" as const, outputUpperBound: "INTERNAL" as const },
  idempotency: "IDEMPOTENT" as const,
  delivery: "AT_LEAST_ONCE" as const,
  retry: "IDEMPOTENT_REPLAY" as const,
  execution: "SYNC" as const,
  action: { actionId: "getServiceStatus" },
  localPreconditions: ["host reachable", "service unit exists"],
};

describe("Controlled Exposure contracts #59 part 1 — Checkpoint + Resource", () => {
  it("round-trips a valid Checkpoint definition", () => {
    const parsed = CheckpointDefinitionSchema.parse(statusCheckpoint);
    expect(parsed.id.serviceId).toBe("linux-ops-widget-nodejs");
    expect(parsed.sideEffect).toBe("READ_ONLY");
    expect(checkpointVersionKey(parsed.id)).toBe("linux-ops-widget-nodejs/service.status@1.0.0");
  });

  it("rejects a non-semver checkpointVersion", () => {
    expect(() =>
      CheckpointVersionIdSchema.parse({ serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: "1.0" }),
    ).toThrow();
  });

  it("rejects a Tool-name-style checkpointId (projection is not authorization identity)", () => {
    expect(() =>
      CheckpointVersionIdSchema.parse({ serviceId: "linux-ops-widget-nodejs", checkpointId: "Service Status", checkpointVersion: "1.0.0" }),
    ).toThrow();
  });

  it("serviceId is a logical Service id (linux-ops-widget-nodejs), not a legacy svc_* instance id", () => {
    expect(() =>
      CheckpointVersionIdSchema.parse({ serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: "1.0.0" }),
    ).not.toThrow();
    for (const legacy of ["svc_abc", "svc_0001", "svc_ops"]) {
      expect(() =>
        CheckpointVersionIdSchema.parse({ serviceId: legacy, checkpointId: "service.status", checkpointVersion: "1.0.0" }),
      ).toThrow();
    }
  });

  it("freezes the risk and data-classification total orders", () => {
    expect(RiskLevel).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    expect(DataClassification).toEqual(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "SECRET"]);
    expect(riskRank("LOW")).toBeLessThan(riskRank("MEDIUM"));
    expect(riskRank("MEDIUM")).toBeLessThan(riskRank("HIGH"));
    expect(riskRank("HIGH")).toBeLessThan(riskRank("CRITICAL"));
    expect(dataClassificationRank("PUBLIC")).toBeLessThan(dataClassificationRank("INTERNAL"));
    expect(dataClassificationRank("CONFIDENTIAL")).toBeLessThan(dataClassificationRank("SECRET"));
  });

  it("rank helpers fail closed on an illegal value (never returns -1 / below the minimum)", () => {
    expect(() => riskRank("BOGUS" as unknown as (typeof RiskLevel)[number])).toThrow();
    expect(() => dataClassificationRank("BOGUS" as unknown as (typeof DataClassification)[number])).toThrow();
  });

  it("freezes checkpointVersion as core SemVer (no leading zeros / prerelease / build)", () => {
    for (const bad of ["01.0.0", "1.02.3", "1.2.03", "1.2", "1.2.3-rc1", "1.2.3+build", "v1.2.3"]) {
      expect(() =>
        CheckpointVersionIdSchema.parse({ serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: bad }),
      ).toThrow();
    }
    for (const ok of ["0.0.0", "1.2.3", "10.20.30"]) {
      expect(() =>
        CheckpointVersionIdSchema.parse({ serviceId: "linux-ops-widget-nodejs", checkpointId: "service.status", checkpointVersion: ok }),
      ).not.toThrow();
    }
  });

  it("SchemaRef references an immutable Platform schema record by digest (not raw bytes/dialect on the wire)", () => {
    // malformed record digest is rejected
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, inputSchema: { schemaRecord: "deadbeef" } })).toThrow();
    // the old raw-bytes/dialect shape is rejected — consumers don't re-interpret bytes
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, inputSchema: { digest: DIGEST } })).toThrow();
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, inputSchema: {} })).toThrow();
    // no inline jsonSchema (deferred); unknown fields rejected
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, inputSchema: { ...SCHEMA_REF, jsonSchema: { type: "object" } } })).toThrow();
  });

  it("has no self-referential definition digest field (deferred canonical-digest contract)", () => {
    const parsed = CheckpointDefinitionSchema.parse(statusCheckpoint);
    expect("definitionDigest" in parsed).toBe(false);
    // a stray definitionDigest is rejected as an unknown field (strict surface).
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, definitionDigest: DIGEST })).toThrow();
  });

  it("rejects unknown fields (strict; immutable surface must be explicit)", () => {
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, extra: true })).toThrow();
  });

  it("accepts the extractor-artifact resource extraction whose identity is versioned", () => {
    const parsed = CheckpointDefinitionSchema.parse(statusCheckpoint);
    expect(parsed.resourceExtraction.kind).toBe("extractor-artifact");
  });

  it("accepts an extractor-artifact without artifactId (optional / non-authoritative)", () => {
    const parsed = CheckpointDefinitionSchema.parse({
      ...statusCheckpoint,
      resourceExtraction: { kind: "extractor-artifact", artifactDigest: DIGEST, executionProfileRecord: DIGEST },
    });
    expect(parsed.resourceExtraction).not.toHaveProperty("artifactId");
  });

  it("requires an admitted executionProfileRecord digest (ABI is bound by an immutable record)", () => {
    // missing profile record is rejected
    expect(() =>
      CheckpointDefinitionSchema.parse({
        ...statusCheckpoint,
        resourceExtraction: { kind: "extractor-artifact", artifactDigest: DIGEST },
      }),
    ).toThrow();
    // malformed profile record digest is rejected
    expect(() =>
      CheckpointDefinitionSchema.parse({
        ...statusCheckpoint,
        resourceExtraction: { kind: "extractor-artifact", artifactDigest: DIGEST, executionProfileRecord: "not-a-digest" },
      }),
    ).toThrow();
  });

  it("splits idempotency / delivery / retry and enforces the legal combination", () => {
    // IDEMPOTENT_REPLAY requires IDEMPOTENT + AT_LEAST_ONCE
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, idempotency: "NON_IDEMPOTENT" })).toThrow();
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, delivery: "AT_MOST_ONCE" })).toThrow();
    // a non-idempotent, at-most-once, no-retry Checkpoint is a valid combination
    const restartLike = CheckpointDefinitionSchema.parse({
      ...statusCheckpoint,
      sideEffect: "EXTERNALLY_OBSERVABLE",
      idempotency: "NON_IDEMPOTENT",
      delivery: "AT_MOST_ONCE",
      retry: "NONE",
    });
    expect(restartLike.retry).toBe("NONE");
    // AT_MOST_ONCE was removed from the idempotency enum
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, idempotency: "AT_MOST_ONCE" })).toThrow();
  });

  it("rejects a declarative extraction kind (deferred to a frozen cross-language DSL)", () => {
    expect(() =>
      CheckpointDefinitionSchema.parse({
        ...statusCheckpoint,
        resourceExtraction: { kind: "declarative", rules: [{ segmentType: "host", fromInput: "/hostId" }] },
      }),
    ).toThrow();
  });

  it("requires localPreconditions explicitly on the wire (no Zod default)", () => {
    const { localPreconditions, ...without } = statusCheckpoint;
    void localPreconditions;
    expect(() => CheckpointDefinitionSchema.parse(without)).toThrow();
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, localPreconditions: [] })).not.toThrow();
  });
});

describe("Resource canonical byte encoding (arch/16 §2/§4 identity)", () => {
  it("is injective — delimiter chars in an id do not collide across structures", () => {
    const oneSegment = canonicalResourceString([{ type: "host", id: "h/service:nginx" }]);
    const twoSegments = canonicalResourceString([
      { type: "host", id: "h" },
      { type: "service", id: "nginx" },
    ]);
    expect(oneSegment).not.toBe(twoSegments);
    expect(twoSegments).toBe("host:h/service:nginx");
    expect(oneSegment).toBe("host:h%2Fservice%3Anginx");
  });

  it("frozen contract: NFC + UTF-8 + percent-encode every non-unreserved byte (uppercase)", () => {
    // RFC 3986 unreserved bytes pass through unchanged
    expect(encodeResourceId("Ab0-._~")).toBe("Ab0-._~");
    // escape + delimiter bytes are always encoded
    expect(encodeResourceId("%")).toBe("%25");
    expect(encodeResourceId(":")).toBe("%3A");
    expect(encodeResourceId("/")).toBe("%2F");
    // composed U+00E9 is NFC -> accepted; decomposed "e"+U+0301 is REJECTED (no silent repair)
    const composed = "\u00E9";
    const decomposed = "e\u0301";
    expect(encodeResourceId(composed)).toBe("%C3%A9");
    expect(() => encodeResourceId(decomposed)).toThrow();
    // empty and lone-surrogate inputs are rejected by the helper's own wire invariant
    expect(() => encodeResourceId("")).toThrow();
    expect(() => encodeResourceId("\uD800")).toThrow();
    // CJK -> UTF-8 bytes (U+670D U+52A1)
    expect(encodeResourceId("\u670D\u52A1")).toBe("%E6%9C%8D%E5%8A%A1"); // CJK 服务
    // NUL, newline, and other control bytes are encoded, never passed through
    expect(encodeResourceId("\u0000")).toBe("%00");
    expect(encodeResourceId("\u000A")).toBe("%0A");
    expect(encodeResourceId("\u0007")).toBe("%07");
  });

  it("identity helpers validate structural input and fail closed (no type / NFC bypass)", () => {
    // a 'type' carrying the ':' / '/' delimiters would collide with a two-segment
    // chain in the canonical string; the helper rejects it instead of trusting it.
    const forged = { contractVersion: CHECKPOINT_CONTRACT_VERSION, segments: [{ type: "host:x/service", id: "y" }] };
    const twoSeg = [
      { type: "host", id: "x" },
      { type: "service", id: "y" },
    ];
    expect(() => canonicalResourceString(forged.segments)).toThrow();
    expect(canonicalResourceString(twoSeg)).toBe("host:x/service:y");
    expect(() => resourceContains(forged, forged)).toThrow();
    // a non-NFC id is rejected at the helper entry as well (fail closed)
    const nonNfc = { contractVersion: CHECKPOINT_CONTRACT_VERSION, segments: [{ type: "service", id: "é" }] };
    expect(() => canonicalResourceString(nonNfc.segments)).toThrow();
    expect(() => resourceContains(nonNfc, nonNfc)).toThrow();
  });

  it("rejects lone surrogates but accepts valid surrogate pairs (Unicode scalar invariant)", () => {
    for (const bad of ["\uD800", "\uDC00", "a\uD800b"]) {
      expect(() =>
        ResourceReferenceSchema.parse({ contractVersion: CHECKPOINT_CONTRACT_VERSION, segments: [{ type: "service", id: bad }] }),
      ).toThrow();
    }
    const emoji = "\u{1F600}"; // astral char = valid surrogate pair
    expect(() =>
      ResourceReferenceSchema.parse({ contractVersion: CHECKPOINT_CONTRACT_VERSION, segments: [{ type: "service", id: emoji }] }),
    ).not.toThrow();
    expect(encodeResourceId(emoji)).toBe("%F0%9F%98%80");
    // U+FFFD is a real scalar value; it must not be confused with the rejected surrogates
    expect(encodeResourceId("�")).toBe("%EF%BF%BD");
  });
});

describe("Resource model — ancestry, containment, selectors (arch/16 §2/§4)", () => {
  const host = ResourceReferenceSchema.parse({
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    segments: [{ type: "host", id: "host-001" }],
  });
  const svc = ResourceReferenceSchema.parse({
    contractVersion: CHECKPOINT_CONTRACT_VERSION,
    segments: [
      { type: "host", id: "host-001" },
      { type: "service", id: "nginx" },
    ],
  });

  it("derives the canonical string from segments (canonical is not on the wire)", () => {
    expect(canonicalResourceString(svc.segments)).toBe("host:host-001/service:nginx");
    // a client-supplied canonical string cannot diverge from segments: it is rejected as unknown.
    expect(() =>
      ResourceReferenceSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        segments: [{ type: "host", id: "host-001" }],
        canonical: "host:evil",
      }),
    ).toThrow();
  });

  it("rejects a nested unknown field on a resource segment (strict immutable surface)", () => {
    expect(() =>
      ResourceReferenceSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        segments: [{ type: "host", id: "host-001", extra: true }],
      }),
    ).toThrow();
  });

  it("literal '*' is a valid Resource id, expressible by an exact selector", () => {
    const star = ResourceReferenceSchema.parse({
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      segments: [{ type: "service", id: "*" }],
    });
    const exactStar = ResourceSelectorSchema.parse({
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      matchDescendants: false,
      segments: [{ type: "service", match: "exact", id: "*" }],
    });
    const anySvc = ResourceSelectorSchema.parse({
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      matchDescendants: false,
      segments: [{ type: "service", match: "any" }],
    });
    const exactNginx = ResourceSelectorSchema.parse({
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      matchDescendants: false,
      segments: [{ type: "service", match: "exact", id: "nginx" }],
    });
    expect(selectorMatches(exactStar, star)).toBe(true); // exact selector can name '*'
    expect(selectorMatches(anySvc, star)).toBe(true); // wildcard is a separate 'any' kind
    expect(selectorMatches(exactNginx, star)).toBe(false); // a different id does not match
  });

  it("rejects an unknown selector match kind or a field foreign to the match kind", () => {
    expect(() =>
      ResourceSelectorSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        matchDescendants: false,
        segments: [{ type: "service", match: "glob", id: "n*" }],
      }),
    ).toThrow();
    expect(() =>
      ResourceSelectorSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        matchDescendants: false,
        segments: [{ type: "service", match: "any", id: "x" }],
      }),
    ).toThrow();
  });

  it("requires matchDescendants explicitly on a selector (no Zod default)", () => {
    expect(() =>
      ResourceSelectorSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        segments: [{ type: "service", match: "any" }],
      }),
    ).toThrow();
  });

  it("containment is prefix-based ancestry (host contains host/service, not vice versa)", () => {
    expect(resourceContains(host, svc)).toBe(true);
    expect(resourceContains(svc, host)).toBe(false);
    expect(resourceContains(svc, svc)).toBe(true);
  });

  it("an exact selector matches only the exact resource", () => {
    const exact = ResourceSelectorSchema.parse({
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      matchDescendants: false,
      segments: [
        { type: "host", match: "exact", id: "host-001" },
        { type: "service", match: "exact", id: "nginx" },
      ],
    });
    expect(selectorMatches(exact, svc)).toBe(true);
    expect(selectorMatches(exact, host)).toBe(false);
  });

  it("a descendant selector matches contained resources but not shallower ones", () => {
    const sel = ResourceSelectorSchema.parse({
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      segments: [{ type: "host", match: "exact", id: "host-001" }],
      matchDescendants: true,
    });
    expect(selectorMatches(sel, host)).toBe(true);
    expect(selectorMatches(sel, svc)).toBe(true);
    const otherHost = ResourceReferenceSchema.parse({
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      segments: [{ type: "host", id: "host-002" }],
    });
    expect(selectorMatches(sel, otherHost)).toBe(false);
  });

  it("a non-descendant selector requires exact depth", () => {
    const sel = ResourceSelectorSchema.parse({
      contractVersion: CHECKPOINT_CONTRACT_VERSION,
      segments: [{ type: "host", match: "any" }],
      matchDescendants: false,
    });
    expect(selectorMatches(sel, host)).toBe(true);
    expect(selectorMatches(sel, svc)).toBe(false); // deeper resource not matched without matchDescendants
  });
});

describe("NFC is a cross-language wire invariant (non-NFC is rejected, not transformed)", () => {
  // composed U+00E9 is NFC; decomposed "e" + U+0301 is NOT NFC.
  it("accepts an NFC (composed) Resource id and rejects the decomposed spelling on the wire", () => {
    expect(() =>
      ResourceReferenceSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        segments: [{ type: "service", id: "caf\u00E9" }],
      }),
    ).not.toThrow();
    expect(() =>
      ResourceReferenceSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        segments: [{ type: "service", id: "cafe\u0301" }],
      }),
    ).toThrow();
  });

  it("applies the same NFC wire invariant to an exact selector id (conformance vector)", () => {
    expect(() =>
      ResourceSelectorSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        matchDescendants: false,
        segments: [{ type: "service", match: "exact", id: "caf\u00E9" }],
      }),
    ).not.toThrow();
    expect(() =>
      ResourceSelectorSchema.parse({
        contractVersion: CHECKPOINT_CONTRACT_VERSION,
        matchDescendants: false,
        segments: [{ type: "service", match: "exact", id: "cafe\u0301" }],
      }),
    ).toThrow();
  });
});

describe("CheckpointDefinition.action — the Checkpoint↔Action edge (docs#228 D1–D5, #127)", () => {
  it("valid binding round-trips; capabilityId omitted and present are both legal (D4)", () => {
    const parsed = CheckpointDefinitionSchema.parse(statusCheckpoint);
    expect(parsed.action).toEqual({ actionId: "getServiceStatus" });
    const withCap = CheckpointDefinitionSchema.parse({
      ...statusCheckpoint,
      action: { actionId: "getServiceStatus", capabilityId: "service-operations" },
    });
    expect(withCap.action?.capabilityId).toBe("service-operations");
  });

  it("the edge is TOTAL over Service definitions and EMPTY over platform-internal ones — both directions are wire-enforced (review 2026-08-25 P1)", () => {
    // A Service-published definition WITHOUT the edge is not expressible.
    const { action: _action, ...serviceNoEdge } = statusCheckpoint;
    expect(() => CheckpointDefinitionSchema.parse(serviceNoEdge)).toThrow(/must name the one Action/);
    // A platform-internal (self) definition carries NO edge — absence parses...
    const selfStyle = {
      ...serviceNoEdge,
      id: { serviceId: "self", checkpointId: "self.whoami", checkpointVersion: "1.0.0" },
    };
    const parsed = CheckpointDefinitionSchema.parse(selfStyle);
    expect(parsed.action).toBeUndefined();
    // ...and PRESENCE on self is rejected just as hard (no half-open state).
    expect(() =>
      CheckpointDefinitionSchema.parse({ ...selfStyle, action: { actionId: "getServiceStatus" } }),
    ).toThrow(/platform-internal/);
  });

  it("missing or invalid actionId is rejected; the reference is strict/closed", () => {
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, action: {} })).toThrow();
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, action: { actionId: "" } })).toThrow();
    expect(() =>
      CheckpointDefinitionSchema.parse({ ...statusCheckpoint, action: { actionId: "getServiceStatus", extra: 1 } }),
    ).toThrow();
  });

  it("the reference carries NO serviceId of its own — the logical Service identity is id.serviceId alone (nothing to disagree)", () => {
    expect(() =>
      CheckpointDefinitionSchema.parse({
        ...statusCheckpoint,
        action: { actionId: "getServiceStatus", serviceId: "linux-ops-widget-nodejs" },
      }),
    ).toThrow();
  });

  it("actionId keeps the case-sensitive Action-name semantic (camelCase is legal; it is not a kebab logical id)", () => {
    const parsed = CheckpointDefinitionSchema.parse({ ...statusCheckpoint, action: { actionId: "manageAccounts" } });
    expect(parsed.action?.actionId).toBe("manageAccounts");
  });

  it("actionId follows the NFC wire rule (empty / non-NFC rejected)", () => {
    expect(() => CheckpointDefinitionSchema.parse({ ...statusCheckpoint, action: { actionId: "cafe\u0301" } })).toThrow();
  });
});

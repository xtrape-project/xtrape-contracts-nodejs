import { describe, expect, it } from "vitest";
import {
  EXTRACTION_OPERATIONAL_ABORT,
  ResourceReferenceSchema,
  ExtractionFailureCode,
  ResourceSegmentSchema,
  STATIC_EXTRACTOR_CONFORMANCE_VECTORS,
  STATIC_EXTRACTOR_LIMITS,
  STATIC_RESOURCE_EXTRACTOR_MEDIA_TYPE,
  StaticExecutionProfileRecordSchema,
  StaticResourceExtractorArtifactSchema,
  parseStaticExtractorPointer,
  unicodeScalarCount,
  type StaticExtractorConformanceVector,
  type StaticResourceExtractorArtifact,
} from "../src";

/*
 * Round-1 static extractor contract (docs#266 N1–N5; contracts-nodejs#130).
 *
 * Beyond schema round-trips, this suite runs a TEST-ONLY reference evaluator
 * implementing the frozen N2/N3/N4 semantics over every conformance vector,
 * so the shipped vector corpus is proven internally consistent — a wrongly
 * authored expectation fails here, not in a consumer's CI. The evaluator is
 * deliberately not exported: the normative interpreter is the platform's
 * (platform-ce#206), validated against these same vectors.
 */

const GCLEF = "\u{1D11E}";

function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

type RefOutcome = { kind: "resource"; reference: unknown } | { kind: "failure"; code: ExtractionFailureCode };

/**
 * Reference evaluation — N2/N3/N4. Takes the RAW parsed document: the first
 * act is the N3 re-validation bulwark (`artifact-invalid` for a
 * non-conforming artifact that somehow bypassed admission), then the
 * evaluation proper, and the output is the COMPLETE v1 ResourceReference,
 * strict-re-validated before being returned (docs#266 N4 output contract;
 * review 2627 High — bare segments are not a conformant output).
 */
function referenceEvaluate(artifactValue: unknown, parameters: unknown): RefOutcome {
  const parsedArtifact = StaticResourceExtractorArtifactSchema.safeParse(artifactValue);
  if (!parsedArtifact.success) return { kind: "failure", code: "artifact-invalid" };
  const artifact: StaticResourceExtractorArtifact = parsedArtifact.data;
  let steps = 0;
  const segments: { type: string; id: string }[] = [];
  for (const seg of artifact.segments) {
    let id: string;
    if (seg.id.kind === "literal") {
      id = seg.id.value;
    } else {
      const parsed = parseStaticExtractorPointer(seg.id.pointer);
      if (!parsed.ok) return { kind: "failure", code: "artifact-invalid" };
      let cursor: unknown = parameters;
      for (const token of parsed.tokens) {
        steps += 1;
        if (steps > STATIC_EXTRACTOR_LIMITS.maxEvaluationSteps) return { kind: "failure", code: "limit-exceeded" };
        if (Array.isArray(cursor)) {
          // canonical decimal only: no leading zeros ("0" itself is canonical)
          if (!/^(0|[1-9][0-9]*)$/.test(token)) return { kind: "failure", code: "pointer-unresolved" };
          const idx = Number(token);
          if (idx >= cursor.length) return { kind: "failure", code: "pointer-unresolved" };
          cursor = cursor[idx];
        } else if (cursor !== null && typeof cursor === "object") {
          if (!Object.prototype.hasOwnProperty.call(cursor, token)) return { kind: "failure", code: "pointer-unresolved" };
          cursor = (cursor as Record<string, unknown>)[token];
        } else {
          return { kind: "failure", code: "pointer-unresolved" };
        }
      }
      if (typeof cursor !== "string") return { kind: "failure", code: "type-mismatch" };
      id = cursor;
    }
    steps += 1; // segment construction
    if (steps > STATIC_EXTRACTOR_LIMITS.maxEvaluationSteps) return { kind: "failure", code: "limit-exceeded" };
    const parsedId = ResourceSegmentSchema.shape.id.safeParse(id);
    if (!parsedId.success || unicodeScalarCount(id) > STATIC_EXTRACTOR_LIMITS.maxExtractedIdScalars) {
      return { kind: "failure", code: "invalid-id" };
    }
    segments.push({ type: seg.type, id });
  }
  const reference = { contractVersion: 1, segments };
  const revalidated = ResourceReferenceSchema.safeParse(reference);
  if (!revalidated.success) return { kind: "failure", code: "invalid-id" };
  return { kind: "resource", reference: revalidated.data };
}

/** Reference admission — N1/I3 precedence: size → canonical bytes → grammar. */
function referenceAdmit(bytes: string): { ok: true; artifact: StaticResourceExtractorArtifact } | { ok: false; reason: "artifact-too-large" | "non-canonical-bytes" | "grammar" } {
  if (new TextEncoder().encode(bytes).length > STATIC_EXTRACTOR_LIMITS.maxArtifactBytes) return { ok: false, reason: "artifact-too-large" };
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    return { ok: false, reason: "non-canonical-bytes" };
  }
  if (canon(value) !== bytes) return { ok: false, reason: "non-canonical-bytes" };
  const parsed = StaticResourceExtractorArtifactSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "grammar" };
  return { ok: true, artifact: parsed.data };
}

describe("pointer parsing (N2)", () => {
  it("unescapes in RFC 6901 order: ~1 first, then ~0", () => {
    expect(parseStaticExtractorPointer("/~01")).toEqual({ ok: true, tokens: ["~1"] });
    expect(parseStaticExtractorPointer("/a~0b")).toEqual({ ok: true, tokens: ["a~b"] });
    expect(parseStaticExtractorPointer("/a~1b")).toEqual({ ok: true, tokens: ["a/b"] });
  });

  it("accepts the RFC 6901 empty pointer, rejects missing leading slash and bad escapes", () => {
    expect(parseStaticExtractorPointer("")).toEqual({ ok: true, tokens: [] });
    expect(parseStaticExtractorPointer("a/b")).toEqual({ ok: false, issue: "syntax" });
    expect(parseStaticExtractorPointer("/a~2b")).toEqual({ ok: false, issue: "escape" });
    expect(parseStaticExtractorPointer("/a~")).toEqual({ ok: false, issue: "escape" });
  });

  it("rejects a pointer that is not well-formed Unicode (lone surrogate)", () => {
    expect(parseStaticExtractorPointer("/a\ud800b")).toEqual({ ok: false, issue: "ill-formed" });
    expect(parseStaticExtractorPointer("/\udc00")).toEqual({ ok: false, issue: "ill-formed" });
    // a PAIRED surrogate is one scalar and fine
    expect(parseStaticExtractorPointer(`/${GCLEF}`).ok).toBe(true);
  });

  it("rejects the array-append token `-` (exactly, not as a substring)", () => {
    expect(parseStaticExtractorPointer("/units/-")).toEqual({ ok: false, issue: "dash-token" });
    expect(parseStaticExtractorPointer("/-x")).toEqual({ ok: true, tokens: ["-x"] });
  });

  it("bounds token count and counts token length in Unicode scalars after unescape", () => {
    expect(parseStaticExtractorPointer("/a".repeat(16)).ok).toBe(true);
    expect(parseStaticExtractorPointer("/a".repeat(17))).toEqual({ ok: false, issue: "token-count" });
    // 200 non-BMP scalars = 400 UTF-16 units: a code-unit counter wrongly rejects this
    expect(parseStaticExtractorPointer(`/${GCLEF.repeat(200)}`).ok).toBe(true);
    expect(parseStaticExtractorPointer(`/${GCLEF.repeat(201)}`)).toEqual({ ok: false, issue: "token-scalars" });
    // count is after unescape: 200 chars written as 400 escape bytes still passes
    expect(parseStaticExtractorPointer(`/${"~0".repeat(200)}`).ok).toBe(true);
    expect(parseStaticExtractorPointer(`/${"~0".repeat(201)}`)).toEqual({ ok: false, issue: "token-scalars" });
  });

  it("allows an empty reference token (RFC 6901: the empty member name)", () => {
    expect(parseStaticExtractorPointer("/")).toEqual({ ok: true, tokens: [""] });
  });
});

describe("artifact grammar (N2, strict/closed)", () => {
  const valid = {
    artifactKind: "static-resource-extractor",
    contractVersion: 1,
    segments: [
      { type: "service", id: { kind: "literal", value: "nginx" } },
      { type: "unit", id: { kind: "pointer", pointer: "/unitName" } },
    ],
  };

  it("accepts the canonical example", () => {
    expect(StaticResourceExtractorArtifactSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["unknown top-level member", { ...valid, extra: true }],
    ["unknown segment member", { ...valid, segments: [{ ...valid.segments[0], extra: 1 }] }],
    ["unknown id member", { ...valid, segments: [{ type: "unit", id: { kind: "literal", value: "x", extra: 1 } }] }],
    ["empty segments", { ...valid, segments: [] }],
    ["nine segments", { ...valid, segments: Array.from({ length: 9 }, (_, i) => ({ type: `t${i}x`, id: { kind: "literal", value: "v" } })) }],
    ["uppercase type", { ...valid, segments: [{ type: "Unit", id: { kind: "literal", value: "v" } }] }],
    ["empty literal", { ...valid, segments: [{ type: "unit", id: { kind: "literal", value: "" } }] }],
    ["non-NFC literal", { ...valid, segments: [{ type: "unit", id: { kind: "literal", value: "café" } }] }],
    ["over-long literal", { ...valid, segments: [{ type: "unit", id: { kind: "literal", value: GCLEF.repeat(513) } }] }],
    ["dash-token pointer", { ...valid, segments: [{ type: "unit", id: { kind: "pointer", pointer: "/a/-" } }] }],
    ["ill-formed pointer", { ...valid, segments: [{ type: "unit", id: { kind: "pointer", pointer: "/a\ud800b" } }] }],
    ["wrong contractVersion", { ...valid, contractVersion: 2 }],
  ])("rejects: %s", (_name, doc) => {
    expect(StaticResourceExtractorArtifactSchema.safeParse(doc).success).toBe(false);
  });

  it("accepts a literal id of exactly the scalar cap in non-BMP characters", () => {
    const doc = { ...valid, segments: [{ type: "unit", id: { kind: "literal", value: GCLEF.repeat(512) } }] };
    expect(StaticResourceExtractorArtifactSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts the empty pointer at grammar level (RFC 6901 syntax is not amended)", () => {
    const doc = { ...valid, segments: [{ type: "unit", id: { kind: "pointer", pointer: "" } }] };
    expect(StaticResourceExtractorArtifactSchema.safeParse(doc).success).toBe(true);
  });
});

describe("execution-profile record family (N4)", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const record = {
    recordKind: "execution-profile",
    contractVersion: 1,
    interpreter: "static-json-pointer",
    interpreterSemanticVersion: "1.0.0",
    grammarSchemaRecord: digest,
    outputSchemaRecord: digest,
    parameterNormalizationProfile: `sha256:${"b".repeat(64)}`,
    limits: { ...STATIC_EXTRACTOR_LIMITS },
  };

  it("accepts the frozen family shape (only parameterNormalizationProfile varies)", () => {
    expect(StaticExecutionProfileRecordSchema.safeParse(record).success).toBe(true);
    expect(StaticExecutionProfileRecordSchema.safeParse({ ...record, parameterNormalizationProfile: `sha256:${"c".repeat(64)}` }).success).toBe(true);
  });

  it.each([
    ["drifted interpreterSemanticVersion", { ...record, interpreterSemanticVersion: "1.0.1" }],
    ["drifted step budget", { ...record, limits: { ...record.limits, maxEvaluationSteps: 256 } }],
    ["symbolic grammar reference", { ...record, grammarSchemaRecord: "v1" }],
    ["extra limit", { ...record, limits: { ...record.limits, timeoutMs: 50 } }],
    ["unknown member", { ...record, extra: 1 }],
  ])("rejects: %s", (_name, doc) => {
    expect(StaticExecutionProfileRecordSchema.safeParse(doc).success).toBe(false);
  });

  it("keeps the operational abort code outside the deterministic enum", () => {
    expect(EXTRACTION_OPERATIONAL_ABORT).toBe("evaluation-aborted");
    expect(ExtractionFailureCode).not.toContain(EXTRACTION_OPERATIONAL_ABORT);
    expect(STATIC_RESOURCE_EXTRACTOR_MEDIA_TYPE).toBe("application/vnd.xtrape.static-resource-extractor.v1+json");
  });
});

describe("conformance vectors (N5) — internally consistent under the reference evaluator", () => {
  it("covers every deterministic failure code and every admission-reject reason", () => {
    const codes = new Set([
      ...STATIC_EXTRACTOR_CONFORMANCE_VECTORS.filter((v) => v.expected.kind === "failure").map((v) => (v.expected as { code: string }).code),
      ...STATIC_EXTRACTOR_CONFORMANCE_VECTORS.flatMap((v) => (v.evaluationBulwark ? [v.evaluationBulwark] : [])),
    ]);
    expect([...ExtractionFailureCode].sort()).toEqual([...codes].sort());
    const reasons = new Set(STATIC_EXTRACTOR_CONFORMANCE_VECTORS.filter((v) => v.expected.kind === "admission-reject").map((v) => (v.expected as { reason: string }).reason));
    expect([...reasons].sort()).toEqual(["artifact-too-large", "grammar", "non-canonical-bytes"]);
  });

  it.each(STATIC_EXTRACTOR_CONFORMANCE_VECTORS.map((v) => [v.name, v] as const))("%s", (_name, vector: StaticExtractorConformanceVector) => {
    const admitted = referenceAdmit(vector.artifactBytes);
    if (vector.expected.kind === "admission-reject") {
      expect(admitted).toEqual({ ok: false, reason: vector.expected.reason });
      if (vector.evaluationBulwark) {
        // explicit second phase: an implementation that reaches evaluation
        // with this artifact anyway must answer with the bulwark code
        const outcome = referenceEvaluate(JSON.parse(vector.artifactBytes), vector.parameters);
        expect(outcome).toEqual({ kind: "failure", code: vector.evaluationBulwark });
      }
      return;
    }
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const outcome = referenceEvaluate(admitted.artifact, vector.parameters);
    if (vector.expected.kind === "resource") {
      // the output must BE a strict-valid complete v1 ResourceReference
      // (docs#266 N4 output contract), byte-for-byte the vector's expectation
      expect(outcome).toEqual({ kind: "resource", reference: vector.expected.reference });
      expect(ResourceReferenceSchema.safeParse(vector.expected.reference).success).toBe(true);
      if (outcome.kind === "resource") {
        const strict = ResourceReferenceSchema.safeParse(outcome.reference);
        expect(strict.success).toBe(true);
      }
    } else {
      expect(outcome).toEqual(vector.expected);
    }
  });

  it("ships canonical bytes for every non-reject vector", () => {
    for (const v of STATIC_EXTRACTOR_CONFORMANCE_VECTORS) {
      if (v.expected.kind === "admission-reject" && v.expected.reason === "non-canonical-bytes") {
        expect(canon(JSON.parse(v.artifactBytes))).not.toBe(v.artifactBytes);
      } else {
        expect(canon(JSON.parse(v.artifactBytes))).toBe(v.artifactBytes);
      }
    }
  });

  it("pins the step arithmetic of the budget-boundary fixtures", () => {
    const tokenSum = (bytes: string): { tokens: number; segments: number } => {
      const artifact = JSON.parse(bytes) as StaticResourceExtractorArtifact;
      let tokens = 0;
      for (const seg of artifact.segments) {
        if (seg.id.kind === "pointer") {
          const parsed = parseStaticExtractorPointer(seg.id.pointer);
          if (parsed.ok) tokens += parsed.tokens.length;
        }
      }
      return { tokens, segments: artifact.segments.length };
    };
    const byName = new Map(STATIC_EXTRACTOR_CONFORMANCE_VECTORS.map((v) => [v.name, v]));
    const at = tokenSum(byName.get("steps-at-budget")!.artifactBytes);
    expect(at.tokens + at.segments).toBe(STATIC_EXTRACTOR_LIMITS.maxEvaluationSteps);
    const one = tokenSum(byName.get("steps-one-left")!.artifactBytes);
    expect(one.tokens + one.segments).toBe(STATIC_EXTRACTOR_LIMITS.maxEvaluationSteps - 1);
    const over = tokenSum(byName.get("steps-over-budget")!.artifactBytes);
    expect(over.tokens + over.segments).toBe(136);
    // the grammar-maximal cost: budget must sit strictly below it or
    // limit-exceeded is unreachable (the docs#266 amendment's rationale)
    expect(STATIC_EXTRACTOR_LIMITS.maxEvaluationSteps).toBeLessThan(8 * 16 + 8 + 1);
  });
});

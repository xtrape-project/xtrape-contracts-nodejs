import type { ResourceReference } from "./checkpoint";
import type { ExtractionFailureCode } from "./extraction";

/**
 * Shared conformance vectors for the round-1 static Resource extractor
 * (docs#266 N5; contracts-nodejs#130).
 *
 * BOTH consumers run this ONE suite: the platform interpreter (platform-ce#206)
 * asserts its evaluation, and the Connector-SDK/widget authoring side asserts
 * its pre-upload validation, against the same expectations in CI. A vector's
 * input is the artifact's EXACT bytes plus the ALREADY stage-1-normalized
 * parameters value; its expectation is a Resource, one of the five
 * deterministic failure codes, or an admission rejection. The operational
 * `evaluation-aborted` backstop is deliberately absent — it is not
 * deterministic and never appears here (docs#266 N4).
 *
 * Admission-check precedence encoded by these vectors (mechanical ordering so
 * every implementation reports the same rejection for the same upload):
 * size guard (`artifact-too-large`) → canonical-bytes check
 * (`non-canonical-bytes`) → strict grammar validation (`grammar`).
 */

export type StaticExtractorExpectation =
  /** The COMPLETE strict-valid v1 ResourceReference the extraction must yield (docs#266 N4: the output re-validates against `outputSchemaRecord` — asserting bare segments would let an implementation pass without ever constructing a conformant reference; review 2627 High). */
  | { kind: "resource"; reference: ResourceReference }
  | { kind: "failure"; code: ExtractionFailureCode }
  | { kind: "admission-reject"; reason: "artifact-too-large" | "non-canonical-bytes" | "grammar" };

export type StaticExtractorConformanceVector = {
  name: string;
  /**
   * The artifact's exact UTF-8 bytes as a JS string — canonical (JCS) except
   * where the vector deliberately probes the non-canonical REJECT rule. The
   * digest preimage for a canonical vector is exactly these bytes.
   */
  artifactBytes: string;
  /** The stage-1-normalized parameters value evaluation reads (docs#266 N2). */
  parameters: unknown;
  expected: StaticExtractorExpectation;
  /**
   * Only on `admission-reject`/`grammar` vectors: the deterministic failure
   * code the EVALUATION bulwark must produce for an implementation that
   * reaches evaluation with this artifact anyway (docs#266 N3
   * `artifact-invalid`). Explicit two-phase modeling — a conformant admission
   * rejects with `expected.reason`, a conformant evaluator answers with this
   * code (review 2627 Medium 4).
   */
  evaluationBulwark?: ExtractionFailureCode;
  notes?: string;
};

/*
 * Construction-only canonical serializer for THIS corpus: recursive key sort
 * (UTF-16 code-unit order) + JSON.stringify. For the vectors' content — ASCII
 * object keys, small integers, string values (including non-BMP, which both
 * JCS and JSON.stringify emit literally) — this equals RFC 8785 byte-for-byte;
 * it is NOT a general JCS implementation and is not exported.
 */
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

function artifact(segments: { type: string; id: { kind: "literal"; value: string } | { kind: "pointer"; pointer: string } }[]): string {
  return canon({ artifactKind: "static-resource-extractor", contractVersion: 1, segments });
}

/** `{ s<i>: { a: { a: ... value } } }` — `depth` object levels then the leaf. */
function nest(leaf: unknown, depth: number): unknown {
  let v: unknown = leaf;
  for (let i = 0; i < depth; i += 1) v = { a: v };
  return v;
}

/** `/s<i>/a/a/...` with `tokens` reference tokens total. */
function deepPointer(root: string, tokens: number): string {
  return `/${root}${"/a".repeat(tokens - 1)}`;
}

const GCLEF = "\u{1D11E}"; // one Unicode scalar, two UTF-16 units, four UTF-8 bytes

/**
 * Step-budget fixtures (docs#266 N4: +1 per token resolution, +1 per segment
 * construction; budget 128 per the amendment on docs#266):
 * - 8 segments with token counts summing 120 → exactly 128 steps (at budget);
 * - sum 119 → 127 steps (one left);
 * - 8 × 16 tokens → 136 steps (exceeds at step 129, deterministically inside
 *   segment 8, before any resolution can fail — all pointers resolve).
 */
function stepFixture(tokenCounts: number[]): { artifactBytes: string; parameters: Record<string, unknown> } {
  const segments = tokenCounts.map((tokens, i) => ({
    type: `t${i + 1}`,
    id: { kind: "pointer" as const, pointer: deepPointer(`s${i + 1}`, tokens) },
  }));
  const parameters: Record<string, unknown> = {};
  tokenCounts.forEach((tokens, i) => {
    parameters[`s${i + 1}`] = nest(`u${i + 1}`, tokens - 1);
  });
  return { artifactBytes: artifact(segments), parameters };
}

const atBudget = stepFixture([16, 16, 16, 16, 16, 16, 16, 8]); // 120 + 8 = 128
const oneLeft = stepFixture([16, 16, 16, 16, 16, 16, 16, 7]); // 119 + 8 = 127
const overBudget = stepFixture([16, 16, 16, 16, 16, 16, 16, 16]); // 128 + 8 = 136

const stepResource = (n: number) => Array.from({ length: n }, (_, i) => ({ type: `t${i + 1}`, id: `u${i + 1}` }));
const CONTRACT_VERSION = 1 as const;

export const STATIC_EXTRACTOR_CONFORMANCE_VECTORS: readonly StaticExtractorConformanceVector[] = [
  {
    name: "literal-and-pointer",
    artifactBytes: artifact([
      { type: "service", id: { kind: "literal", value: "nginx" } },
      { type: "unit", id: { kind: "pointer", pointer: "/unitName" } },
    ]),
    parameters: { unitName: "nginx.service" },
    expected: {
      kind: "resource",
      reference: {
        contractVersion: 1,
        segments: [
          { type: "service", id: "nginx" },
          { type: "unit", id: "nginx.service" },
        ],
      },
    },
  },
  {
    name: "escape-tilde",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/a~0b" } }]),
    parameters: { "a~b": "x" },
    expected: { kind: "resource", reference: { contractVersion: CONTRACT_VERSION, segments: [{ type: "unit", id: "x" }] } },
  },
  {
    name: "escape-slash",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/a~1b" } }]),
    parameters: { "a/b": "x" },
    expected: { kind: "resource", reference: { contractVersion: CONTRACT_VERSION, segments: [{ type: "unit", id: "x" }] } },
  },
  {
    name: "escape-order",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/~01" } }]),
    parameters: { "~1": "x", "/": "WRONG" },
    expected: { kind: "resource", reference: { contractVersion: CONTRACT_VERSION, segments: [{ type: "unit", id: "x" }] } },
    notes: "RFC 6901 §4 order: ~1→/ first, then ~0→~, so `~01` names the member `~1`, never `/`.",
  },
  {
    name: "array-index",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/units/0" } }]),
    parameters: { units: ["u1"] },
    expected: { kind: "resource", reference: { contractVersion: CONTRACT_VERSION, segments: [{ type: "unit", id: "u1" }] } },
  },
  {
    name: "array-leading-zero",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/units/01" } }]),
    parameters: { units: ["u1", "u2"] },
    expected: { kind: "failure", code: "pointer-unresolved" },
    notes: "Against an ARRAY a token must be a canonical decimal (no leading zero); `01` resolves to nothing. Against an object, `01` would be an ordinary member name — the rule is evaluation semantics, not grammar.",
  },
  {
    name: "object-member-leading-zero",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/units/01" } }]),
    parameters: { units: { "01": "x" } },
    expected: { kind: "resource", reference: { contractVersion: CONTRACT_VERSION, segments: [{ type: "unit", id: "x" }] } },
  },
  {
    name: "dash-token",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/units/-" } }]),
    parameters: { units: ["u1"] },
    expected: { kind: "admission-reject", reason: "grammar" },
    notes: "`-` (array-append position) is statically meaningless in read-only evaluation — grammar REJECT (docs#266 N2).",
  },
  {
    name: "empty-pointer",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "" } }]),
    parameters: { unitName: "x" },
    expected: { kind: "failure", code: "type-mismatch" },
    notes: "RFC 6901: the empty pointer (zero tokens) is VALID and addresses the whole document — docs#266 bounds RFC 6901 without amending its syntax. Against the parameters OBJECT the string-only rule then yields a deterministic type-mismatch at evaluation (review 2627 Medium 1).",
  },
  {
    name: "non-canonical-bytes",
    artifactBytes: '{"contractVersion":1,"artifactKind":"static-resource-extractor","segments":[{"type":"unit","id":{"kind":"pointer","pointer":"/unitName"}}]}',
    parameters: { unitName: "x" },
    expected: { kind: "admission-reject", reason: "non-canonical-bytes" },
    notes: "Same JSON value as a valid artifact, but the bytes are not the JCS bytes (keys out of order) — REJECT, never re-canonicalize (docs#266 N1).",
  },
  {
    name: "pointer-unresolved-missing-member",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/missing" } }]),
    parameters: { unitName: "x" },
    expected: { kind: "failure", code: "pointer-unresolved" },
  },
  {
    name: "type-mismatch-number",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/count" } }]),
    parameters: { count: 42 },
    expected: { kind: "failure", code: "type-mismatch" },
    notes: "string-only, zero coercion (docs#266 N2) — 42 never becomes \"42\".",
  },
  {
    name: "invalid-id-empty",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/unitName" } }]),
    parameters: { unitName: "" },
    expected: { kind: "failure", code: "invalid-id" },
  },
  {
    name: "invalid-id-non-nfc",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/unitName" } }]),
    parameters: { unitName: "café" },
    expected: { kind: "failure", code: "invalid-id" },
    notes: "Stage-1 normalization already guarantees NFC; this probes the re-validation bulwark against a broken upstream.",
  },
  {
    name: "nonbmp-id-at-limit",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/unitName" } }]),
    parameters: { unitName: GCLEF.repeat(512) },
    expected: { kind: "resource", reference: { contractVersion: CONTRACT_VERSION, segments: [{ type: "unit", id: GCLEF.repeat(512) }] } },
    notes: "512 Unicode scalar values = 1024 UTF-16 units = 2048 UTF-8 bytes: an implementation counting either of those units wrongly rejects this (docs#266 3rd-review Medium).",
  },
  {
    name: "nonbmp-id-over-limit",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: "/unitName" } }]),
    parameters: { unitName: GCLEF.repeat(513) },
    expected: { kind: "failure", code: "invalid-id" },
  },
  {
    name: "pointer-token-scalars-at-limit",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: `/${GCLEF.repeat(200)}` } }]),
    parameters: { [GCLEF.repeat(200)]: "x" },
    expected: { kind: "resource", reference: { contractVersion: CONTRACT_VERSION, segments: [{ type: "unit", id: "x" }] } },
    notes: "The token is 200 scalars (400 UTF-16 units) AFTER unescaping — probes both the counting unit and the count-after-unescape rule.",
  },
  {
    name: "pointer-token-scalars-over-limit",
    artifactBytes: artifact([{ type: "unit", id: { kind: "pointer", pointer: `/${GCLEF.repeat(201)}` } }]),
    parameters: {},
    expected: { kind: "admission-reject", reason: "grammar" },
  },
  {
    name: "grammar-unknown-member",
    artifactBytes: canon({ artifactKind: "static-resource-extractor", contractVersion: 1, extra: true, segments: [{ type: "unit", id: { kind: "literal", value: "x" } }] }),
    parameters: {},
    expected: { kind: "admission-reject", reason: "grammar" },
    evaluationBulwark: "artifact-invalid",
    notes: "Canonical bytes but strict-grammar-invalid (unknown member). Two explicit phases: a conformant admission rejects it (`grammar`); a conformant evaluator that is handed it anyway answers `artifact-invalid` (the N3 bulwark).",
  },
  {
    name: "artifact-too-large",
    artifactBytes: canon({ artifactKind: "static-resource-extractor", contractVersion: 1, pad: "x".repeat(33000), segments: [{ type: "unit", id: { kind: "literal", value: "x" } }] }),
    parameters: {},
    expected: { kind: "admission-reject", reason: "artifact-too-large" },
    notes: "A grammar-valid artifact cannot exceed maxArtifactBytes (the legal maximum is ~16KiB), so the oversized document is necessarily also grammar-invalid — the size guard runs FIRST (see the precedence note above), making the rejection reason deterministic.",
  },
  {
    name: "steps-at-budget",
    artifactBytes: atBudget.artifactBytes,
    parameters: atBudget.parameters,
    expected: { kind: "resource", reference: { contractVersion: CONTRACT_VERSION, segments: stepResource(8) } },
    notes: "8 segments, 120 tokens: exactly 128 steps — succeeds AT the budget.",
  },
  {
    name: "steps-one-left",
    artifactBytes: oneLeft.artifactBytes,
    parameters: oneLeft.parameters,
    expected: { kind: "resource", reference: { contractVersion: CONTRACT_VERSION, segments: stepResource(8) } },
    notes: "127 steps — one under the budget.",
  },
  {
    name: "steps-over-budget",
    artifactBytes: overBudget.artifactBytes,
    parameters: overBudget.parameters,
    expected: { kind: "failure", code: "limit-exceeded" },
    notes: "The grammar-maximal artifact: 8×16 tokens + 8 constructions = 136 steps; every pointer resolves, so the ONLY failure is the deterministic budget, exceeded at step 129.",
  },
];

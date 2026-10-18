import { z } from "zod";
import { ResourceSegmentSchema } from "./checkpoint";

/**
 * Round-1 static Resource-extractor contract (contracts-nodejs#130).
 *
 * MECHANICAL ENCODING of xtrape-docs#266 (N1–N5, APPROVED after four review
 * rounds). Every semantic decision here — canonical bytes, grammar bounds,
 * failure codes, the execution-profile record family, the limits and their
 * units — is frozen THERE; this module only transcribes it so both consumers
 * (the platform interpreter and Connector-SDK/widget authors) validate against
 * one artifact grammar and run one shared conformance-vector suite. A found
 * ambiguity goes back to docs#266 as an amendment, never gets settled here.
 *
 * The artifact rides the existing `ResourceExtractionSpec` `extractor-artifact`
 * branch unchanged: `artifactDigest` stays the sole content authority and
 * `executionProfileRecord` names the admitted execution profile — this module
 * defines what those bytes and that record ARE for the round-1 static
 * interpreter; it adds no new `kind` (docs#266 I2).
 */

/* ------------------------------------------------------------------------- *
 * N1 — identity and bytes
 * ------------------------------------------------------------------------- */

/**
 * Media type of a round-1 static extractor artifact (docs#266 N1). The stored
 * bytes MUST be exactly the RFC 8785 (JCS) canonicalization of the document —
 * an upload whose bytes are not already canonical is REJECTED, never
 * re-canonicalized on the caller's behalf: the digest authority may not rest
 * on "the platform fixed your bytes". The digest preimage is the stored
 * canonical UTF-8 bytes themselves — no prefix, no length framing, no
 * re-wrapping.
 */
export const STATIC_RESOURCE_EXTRACTOR_MEDIA_TYPE = "application/vnd.xtrape.static-resource-extractor.v1+json" as const;

const Sha256Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/, "digest must be sha256:<hex>");

/* ------------------------------------------------------------------------- *
 * Shared limits (docs#266 N4, frozen values)
 * ------------------------------------------------------------------------- */

/**
 * The frozen round-1 limits (docs#266 N4, `maxEvaluationSteps` per the
 * encoding-time amendment recorded on docs#266: 128, not 256, so that
 * `limit-exceeded` and the budget-boundary vectors are reachable under the
 * grammar bounds — the grammar-maximal artifact costs 8×16+8 = 136 steps).
 *
 * UNITS (docs#266 3rd-review Medium): `maxArtifactBytes` counts canonical
 * UTF-8 bytes; `maxPointerTokenScalars` counts Unicode scalar values of a
 * reference token AFTER RFC 6901 unescaping; `maxExtractedIdScalars` counts
 * Unicode scalar values of the extracted string. Explicitly NOT UTF-16 code
 * units and NOT UTF-8 bytes — a non-BMP character counts as ONE in every
 * conformant implementation. `maxEvaluationSteps` is the deterministic
 * execution budget: +1 per reference-token resolution against a container,
 * +1 per segment construction; the same input always costs the same steps.
 * A wall-clock timeout is NOT part of this record or of the deterministic
 * semantics — it is a platform-operational fail-closed backstop reported as
 * {@link EXTRACTION_OPERATIONAL_ABORT}.
 */
export const STATIC_EXTRACTOR_LIMITS = {
  maxArtifactBytes: 32768,
  maxSegments: 8,
  maxPointerTokens: 16,
  maxPointerTokenScalars: 200,
  maxExtractedIdScalars: 512,
  maxEvaluationSteps: 128,
} as const;

/**
 * Unicode scalar values (code points) in `value`. This is the ONLY length
 * unit the round-1 limits use for strings (docs#266 N4): `[...s]` iterates
 * by code point, so a non-BMP character counts once where a UTF-16 unit
 * count would say two and a UTF-8 byte count would say four. COUNTING ONLY:
 * this function does not validate well-formedness (a lone surrogate is not a
 * Unicode scalar value at all) — every round-1 site that applies a limit
 * rejects ill-formed strings first ({@link parseStaticExtractorPointer}
 * issue `ill-formed`; the NfcString wire invariant on literal and extracted
 * ids), so the count is only ever taken over scalar sequences.
 */
export function unicodeScalarCount(value: string): number {
  let n = 0;
  for (const _ of value) n += 1;
  return n;
}

function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code >= 0xdc00) return false; // low surrogate with no preceding high
    const next = i + 1 < value.length ? value.charCodeAt(i + 1) : Number.NaN;
    if (!(next >= 0xdc00 && next <= 0xdfff)) return false; // high surrogate with no partner
    i += 1;
  }
  return true;
}

/* ------------------------------------------------------------------------- *
 * N2 — bounded RFC 6901 pointer
 * ------------------------------------------------------------------------- */

/** Why a pointer failed static validation (grammar-level; docs#266 N2). */
export type StaticExtractorPointerIssue =
  /** Neither `""` nor `(/token)+` (RFC 6901 syntax). */
  | "syntax"
  /** The pointer is not a well-formed Unicode string (contains a lone surrogate) — such a token has no scalar count and no canonical bytes. */
  | "ill-formed"
  /** `~` not followed by `0` or `1` (RFC 6901: no other escapes exist). */
  | "escape"
  /** A token is exactly `-` (array-append position): meaningless in read-only evaluation, REJECT. */
  | "dash-token"
  /** More than `maxPointerTokens` reference tokens. */
  | "token-count"
  /** An unescaped token exceeds `maxPointerTokenScalars` Unicode scalar values. */
  | "token-scalars";

export type StaticExtractorPointerParse =
  | { ok: true; /** unescaped reference tokens, in order */ tokens: string[] }
  | { ok: false; issue: StaticExtractorPointerIssue };

/**
 * Validate and tokenize a bounded RFC 6901 pointer (docs#266 N2). Both
 * consumers use this one function: the authoring side to validate before
 * upload, the platform interpreter to tokenize what admission accepted.
 *
 * - Escapes are RFC 6901 §4 verbatim, INCLUDING the order: `~1` → `/` first,
 *   then `~0` → `~` (so `~01` unescapes to `~1`, not `/`).
 * - The empty pointer (zero tokens, addressing the whole document) is VALID,
 *   exactly as in RFC 6901 — docs#266 bounds RFC 6901, it does not amend its
 *   syntax. Against the parameters object it deterministically yields
 *   `type-mismatch` at evaluation (string-only rule); no grammar-level
 *   liveness judgement is made here (review 2627 Medium 1).
 * - A pointer that is not a well-formed Unicode string is rejected
 *   (`ill-formed`): a lone surrogate is not a Unicode scalar value, so such a
 *   token has no scalar count — and no canonical (JCS) bytes, so exact-bytes
 *   admission could never have accepted the artifact anyway; the parser's
 *   accepted-set matches that boundary (review 2627 Medium 2).
 * - Whether a token addresses an array is a runtime property of the data; the
 *   canonical-decimal (no leading zero) array-index rule is therefore
 *   EVALUATION semantics — a non-canonical index against an array resolves to
 *   nothing (`pointer-unresolved`) — except `-`, which is statically
 *   meaningless and rejected here.
 */
export function parseStaticExtractorPointer(pointer: string): StaticExtractorPointerParse {
  if (!isWellFormedUnicode(pointer)) return { ok: false, issue: "ill-formed" };
  if (pointer === "") return { ok: true, tokens: [] };
  if (!pointer.startsWith("/")) return { ok: false, issue: "syntax" };
  const rawTokens = pointer.slice(1).split("/");
  if (rawTokens.length > STATIC_EXTRACTOR_LIMITS.maxPointerTokens) return { ok: false, issue: "token-count" };
  const tokens: string[] = [];
  for (const raw of rawTokens) {
    if (!/^(?:[^~]|~[01])*$/.test(raw)) return { ok: false, issue: "escape" };
    const unescaped = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (unescaped === "-") return { ok: false, issue: "dash-token" };
    if (unicodeScalarCount(unescaped) > STATIC_EXTRACTOR_LIMITS.maxPointerTokenScalars) return { ok: false, issue: "token-scalars" };
    tokens.push(unescaped);
  }
  return { ok: true, tokens };
}

/* ------------------------------------------------------------------------- *
 * N2 — artifact grammar v1 (strict/closed)
 * ------------------------------------------------------------------------- */

// The grammar's id/type field schemas ARE the output contract's field schemas
// (ResourceSegment.id NfcString wire invariant, ResourceSegment.type kebab
// rule) — reused by reference so the two can never drift apart.
const SegmentIdString = ResourceSegmentSchema.shape.id;
const SegmentTypeString = ResourceSegmentSchema.shape.type;

/**
 * How one Resource-segment id is produced (docs#266 N2): a literal NfcString,
 * or a WHOLE-VALUE substitution from one bounded RFC 6901 pointer into the
 * stage-1-normalized parameters. Round 1 has NO string
 * interpolation/concatenation templates — a template language is semantics,
 * reserved for a future grammar version — and NO declarable normalizers: the
 * only normalization anywhere is the platform-admitted stage-1 parameter
 * normalization that the parameter digest already binds, so extraction sees
 * exactly the bytes the digest was computed over.
 */
export const StaticExtractorSegmentIdSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("literal"),
      /** Validated at admission: NfcString wire invariant + the same scalar cap as an extracted id. */
      value: SegmentIdString.refine((v) => unicodeScalarCount(v) <= STATIC_EXTRACTOR_LIMITS.maxExtractedIdScalars, {
        message: `literal id must be <= ${STATIC_EXTRACTOR_LIMITS.maxExtractedIdScalars} Unicode scalar values`,
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pointer"),
      pointer: z.string().superRefine((v, ctx) => {
        const parsed = parseStaticExtractorPointer(v);
        if (!parsed.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid static-extractor pointer (${parsed.issue})` });
      }),
    })
    .strict(),
]);
export type StaticExtractorSegmentId = z.infer<typeof StaticExtractorSegmentIdSchema>;

/**
 * One declared output segment. `type` is ALWAYS a literal (docs#266 N2 — no
 * pointers into the type position), constrained by the ResourceSegment kebab
 * rule it will be emitted under.
 */
export const StaticExtractorSegmentSchema = z
  .object({
    type: SegmentTypeString,
    id: StaticExtractorSegmentIdSchema,
  })
  .strict();
export type StaticExtractorSegment = z.infer<typeof StaticExtractorSegmentSchema>;

/**
 * The round-1 static extractor artifact document (docs#266 N2, strict/closed:
 * an unknown member is a grammar violation). `segments` is root → leaf and
 * constructs the output `ResourceReference.segments` directly. The document's
 * canonical (JCS) bytes are the `artifactDigest` preimage.
 */
export const StaticResourceExtractorArtifactSchema = z
  .object({
    artifactKind: z.literal("static-resource-extractor"),
    contractVersion: z.literal(1),
    segments: z.array(StaticExtractorSegmentSchema).min(1).max(STATIC_EXTRACTOR_LIMITS.maxSegments),
  })
  .strict();
export type StaticResourceExtractorArtifact = z.infer<typeof StaticResourceExtractorArtifactSchema>;

/* ------------------------------------------------------------------------- *
 * N3 — deterministic failure semantics
 * ------------------------------------------------------------------------- */

/**
 * The five deterministic extraction failure codes (docs#266 N3). The same
 * input always produces the same code; no failure ever yields a partial or
 * fabricated Resource — every one is "no Resource ⇒ recorded DENY", and the
 * code is recorded on the decision.
 *
 * - `pointer-unresolved` — a member is missing, an array index is out of
 *   range, or an array is addressed with a non-canonical index (leading
 *   zeros / non-decimal).
 * - `type-mismatch`     — the pointer resolved to a non-string (number,
 *   boolean, null, object, array). There is NO coercion of any kind.
 * - `invalid-id`        — the extracted string violates the NfcString wire
 *   invariant (empty / not well-formed / not NFC) or exceeds
 *   `maxExtractedIdScalars` Unicode scalar values.
 * - `limit-exceeded`    — the deterministic step budget
 *   (`maxEvaluationSteps`) is exhausted.
 * - `artifact-invalid`  — the runtime re-validation bulwark caught a
 *   non-conforming artifact; a correct admission (docs#266 I3) rejects such
 *   an artifact before it can ever be evaluated.
 */
export const ExtractionFailureCode = ["pointer-unresolved", "type-mismatch", "invalid-id", "limit-exceeded", "artifact-invalid"] as const;
export const ExtractionFailureCodeSchema = z.enum(ExtractionFailureCode);
export type ExtractionFailureCode = (typeof ExtractionFailureCode)[number];

/**
 * The OPERATIONAL abort code (docs#266 N4): the platform's wall-clock backstop
 * fired. This is deliberately NOT in {@link ExtractionFailureCode} — it is not
 * deterministic (machine load decides it), it never appears in the shared
 * conformance vectors, and it is configured on the deployment, not in the
 * execution-profile record. Its outcome is still fail-closed: no Resource ⇒
 * recorded DENY.
 */
export const EXTRACTION_OPERATIONAL_ABORT = "evaluation-aborted" as const;

/* ------------------------------------------------------------------------- *
 * N4 — the ExecutionProfileRecord v1 family
 * ------------------------------------------------------------------------- */

/**
 * The round-1 static execution-profile record (docs#266 N4). This is a
 * RECORD FAMILY, not a single global record: the platform's normalization
 * authority is the per-Checkpoint exact-version → registered
 * normalization-profile-digest mapping, so round 1 admits exactly one record
 * PER admitted normalization digest — `parameterNormalizationProfile` is the
 * ONLY field that varies across the family, which is why every other field
 * (including every limit) is a literal here. Checkpoint admission enforces
 * consistency: the Checkpoint version's admitted normalization digest MUST
 * equal this field, or admission fails closed.
 *
 * Semantic closure (docs#266 3rd-review High 2): `grammarSchemaRecord` and
 * `outputSchemaRecord` are content-addressed digests of the byte-frozen
 * schema records for the N2 grammar and the v1 ResourceReference — never
 * symbolic "v1" names that pre-freeze in-place evolution could re-interpret.
 * A historical `interpreterSemanticVersion` executes the validation semantics
 * frozen at docs#266 ruling time FOREVER; any byte change in a referenced
 * schema is a new schema digest ⇒ a new profile record ⇒ a new Checkpoint
 * version. The record's digest preimage is its own JCS canonical bytes
 * (insert-only, content-addressed), same rule as the artifact.
 *
 * SCOPE OF THIS SCHEMA (review 2627 Medium 3): it validates the record's
 * STRUCTURE — parse success is NOT membership in the admitted round-1
 * family. The three digest fields accept any well-formed `sha256:<hex>`
 * here, because their true values are platform admission data this package
 * cannot know: family membership additionally requires, checked by the
 * Platform at admission, that `grammarSchemaRecord` and `outputSchemaRecord`
 * equal the platform's admitted digests for the N2 grammar and the v1
 * ResourceReference schema (one value each, family-invariant), and that
 * `parameterNormalizationProfile` equals a REGISTERED normalization-profile
 * digest — the one the target Checkpoint version's admission mapping names.
 */
export const StaticExecutionProfileRecordSchema = z
  .object({
    recordKind: z.literal("execution-profile"),
    contractVersion: z.literal(1),
    interpreter: z.literal("static-json-pointer"),
    interpreterSemanticVersion: z.literal("1.0.0"),
    grammarSchemaRecord: Sha256Digest,
    outputSchemaRecord: Sha256Digest,
    parameterNormalizationProfile: Sha256Digest,
    limits: z
      .object({
        maxArtifactBytes: z.literal(STATIC_EXTRACTOR_LIMITS.maxArtifactBytes),
        maxSegments: z.literal(STATIC_EXTRACTOR_LIMITS.maxSegments),
        maxPointerTokens: z.literal(STATIC_EXTRACTOR_LIMITS.maxPointerTokens),
        maxPointerTokenScalars: z.literal(STATIC_EXTRACTOR_LIMITS.maxPointerTokenScalars),
        maxExtractedIdScalars: z.literal(STATIC_EXTRACTOR_LIMITS.maxExtractedIdScalars),
        maxEvaluationSteps: z.literal(STATIC_EXTRACTOR_LIMITS.maxEvaluationSteps),
      })
      .strict(),
  })
  .strict();
export type StaticExecutionProfileRecord = z.infer<typeof StaticExecutionProfileRecordSchema>;

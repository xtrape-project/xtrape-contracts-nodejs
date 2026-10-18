/**
 * The review face of a two-phase Checkpoint and the REVIEW result envelope
 * (xtrape-docs#288, runtime-platform/13 v0.4; contracts-nodejs#141).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CHECKPOINT_CONTRACT_VERSION,
  CE_CONTRACT_VERSION,
  CandidateResourceFilterRequestSchema,
  CandidateResourceFilterResponseSchema,
  CandidateResourceFilterExchangeSchema,
  DeliveredCommandOperation,
  CheckpointDefinitionSchema,
  CheckpointReviewAffinity,
  CheckpointReviewFaceSchema,
  DeliveredCommandSchema,
  ReviewCommandResultSchema,
  ReviewNextSchema,
  type DeliveredReviewCommand,
} from "../src/index";

const DIGEST = "sha256:" + "b".repeat(64);
const REF = { schemaRecord: DIGEST };
const EXTRACTION = { kind: "extractor-artifact" as const, artifactDigest: DIGEST, executionProfileRecord: DIGEST, artifactId: "linux-ops-widget-nodejs-resource-extractor" };
const face = { inputSchema: REF, resource: EXTRACTION, outputSchema: REF, risk: "LOW" as const, affinity: "INCARNATION" as const };
const twoPhase = {
  contractVersion: CHECKPOINT_CONTRACT_VERSION,
  id: { serviceId: "linux-ops-widget-nodejs", checkpointId: "task.system.uptime", checkpointVersion: "1.1.0" },
  inputSchema: REF,
  outputSchema: REF,
  resourceExtraction: EXTRACTION,
  sideEffect: "READ_ONLY" as const,
  risk: "LOW" as const,
  sensitivity: { inputUpperBound: "INTERNAL" as const, outputUpperBound: "INTERNAL" as const },
  idempotency: "IDEMPOTENT" as const,
  delivery: "AT_LEAST_ONCE" as const,
  retry: "IDEMPOTENT_REPLAY" as const,
  execution: "SYNC" as const,
  action: { actionId: "system.uptime" },
  localPreconditions: [],
  review: face,
};

describe("review face (runtime-platform/13 §4.2, arch/16 §4)", () => {
  it("candidateParameter (13 §4.3, #144) names an execution-schema property: optional, absent = no exchange; any property NAME is representable (the Platform checks it exists at admission), only emptiness is refused", () => {
    expect(CheckpointDefinitionSchema.parse({ ...twoPhase, review: { ...face, candidateParameter: "serverId" } }).review?.candidateParameter).toBe("serverId");
    expect(CheckpointDefinitionSchema.parse(twoPhase).review?.candidateParameter).toBeUndefined();
    // JSON Schema property names are ordinary JSON strings (review 3198): the contracts domain is the canonical one, not an identifier grammar.
    for (const name of ["server-id", "server.id", "1st", "a b"]) {
      expect(CheckpointDefinitionSchema.parse({ ...twoPhase, review: { ...face, candidateParameter: name } }).review?.candidateParameter).toBe(name);
    }
    expect(CheckpointDefinitionSchema.safeParse({ ...twoPhase, review: { ...face, candidateParameter: "" } }).success).toBe(false);
    // Strict face: an OLD reader (0.8.16) rejects the field — the change is BREAKING within the pre-freeze v1 train, not additive.
    expect(CheckpointDefinitionSchema.safeParse({ ...twoPhase, review: { ...face, candidateParameterTypo: "serverId" } }).success).toBe(false);
  });

  it("a two-phase definition round-trips with its review face; a single-phase one has none (absence = single-phase)", () => {
    expect(CheckpointDefinitionSchema.parse(twoPhase).review).toEqual(face);
    const { review: _r, ...single } = twoPhase;
    expect(CheckpointDefinitionSchema.parse(single).review).toBeUndefined();
  });

  it("the face is strict: no side effect field (READ_ONLY by construction), no unknown keys, every member required", () => {
    expect(() => CheckpointReviewFaceSchema.parse({ ...face, sideEffect: "READ_ONLY" })).toThrow();
    expect(() => CheckpointReviewFaceSchema.parse({ ...face, extra: 1 })).toThrow();
    for (const k of Object.keys(face)) {
      const { [k as keyof typeof face]: _drop, ...rest } = face;
      expect(() => CheckpointReviewFaceSchema.parse(rest), `${k} is required`).toThrow();
    }
  });

  it("affinity is one of the two declared modes, never free text", () => {
    expect(CheckpointReviewAffinity).toEqual(["INCARNATION", "NONE"]);
    expect(CheckpointReviewFaceSchema.parse({ ...face, affinity: "NONE" }).affinity).toBe("NONE");
    expect(() => CheckpointReviewFaceSchema.parse({ ...face, affinity: "STICKY" })).toThrow();
  });

  it("schema refs and extraction follow the same rules as the execution face", () => {
    expect(() => CheckpointReviewFaceSchema.parse({ ...face, outputSchema: { schemaRecord: "deadbeef" } })).toThrow();
    expect(() => CheckpointReviewFaceSchema.parse({ ...face, resource: { kind: "guess" } })).toThrow();
  });
});

describe("REVIEW result envelope and delivery (runtime-platform/13 §5.1, §3)", () => {
  const next = { inputSchema: { type: "object", properties: { serverId: { type: "string", enum: ["web-01"] } }, required: ["serverId"], additionalProperties: false }, initialPayload: { serverId: "web-01", reviewBinding: "v1.opaque" }, currentState: { detail: { title: "system.uptime — what this will run" } } };

  it("next carries exactly inputSchema / initialPayload / currentState; a review result is { next } and nothing else", () => {
    expect(ReviewNextSchema.parse(next)).toEqual(next);
    expect(() => ReviewNextSchema.parse({ ...next, result: {} })).toThrow();
    expect(() => ReviewNextSchema.parse({ inputSchema: next.inputSchema, initialPayload: {} })).toThrow();
    expect(ReviewCommandResultSchema.parse({ next }).next).toEqual(next);
    expect(() => ReviewCommandResultSchema.parse({ next, data: { list: [] } })).toThrow();
  });

  it("REVIEW is its own delivery arm, replacing PREPARE — an old union (EXECUTE | PREPARE) fails closed on it (§9)", () => {
    expect(DeliveredCommandOperation).toEqual(["EXECUTE", "REVIEW"]);
    const delivered = DeliveredCommandSchema.parse({ operation: "REVIEW", commandId: "cmd_r1", actionName: "system.uptime", input: {}, issuedAt: "2026-09-06T00:00:00.000Z" });
    const review: DeliveredReviewCommand = delivered as DeliveredReviewCommand;
    expect(review.operation).toBe("REVIEW");
    expect(() => DeliveredCommandSchema.parse({ operation: "PREPARE", commandId: "cmd_r1", actionName: "x", issuedAt: "2026-09-06T00:00:00.000Z" })).toThrow();
    // what a Connector built against the former arm does with a REVIEW delivery: refuse, never reinterpret
    const oldUnion = z.discriminatedUnion("operation", [z.object({ operation: z.literal("EXECUTE") }).passthrough(), z.object({ operation: z.literal("PREPARE") }).passthrough()]);
    expect(oldUnion.safeParse(delivered).success).toBe(false);
  });

  it("candidate exchange conformance: same command, admitted ⊆ candidates, no duplicates either side (the Platform filters, it does not invent)", () => {
    const request = { contractVersion: CE_CONTRACT_VERSION, commandId: "cmd_r1", candidates: ["web-01", "db-01", "web-02"] };
    const ok = (admitted: string[]) => CandidateResourceFilterExchangeSchema.safeParse({ request, response: { contractVersion: CE_CONTRACT_VERSION, commandId: "cmd_r1", admitted } }).success;
    expect(ok(["web-01", "web-02"])).toBe(true);
    expect(ok([])).toBe(true);
    expect(ok(["web-01", "db-99"])).toBe(false); // foreign identifier
    expect(ok(["web-01", "web-01"])).toBe(false); // duplicate admitted
    expect(CandidateResourceFilterExchangeSchema.safeParse({ request, response: { contractVersion: CE_CONTRACT_VERSION, commandId: "cmd_other", admitted: ["web-01"] } }).success).toBe(false); // other command
    expect(CandidateResourceFilterExchangeSchema.safeParse({ request: { ...request, candidates: ["web-01", "web-01"] }, response: { contractVersion: CE_CONTRACT_VERSION, commandId: "cmd_r1", admitted: ["web-01"] } }).success).toBe(false); // duplicate candidate
  });

  it("candidate exchange: the Service submits identifiers, the Platform answers the admitted subset — strict both ways", () => {
    const req = CandidateResourceFilterRequestSchema.parse({ contractVersion: CE_CONTRACT_VERSION, commandId: "cmd_r1", candidates: ["web-01", "db-01"] });
    expect(req.candidates).toHaveLength(2);
    expect(CandidateResourceFilterResponseSchema.parse({ contractVersion: CE_CONTRACT_VERSION, commandId: "cmd_r1", admitted: [] }).admitted).toEqual([]);
    expect(() => CandidateResourceFilterRequestSchema.parse({ contractVersion: CE_CONTRACT_VERSION, commandId: "cmd_r1", candidates: [""] })).toThrow();
    expect(() => CandidateResourceFilterResponseSchema.parse({ contractVersion: CE_CONTRACT_VERSION, commandId: "cmd_r1", admitted: ["web-01"], rejected: ["db-01"] })).toThrow();
  });
});

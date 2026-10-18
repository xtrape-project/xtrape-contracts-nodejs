import { describe, expect, it } from "vitest";
import {
  CeCommandStatus,
  CeCommandStatusSchema,
  CommandCancelRequestSchema,
  CommandCancelResponseSchema,
  CommandDispatchRequestSchema,
  CommandDispatchResponseSchema,
  CommandProgressSchema,
  CommandResultReportResponseSchema,
  CommandResultReportSchema,
  CommandTerminalResultSchema,
  SensitiveConsumeResponseSchema,
  SensitiveDeliveryStateSchema,
} from "../src/index";

// Import the exact shipped conformance fixtures so this suite proves the real
// bytes other repos (platform-ce, connector-nodejs, Panel, Demo) validate against.
import cl_dispatchReq from "../spec/ce/command-lifecycle/dispatch-request.valid.json";
import cl_runningAck from "../spec/ce/command-lifecycle/running-ack.valid.json";
import cl_completed from "../spec/ce/command-lifecycle/terminal-completed.valid.json";
import cl_failedTimeout from "../spec/ce/command-lifecycle/terminal-failed-timeout.valid.json";
import cl_failedCancelled from "../spec/ce/command-lifecycle/terminal-failed-cancelled.valid.json";
import cl_reportOrdinary from "../spec/ce/command-lifecycle/result-report-ordinary.valid.json";
import cl_reportFailed from "../spec/ce/command-lifecycle/result-report-failed.valid.json";
import cl_respApplied from "../spec/ce/command-lifecycle/report-response-applied.valid.json";
import cl_respAlreadyTerminal from "../spec/ce/command-lifecycle/report-response-already-terminal.valid.json";
import cl_respOwnership from "../spec/ce/command-lifecycle/report-response-ownership-mismatch.valid.json";
import cl_progress from "../spec/ce/command-lifecycle/progress.valid.json";
import cl_cancelReq from "../spec/ce/command-lifecycle/cancel-request.valid.json";
import cl_cancelCancelling from "../spec/ce/command-lifecycle/cancel-response-cancelling.valid.json";
import cl_cancelAlreadyTerminal from "../spec/ce/command-lifecycle/cancel-response-already-terminal.valid.json";
import cl_completedWithReason from "../spec/ce/command-lifecycle/terminal-completed-with-failure-reason.invalid.json";
import cl_failedNoReason from "../spec/ce/command-lifecycle/terminal-failed-without-reason.invalid.json";
import cl_unknownStatus from "../spec/ce/command-lifecycle/status.invalid-unknown-state.json";
import cl_reportNoInstance from "../spec/ce/command-lifecycle/result-report-missing-instance.invalid.json";
import cl_cancelContradictory from "../spec/ce/command-lifecycle/cancel-response-contradictory.invalid.json";
import cl_ordinaryWithPlaintext from "../spec/ce/command-lifecycle/ordinary-result-with-sensitive-plaintext.invalid.json";
import cl_respContradictory from "../spec/ce/command-lifecycle/report-response-contradictory.invalid.json";
import cl_terminalSensitiveProjection from "../spec/ce/command-lifecycle/terminal-sensitive-projection.valid.json";
import cl_terminalWithSecret from "../spec/ce/command-lifecycle/terminal-result-with-secret.invalid.json";

import sr_report from "../spec/ce/sensitive-result/sensitive-report.valid.json";
import sr_reportScalar from "../spec/ce/sensitive-result/sensitive-report-scalar-secret.valid.json";
import sr_pending from "../spec/ce/sensitive-result/delivery-state-pending.valid.json";
import sr_consumed from "../spec/ce/sensitive-result/delivery-state-consumed.valid.json";
import sr_expired from "../spec/ce/sensitive-result/delivery-state-expired.valid.json";
import sr_delivered from "../spec/ce/sensitive-result/consume-delivered.valid.json";
import sr_alreadyConsumed from "../spec/ce/sensitive-result/consume-already-consumed.valid.json";
import sr_consumeExpired from "../spec/ce/sensitive-result/consume-expired.valid.json";
import sr_mismatch from "../spec/ce/sensitive-result/consume-consumer-mismatch.valid.json";
import sr_pendingWithConsumed from "../spec/ce/sensitive-result/delivery-state-pending-with-consumedAt.invalid.json";
import sr_consumedNoAt from "../spec/ce/sensitive-result/delivery-state-consumed-without-consumedAt.invalid.json";
import sr_stateWithSecret from "../spec/ce/sensitive-result/delivery-state-with-secret.invalid.json";
import sr_deliveredPlusState from "../spec/ce/sensitive-result/consume-delivered-plus-state.invalid.json";
import sr_reportWithResult from "../spec/ce/sensitive-result/sensitive-report-with-generic-result.invalid.json";
import sr_ttlTooLarge from "../spec/ce/sensitive-result/sensitive-report-ttl-too-large.invalid.json";
import { SENSITIVE_TTL_MAX_SECONDS } from "../src/index";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe("durable command lifecycle contract (contracts#50)", () => {
  it("dispatch request carries an idempotency key for stable command identity", () => {
    expect(CommandDispatchRequestSchema.parse(cl_dispatchReq).idempotencyKey).toBe("idem-1");
    // strict: unknown field rejected
    expect(ok(CommandDispatchRequestSchema, { contractVersion: 1, bogus: 1 })).toBe(false);
  });

  it("keeps the four compatible states; TIMEOUT/CANCELLED are FAILED reasons, not new states", () => {
    expect(CeCommandStatus).toEqual(["PREPARED", "RUNNING", "COMPLETED", "FAILED"]);
    expect(CommandTerminalResultSchema.parse(cl_failedTimeout)).toMatchObject({ status: "FAILED", failureReason: "TIMEOUT" });
    expect(CommandTerminalResultSchema.parse(cl_failedCancelled)).toMatchObject({ status: "FAILED", failureReason: "CANCELLED" });
    expect(() => CeCommandStatusSchema.parse((cl_unknownStatus as { status: string }).status)).toThrow();
  });

  it("FROZEN invariant: COMPLETED forbids a failureReason; FAILED requires one", () => {
    expect(ok(CommandTerminalResultSchema, cl_completed)).toBe(true);
    expect(ok(CommandTerminalResultSchema, cl_completedWithReason)).toBe(false); // COMPLETED + failureReason
    expect(ok(CommandTerminalResultSchema, cl_failedNoReason)).toBe(false); // FAILED without reason
  });

  it("result report binds to the owning instance; the report response freezes duplicate/late/ownership", () => {
    expect(CommandResultReportSchema.parse(cl_reportOrdinary).instanceId).toBe("demo-echo-1");
    expect(ok(CommandResultReportSchema, cl_reportFailed)).toBe(true);
    expect(ok(CommandResultReportSchema, cl_reportNoInstance)).toBe(false);
    expect(CommandResultReportResponseSchema.parse(cl_respApplied).outcome).toBe("APPLIED");
    expect(CommandResultReportResponseSchema.parse(cl_respAlreadyTerminal).outcome).toBe("ALREADY_TERMINAL"); // late/duplicate no-op
    expect(CommandResultReportResponseSchema.parse(cl_respOwnership).outcome).toBe("OWNERSHIP_MISMATCH"); // wrong owner
    // discriminated on outcome: APPLIED/ALREADY_TERMINAL carry a terminal status,
    // a rejected outcome carries none — contradictory combos are rejected.
    expect(ok(CommandResultReportResponseSchema, cl_respContradictory)).toBe(false); // APPLIED + PREPARED
    expect(ok(CommandResultReportResponseSchema, { contractVersion: 1, commandId: "c", outcome: "UNKNOWN_COMMAND", status: "COMPLETED" })).toBe(false);
    expect(ok(CommandResultReportResponseSchema, { contractVersion: 1, commandId: "c", outcome: "APPLIED", status: "RUNNING" })).toBe(false);
  });

  it("progress carries instanceId (claim binding) + monotonic seq", () => {
    const p = CommandProgressSchema.parse(cl_progress);
    expect(p).toMatchObject({ instanceId: "demo-echo-1", seq: 3 });
    expect(ok(CommandProgressSchema, { contractVersion: 1, commandId: "c", instanceId: "i", seq: -1 })).toBe(false);
  });

  it("dispatch response is terminal-result | running-ack", () => {
    expect(CommandDispatchResponseSchema.parse(cl_runningAck)).toMatchObject({ status: "RUNNING" });
    expect(CommandDispatchResponseSchema.parse(cl_completed)).toMatchObject({ status: "COMPLETED" });
  });

  it("cancel response freezes legal outcome↔status combinations", () => {
    expect(CommandCancelRequestSchema.parse(cl_cancelReq).commandId).toBe("cmd_abc");
    expect(CommandCancelResponseSchema.parse(cl_cancelCancelling)).toMatchObject({ outcome: "CANCELLING", status: "RUNNING" });
    expect(CommandCancelResponseSchema.parse(cl_cancelAlreadyTerminal)).toMatchObject({ outcome: "ALREADY_TERMINAL", status: "COMPLETED" });
    expect(ok(CommandCancelResponseSchema, cl_cancelContradictory)).toBe(false); // CANCELLING + COMPLETED
  });
});

describe("sensitive / one-time result contract (contracts#50, server-ce#86)", () => {
  it("a sensitive result is one atomic report: redacted + secret + ownership, and NO generic plaintext result", () => {
    const s = CommandResultReportSchema.parse(sr_report);
    expect(s).toMatchObject({ sensitive: true, instanceId: "demo-echo-1" });
    // scalar secret / redacted allowed (API keys, one-time tokens)
    expect(CommandResultReportSchema.parse(sr_reportScalar)).toMatchObject({ secret: "sk-live-abc123", redacted: "sk-****" });
    // declaring sensitive:true but riding plaintext on the generic `result` is rejected
    expect(ok(CommandResultReportSchema, cl_ordinaryWithPlaintext)).toBe(false);
    expect(ok(CommandResultReportSchema, sr_reportWithResult)).toBe(false);
  });

  it("direction split: the secret rides ONLY the Connector report, never a Platform terminal/dispatch projection", () => {
    // Platform → caller projection: redacted + Platform-clamped expiresAt, NO secret
    const proj = CommandTerminalResultSchema.parse(cl_terminalSensitiveProjection);
    expect(proj).toMatchObject({ sensitive: true, expiresAt: expect.any(String) });
    expect(proj).not.toHaveProperty("secret");
    // a terminal/dispatch response carrying the plaintext is rejected (would bypass consume-once)
    expect(ok(CommandTerminalResultSchema, cl_terminalWithSecret)).toBe(false);
    expect(ok(CommandDispatchResponseSchema, cl_terminalWithSecret)).toBe(false);
  });

  it("TTL is Platform-clamped: the Connector may only request up to the frozen hard max", () => {
    expect(SENSITIVE_TTL_MAX_SECONDS).toBe(3600);
    expect(CommandResultReportSchema.parse(sr_report)).toMatchObject({ requestedTtlSeconds: 300 });
    expect(ok(CommandResultReportSchema, sr_ttlTooLarge)).toBe(false); // 999999 > hard max
  });

  it("delivery state is Platform-authored, strict, per-status field sets, and never carries the plaintext", () => {
    expect(SensitiveDeliveryStateSchema.parse(sr_pending).status).toBe("PENDING");
    expect(SensitiveDeliveryStateSchema.parse(sr_consumed)).toMatchObject({ status: "CONSUMED", consumedAt: expect.any(String) });
    expect(SensitiveDeliveryStateSchema.parse(sr_expired).status).toBe("EXPIRED");
    // frozen field sets + strict
    expect(ok(SensitiveDeliveryStateSchema, sr_pendingWithConsumed)).toBe(false); // PENDING + consumedAt
    expect(ok(SensitiveDeliveryStateSchema, sr_consumedNoAt)).toBe(false); // CONSUMED without consumedAt
    expect(ok(SensitiveDeliveryStateSchema, sr_stateWithSecret)).toBe(false); // a state carrying `secret`
  });

  it("consume response: only DELIVERED carries the secret; every other outcome is state-only", () => {
    expect(SensitiveConsumeResponseSchema.parse(sr_delivered)).toMatchObject({ outcome: "DELIVERED", secret: { apiKey: "sk-live-abc123" } });
    expect(SensitiveConsumeResponseSchema.parse(sr_alreadyConsumed)).toMatchObject({ outcome: "ALREADY_CONSUMED" });
    expect(SensitiveConsumeResponseSchema.parse(sr_consumeExpired)).toMatchObject({ outcome: "EXPIRED" });
    expect(SensitiveConsumeResponseSchema.parse(sr_mismatch)).toMatchObject({ outcome: "CONSUMER_MISMATCH" });
    // a state-only outcome may never smuggle a plaintext secret
    expect(ok(SensitiveConsumeResponseSchema, sr_deliveredPlusState)).toBe(false);
    for (const v of [sr_alreadyConsumed, sr_consumeExpired, sr_mismatch]) {
      expect(SensitiveConsumeResponseSchema.parse(v)).not.toHaveProperty("secret");
    }
  });
});

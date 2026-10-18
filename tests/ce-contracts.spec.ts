import { describe, expect, it } from "vitest";
import {
  CE_CONTRACT_VERSION,
  ActionAsyncAckSchema,
  ActionCommandResultSchema,
  ActionResultSchema,
  ActionDisplayListSchema,
  ActionDisplayDetailSchema,
  ServiceManifestSchema,
  WorkerSchema,
  ConversationMessageSchema,
  ConnectorHeartbeatSchema,
  ErrorModelSchema,
  WorkerHealth,
  ConversationTargetType,
  MessageSenderType,
  MessageType,
  CeErrorCode,
  CommandSchema,
  ActionDefinitionSchema,
  HealthReportSchema,
  ConfigItemSchema,
  ConnectorHeartbeatRequestSchema,
  BusEventEnvelopeSchema,
} from "../src/index";

const keys = (shape: Record<string, unknown>) => Object.keys(shape).sort();

describe("Xtrape CE Phase 0 contracts", () => {
  it("parses the minimal ServiceManifest from runtime-platform/02", () => {
    const m = ServiceManifestSchema.parse({
      contractVersion: 1,
      service: { id: "demo-echo-service", name: "Demo Echo Service", version: "0.1.0" },
      runtime: { language: "node", agent: "xtrape-agent-nodejs", endpoint: "http://demo-echo:8080" },
      capabilities: ["status.query"],
      message: { supportedTypes: ["QUERY"] },
    });
    // tenant defaults to "default" (forward-compat hook)
    expect(m.tenant).toBe("default");
    expect(m.contractVersion).toBe(CE_CONTRACT_VERSION);
  });

  it("rejects a non-kebab service id and an unknown contractVersion", () => {
    expect(() =>
      ServiceManifestSchema.parse({
        contractVersion: 1,
        service: { id: "Demo_Echo", name: "x", version: "0.1.0" },
        runtime: { language: "node", agent: "xtrape-agent-nodejs" },
        capabilities: ["status.query"],
        message: { supportedTypes: ["QUERY"] },
      }),
    ).toThrow();

    expect(() =>
      ServiceManifestSchema.parse({
        contractVersion: 2,
        service: { id: "demo-echo-service", name: "x", version: "0.1.0" },
        runtime: { language: "node", agent: "xtrape-agent-nodejs" },
        capabilities: ["status.query"],
        message: { supportedTypes: ["QUERY"] },
      }),
    ).toThrow();
  });

  it("carries the self-reported build identity when present, and refuses a malformed one (#253 ruling)", () => {
    const base = {
      contractVersion: 1,
      service: { id: "demo-echo-service", name: "Demo Echo Service", version: "0.1.0" },
      runtime: { language: "node", agent: "xtrape-agent-nodejs" },
      capabilities: ["status.query"],
      message: { supportedTypes: ["QUERY"] },
    };
    const digest = `sha256:${"a".repeat(64)}`;
    const m = ServiceManifestSchema.parse({ ...base, build: { artifactDigest: digest } });
    expect(m.build?.artifactDigest).toBe(digest);
    // optional: a non-governed Service has no admission to feed
    expect(ServiceManifestSchema.parse(base).build).toBeUndefined();
    // but a PRESENT build block must be exact: a bare hex, a wrong algo tag
    // or an extra key would let a malformed identity reach the admission row
    expect(() => ServiceManifestSchema.parse({ ...base, build: { artifactDigest: "a".repeat(64) } })).toThrow();
    expect(() => ServiceManifestSchema.parse({ ...base, build: { artifactDigest: `sha512:${"a".repeat(64)}` } })).toThrow();
    expect(() => ServiceManifestSchema.parse({ ...base, build: { artifactDigest: digest, extra: 1 } })).toThrow();
  });

  it("requires at least one capability and one supported message type", () => {
    expect(() =>
      ServiceManifestSchema.parse({
        contractVersion: 1,
        service: { id: "demo-echo-service", name: "x", version: "0.1.0" },
        runtime: { language: "node", agent: "xtrape-agent-nodejs" },
        capabilities: [],
        message: { supportedTypes: [] },
      }),
    ).toThrow();
  });

  it("parses a Worker from runtime-platform/04", () => {
    const i = WorkerSchema.parse({
      contractVersion: 1,
      serviceId: "demo-echo-service",
      instanceId: "demo-echo-7f3a",
      address: "http://10.0.0.12:8080",
      version: "0.1.0",
      health: "HEALTHY",
    });
    expect(i.health).toBe("HEALTHY");
    expect(i.tenant).toBe("default");
  });

  it("parses a request/reply ConversationMessage pair from runtime-platform/03", () => {
    const req = ConversationMessageSchema.parse({
      contractVersion: 1,
      messageId: "msg_001",
      conversationId: "conv_tg_123",
      targetType: "SERVICE",
      targetId: "demo-echo-service",
      senderType: "USER",
      senderId: "telegram:123456",
      messageType: "QUERY",
      content: "status?",
      metadata: { channel: "telegram" },
    });
    const reply = ConversationMessageSchema.parse({
      contractVersion: 1,
      messageId: "msg_002",
      conversationId: "conv_tg_123",
      targetType: "USER",
      targetId: "telegram:123456",
      senderType: "SERVICE",
      senderId: "demo-echo-service",
      messageType: "SUMMARY",
      content: "healthy; last run ok",
      replyToMessageId: "msg_001",
    });
    expect(reply.replyToMessageId).toBe(req.messageId);
  });

  it("parses ConnectorHeartbeat and ErrorModel", () => {
    const hb = ConnectorHeartbeatSchema.parse({
      contractVersion: 1,
      serviceId: "demo-echo-service",
      instanceId: "demo-echo-7f3a",
      ts: "2026-06-17T10:00:00Z",
      health: "HEALTHY",
      metricsSummary: { lastRunOk: true, uptimeSec: 3600 },
    });
    expect(hb.health).toBe("HEALTHY");

    const err = ErrorModelSchema.parse({
      code: "NO_HEALTHY_INSTANCE",
      message: "no healthy instance for serviceId",
      retryable: true,
    });
    expect(err.retryable).toBe(true);
  });
});

/**
 * Frozen-surface guard for CE 0.1 Phase 0.
 *
 * These assertions lock the exact field/enum surface so that an accidental
 * removal, rename, or incompatible addition fails loudly in review — including
 * changes that `.passthrough()` or optional fields would otherwise let slip
 * through a parse-only test. If a change here is intentional, it is a contract
 * change: bump `CE_CONTRACT_VERSION` and update this guard together.
 */
describe("CE 0.1 frozen contract surface", () => {
  it("pins CE_CONTRACT_VERSION", () => {
    expect(CE_CONTRACT_VERSION).toBe(1);
  });

  it("pins enum value sets", () => {
    expect([...WorkerHealth]).toEqual(["HEALTHY", "DEGRADED", "UNREACHABLE"]);
    expect([...ConversationTargetType]).toEqual(["SERVICE", "TASK", "USER", "SYSTEM"]);
    expect([...MessageSenderType]).toEqual(["USER", "SERVICE", "SYSTEM"]);
    expect([...MessageType]).toEqual([
      "TEXT",
      "QUERY",
      "COMMAND",
      "SUMMARY",
      "APPROVAL_REQUEST",
      "APPROVAL_RESPONSE",
    ]);
    expect(Object.keys(CeErrorCode).sort()).toEqual([
      "CONTRACT_VERSION_MISMATCH",
      "INTERNAL_ERROR",
      "NO_HEALTHY_INSTANCE",
      "SENSITIVE_ALREADY_CONSUMED",
      "SENSITIVE_CONSUMER_MISMATCH",
      "SENSITIVE_EXPIRED",
      "TARGET_OFFLINE",
      "TRANSPORT_MODE_UNSUPPORTED",
      "UNKNOWN_COMMAND",
      "UNKNOWN_INSTANCE",
      "VALIDATION_FAILED",
    ]);
  });

  it("pins ServiceManifest field surface", () => {
    expect(keys(ServiceManifestSchema.shape)).toEqual([
      "build",
      "capabilities",
      "contractVersion",
      "features",
      "message",
      "owner",
      "runtime",
      "service",
      "tenant",
      "triggers",
    ]);
    expect(keys(ServiceManifestSchema.shape.service.shape)).toEqual([
      "description",
      "id",
      "name",
      "version",
    ]);
    expect(keys(ServiceManifestSchema.shape.runtime.shape)).toEqual([
      "agent",
      "endpoint",
      "language",
    ]);
    expect(keys(ServiceManifestSchema.shape.message.shape)).toEqual(["supportedTypes"]);
  });

  it("pins Worker field surface", () => {
    expect(keys(WorkerSchema.shape)).toEqual([
      "address",
      "contractVersion",
      "health",
      "instanceId",
      "lastHeartbeatAt",
      "serviceId",
      "startedAt",
      // #82: capability negotiation for the per-instance callback credential —
      // the Connector declares adoption here; the Platform must not present the
      // derived token to instances that did not.
      "supportsCallbackToken",
      "tenant",
      "version",
    ]);
  });

  it("pins ConversationMessage field surface", () => {
    expect(keys(ConversationMessageSchema.shape)).toEqual([
      "content",
      "contractVersion",
      "conversationId",
      "idempotencyKey",
      "messageId",
      "messageType",
      "metadata",
      "payload",
      "replyToMessageId",
      "senderId",
      "senderType",
      "targetId",
      "targetType",
      "tenant",
    ]);
  });

  it("pins ConnectorHeartbeat field surface", () => {
    expect(keys(ConnectorHeartbeatSchema.shape)).toEqual([
      "contractVersion",
      "health",
      "instanceId",
      "metricsSummary",
      "serviceId",
      "tenant",
      "ts",
    ]);
  });

  it("pins ErrorModel field surface", () => {
    expect(keys(ErrorModelSchema.shape)).toEqual(["code", "message", "retryable"]);
  });

  it("pins ActionAsyncAck and ActionCommandResult field surfaces", () => {
    expect(keys(ActionAsyncAckSchema.shape)).toEqual(["commandId", "contractVersion", "status"]);
    expect(keys(ActionCommandResultSchema.shape)).toEqual([
      "commandId",
      "contractVersion",
      "errorCode",
      "errorMessage",
      "result",
      "status",
    ]);
  });
});

describe("Async action completion envelopes (server-ce#41 Stage B)", () => {
  it("parses a RUNNING ack", () => {
    const ack = ActionAsyncAckSchema.parse({ contractVersion: 1, status: "RUNNING", commandId: "cmd_1" });
    expect(ack.commandId).toBe("cmd_1");
  });

  it("rejects an ack without a command id", () => {
    expect(() => ActionAsyncAckSchema.parse({ contractVersion: 1, status: "RUNNING", commandId: "" })).toThrow();
  });

  it("parses a COMPLETED result with payload", () => {
    const res = ActionCommandResultSchema.parse({
      contractVersion: 1,
      commandId: "cmd_1",
      status: "COMPLETED",
      result: { ok: true },
    });
    expect(res.status).toBe("COMPLETED");
    expect(res.result).toEqual({ ok: true });
  });

  it("parses a FAILED result with error fields and rejects unknown status", () => {
    const res = ActionCommandResultSchema.parse({
      contractVersion: 1,
      commandId: "cmd_1",
      status: "FAILED",
      errorCode: "SESSION_LOGIN_FAILED",
      errorMessage: "otp timeout",
    });
    expect(res.errorCode).toBe("SESSION_LOGIN_FAILED");
    expect(() => ActionCommandResultSchema.parse({ contractVersion: 1, commandId: "cmd_1", status: "RUNNING" })).toThrow();
  });
});

describe("Action result display envelope (contracts#44)", () => {
  it("parses a success envelope carrying a list display", () => {
    const r = ActionResultSchema.parse({
      success: true,
      data: {
        accounts: [],
        list: { title: "Accounts", data: [{ id: "a@x.com", enabled: true, failures: 0 }], columns: [{ key: "id", format: "code", copyable: true }], rowActions: [{ label: "Enable", action: "enableAccount", payload: { accountId: "$row.id" }, confirm: true }] },
      },
    });
    const list = ActionDisplayListSchema.parse((r.data as Record<string, unknown>).list);
    expect(list.data[0].enabled).toBe(true);
    expect(list.rowActions?.[0].action).toBe("enableAccount");
  });

  it("parses a failure envelope and a detail display", () => {
    const r = ActionResultSchema.parse({ success: false, message: "boom", error: { code: "ACTION_FAILED" } });
    expect(r.success).toBe(false);
    const detail = ActionDisplayDetailSchema.parse({
      title: "Account",
      data: { id: "a@x.com", healthy: false, cooldownRemainingMs: 1200 },
      fields: [{ key: "cooldownRemainingMs", label: "Cooldown", format: "duration" }],
    });
    expect(detail.fields?.[0].format).toBe("duration");
  });

  it("rejects an unknown display format and a non-array list data", () => {
    expect(() => ActionDisplayListSchema.parse({ data: [{ a: 1 }], columns: [{ key: "a", format: "sparkline" }] })).toThrow();
    expect(() => ActionDisplayListSchema.parse({ data: { a: 1 } })).toThrow();
  });

  it("pins the display envelope field surfaces", () => {
    expect(keys(ActionResultSchema.shape)).toEqual(["data", "error", "message", "success"]);
    expect(keys(ActionDisplayListSchema.shape)).toEqual(["columns", "data", "emptyText", "pageActions", "pageSize", "rowActions", "title"]);
    expect(keys(ActionDisplayDetailSchema.shape)).toEqual(["actions", "data", "fields", "title"]);
  });
});

describe("logical Service identity on the CE wire (docs#228 D6, contracts#128)", () => {
  const command = {
    id: "cmd_abc",
    agentId: "agt_abc",
    serviceId: "linux-ops-widget-nodejs",
    type: "ACTION_EXECUTE",
    actionName: "getServiceStatus",
    status: "PENDING",
    createdAt: "2026-08-25T00:00:00.000Z",
  };

  it("CommandSchema.serviceId is a logical kebab Service id", () => {
    expect(CommandSchema.parse(command).serviceId).toBe("linux-ops-widget-nodejs");
  });

  it("rejects the legacy svc_* instance-style form everywhere the field means logical Service identity", () => {
    expect(() => CommandSchema.parse({ ...command, serviceId: "svc_abc123def456" })).toThrow();
    expect(() => ActionDefinitionSchema.parse({ id: "act_1", serviceId: "svc_x", name: "a", label: "A", dangerLevel: "LOW", requiresConfirmation: false })).toThrow();
    expect(() => HealthReportSchema.parse({ id: "hlr_1", serviceId: "svc_x", status: "UP", reportedAt: "2026-08-25T00:00:00.000Z" })).toThrow();
    expect(() => ConfigItemSchema.parse({ id: "cfg_1", serviceId: "svc_x", key: "k", type: "string", editable: false, sensitive: false })).toThrow();
    expect(() => ConnectorHeartbeatRequestSchema.parse({ serviceId: "svc_x" })).toThrow();
    expect(() => BusEventEnvelopeSchema.parse({ eventType: "e", sourceServiceCode: "c", sourceServiceId: "svc_x" })).toThrow();
  });

  it("rejects uppercase and underscore spellings — same shared rule as the Checkpoint identity", () => {
    expect(() => CommandSchema.parse({ ...command, serviceId: "LinuxOps" })).toThrow();
    expect(() => CommandSchema.parse({ ...command, serviceId: "linux_ops" })).toThrow();
  });

  it("system-minted opaque ids keep their prefixes (they are not Service identity)", () => {
    expect(() => CommandSchema.parse({ ...command, id: "not-prefixed" })).toThrow();
    expect(() => CommandSchema.parse({ ...command, agentId: "linux-ops" })).toThrow();
  });
});

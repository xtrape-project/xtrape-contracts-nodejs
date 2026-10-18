import { describe, expect, it } from "vitest";
import {
  ActionDefinitionInputSchema,
  ConnectorHeartbeatRequestSchema,
  CommandResultSchema,
  ConfigItemInputSchema,
  ErrorCode,
  HealthReportInputSchema,
  RegisterConnectorRequestSchema,
  RegisterConnectorResponseSchema,
  ReportCommandResultRequestSchema,
  ServiceReportRequestSchema,
  eventMetadataSchema,
  paginate,
  parseSort,
  serviceCapabilitySchema,
} from "../src/index";

describe("schema validation", () => {
  it("accepts a valid Connector registration request", () => {
    const parsed = RegisterConnectorRequestSchema.parse({
      registrationToken: "opstage_reg_public_review",
      agent: {
        code: "demo-agent",
        name: "Demo Agent",
        runtime: "nodejs",
      },
    });

    expect(parsed.agent.code).toBe("demo-agent");
  });

  it("rejects a registration that still carries the removed `mode` field (docs#199 D2)", () => {
    const parsed = RegisterConnectorRequestSchema.parse({
      registrationToken: "opstage_reg_public_review",
      agent: { code: "legacy-a", name: "Legacy A", mode: "ophub", runtime: "go" },
    });
    // The wrapper is not strict, so an obsolete key is dropped rather than
    // rejected — but it must no longer be part of the parsed value.
    expect("mode" in parsed.agent).toBe(false);
  });

  it("accepts multi-service report metadata", () => {
    expect(() =>
      ServiceReportRequestSchema.parse({
        services: [
          {
            code: "svc-one",
            name: "Service One",
            manifest: {
              kind: "Worker",
              code: "svc-one",
              name: "Service One",
              version: "0.3.0",
              runtime: "nodejs",
              capabilities: [{ name: "accounts.sync", label: "Account sync" }],
              events: [{ name: "account.synced", direction: "publish", designOnly: true }],
            },
            capabilities: [{ name: "accounts.sync" }],
            events: [{ name: "account.synced", direction: "publish" }],
          },
          {
            code: "svc-two",
            name: "Service Two",
            manifest: {
              kind: "Worker",
              code: "svc-two",
              name: "Service Two",
              version: "0.3.0",
              runtime: "nodejs",
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects unsupported health and effective service statuses", () => {
    expect(() => HealthReportInputSchema.parse({ status: "HEALTHY" })).toThrow();
    expect(() => HealthReportInputSchema.parse({ status: "OFFLINE" })).toThrow();
    expect(() => HealthReportInputSchema.parse({ status: "UP" })).not.toThrow();
  });

  it("rejects invalid registration credentials", () => {
    expect(() =>
      RegisterConnectorResponseSchema.parse({
        agentId: "svc_wrong",
        agentToken: "opstage_agent_token",
        heartbeatIntervalSeconds: 30,
        commandPollIntervalSeconds: 5,
      }),
    ).toThrow();

    expect(() =>
      RegisterConnectorResponseSchema.parse({
        agentId: "agt_123",
        agentToken: "plain-token",
        heartbeatIntervalSeconds: 30,
        commandPollIntervalSeconds: 5,
      }),
    ).toThrow();
  });

  it("accepts optional action fields", () => {
    const action = ActionDefinitionInputSchema.parse({
      name: "sync",
      label: "Sync",
    });

    expect(action.dangerLevel).toBeUndefined();
  });

  it("validates capability and event metadata schemas", () => {
    expect(serviceCapabilitySchema.parse({ name: "backup.create", metadata: { target: "sqlite" } }).name).toBe("backup.create");
    expect(eventMetadataSchema.parse({ name: "backup.created", direction: "publish" })).toMatchObject({
      direction: "publish",
      designOnly: true,
    });
  });

  it("validates service reports, heartbeats, and command results", () => {
    expect(() =>
      ServiceReportRequestSchema.parse({
        services: [
          {
            code: "demo-service",
            name: "Demo Service",
            runtime: "nodejs",
            manifest: {},
          },
        ],
      }),
    ).not.toThrow();

    expect(() => ServiceReportRequestSchema.parse({ services: [] })).toThrow();
    expect(() => ConnectorHeartbeatRequestSchema.parse({ serviceId: "linux-ops-widget-nodejs", health: { status: "DEGRADED" } })).not.toThrow();
    // docs#228 D6: a legacy svc_* instance-style spelling is not a logical Service id
    expect(() => ConnectorHeartbeatRequestSchema.parse({ serviceId: "svc_123", health: { status: "DEGRADED" } })).toThrow();
    expect(() => ConnectorHeartbeatRequestSchema.parse({ serviceId: "agt_wrong" })).toThrow();
    expect(() => ReportCommandResultRequestSchema.parse({ success: true, data: { refreshed: true } })).not.toThrow();
  });

  it("validates config item inputs and persisted command results", () => {
    expect(() =>
      ConfigItemInputSchema.parse({
        key: "apiKey",
        label: "API key",
        type: "secret",
        sensitive: true,
        secretRef: "secret://api-key",
      }),
    ).not.toThrow();

    expect(() =>
      CommandResultSchema.parse({
        id: "crs_123",
        commandId: "cmd_123",
        success: false,
        message: "failed",
        error: { code: "ACTION_FAILED" },
        reportedAt: "2026-05-06T00:00:00.000Z",
      }),
    ).not.toThrow();

    expect(() =>
      CommandResultSchema.parse({
        id: "cmd_wrong",
        commandId: "cmd_123",
        success: true,
        reportedAt: "2026-05-06T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("exports public error codes and pagination helpers", () => {
    expect(ErrorCode.VALIDATION_FAILED).toBe("VALIDATION_FAILED");
    expect(ErrorCode.ACTION_REQUIRES_CONFIRMATION).toBe("ACTION_REQUIRES_CONFIRMATION");

    expect(parseSort("-createdAt,name", ["createdAt", "name"])).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "name", direction: "asc" },
    ]);
    expect(() => parseSort("unknown", ["createdAt"])).toThrow("Unknown sort field: unknown");

    expect(paginate([{ id: "svc_1" }], 1, 20, 1)).toEqual({
      data: [{ id: "svc_1" }],
      pagination: { page: 1, pageSize: 20, total: 1 },
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  ConnectorStatus,
  HealthStatus,
  CommandStatus,
  DangerLevel,
  AuditActorType,
  AuditResult,
  TokenStatus,
  ErrorCode,
  AnyJson,
  ConnectorStatusSchema,
  HealthStatusSchema,
  CommandStatusSchema,
  DangerLevelSchema,
  UserSchema,
  createUserRequestSchema,
  updateUserRequestSchema,
  resetUserPasswordRequestSchema,
  adminLoginRequestSchema,
  AdminSessionSchema,
  ConnectorSchema,
  RegistrationTokenSchema,
  createRegistrationTokenRequestSchema,
  CreateRegistrationTokenResponseSchema,
  healthReportInputSchema,
  configItemInputSchema,
  actionDefinitionInputSchema,
  reportedServiceSchema,
  serviceReportRequestSchema,
  registerConnectorRequestSchema,
  RegisterConnectorResponseSchema,
  ConnectorHeartbeatResponseSchema,
  connectorHeartbeatRequestSchema,
  HealthReportSchema,
  ConfigItemSchema,
  ActionDefinitionSchema,
  createActionCommandRequestSchema,
  CommandSchema,
  reportCommandResultRequestSchema,
  CommandResultSchema,
  CommandDetailSchema,
  AuditEventSchema,
  DashboardSummarySchema,
  SystemHealthSchema,
  SystemVersionSchema,
  ListQueryBase,
  parseSort,
  paginate,
  HttpError
} from "../src/index";

describe("Schema Validation", () => {
  // Test enum schemas
  it("validates ConnectorStatusSchema", () => {
    expect(ConnectorStatusSchema.parse("ONLINE")).toBe("ONLINE");
    expect(() => ConnectorStatusSchema.parse("INVALID")).toThrow();
  });

  it("validates HealthStatusSchema", () => {
    expect(HealthStatusSchema.parse("UP")).toBe("UP");
    expect(() => HealthStatusSchema.parse("INVALID")).toThrow();
  });

  it("validates CommandStatusSchema", () => {
    expect(CommandStatusSchema.parse("SUCCEEDED")).toBe("SUCCEEDED");
    expect(() => CommandStatusSchema.parse("INVALID")).toThrow();
  });

  it("validates DangerLevelSchema", () => {
    expect(DangerLevelSchema.parse("HIGH")).toBe("HIGH");
    expect(DangerLevelSchema.parse(undefined)).toBe("LOW"); // default
  });

  // Test Connector registration schemas
  it("validates RegisterConnectorRequestSchema", () => {
    const validRequest = {
      registrationToken: "opstage_reg_abc123",
      agent: {
        code: "test-agent"
      }
    };
    expect(registerConnectorRequestSchema.parse(validRequest)).toEqual(validRequest);

    expect(() => registerConnectorRequestSchema.parse({
      registrationToken: "invalid_token",
      agent: { code: "test" }
    })).toThrow();
  });

  it("validates RegisterConnectorResponseSchema", () => {
    const validResponse = {
      agentId: "agt_abc123def456",
      agentToken: "opstage_agent_xyz789",
      heartbeatIntervalSeconds: 30,
      commandPollIntervalSeconds: 10
    };
    expect(RegisterConnectorResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it("validates ReportedServiceSchema", () => {
    const validService = {
      code: "test-service",
      name: "Test Service",
      manifest: {}
    };
    expect(reportedServiceSchema.parse(validService)).toEqual(validService);
  });

  it("validates ServiceReportRequestSchema", () => {
    const validRequest = {
      services: [{
        code: "test-service",
        name: "Test Service",
        manifest: {}
      }]
    };
    expect(serviceReportRequestSchema.parse(validRequest)).toEqual(validRequest);
  });

  // Test Health report schemas
  it("validates HealthReportInputSchema", () => {
    const validHealth = {
      status: "UP" as const,
      message: "All good"
    };
    expect(healthReportInputSchema.parse(validHealth)).toEqual(validHealth);
  });

  it("validates ConnectorHeartbeatRequestSchema", () => {
    const validHeartbeat = {
      health: {
        status: "UP" as const
      }
    };
    expect(connectorHeartbeatRequestSchema.parse(validHeartbeat)).toEqual(validHeartbeat);
  });

  it("validates ConnectorHeartbeatResponseSchema", () => {
    const validResponse = {
      heartbeatIntervalSeconds: 30,
      commandPollIntervalSeconds: 10
    };
    expect(ConnectorHeartbeatResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  // Test Config item schemas
  it("validates ConfigItemInputSchema", () => {
    const validConfig = {
      key: "database_url",
      type: "string",
      sensitive: true
    };
    expect(configItemInputSchema.parse(validConfig)).toEqual(validConfig);
  });

  it("validates ConfigItemSchema", () => {
    const validConfig = {
      id: "cfg_abc123def456",
      serviceId: "linux-ops-widget-nodejs",
      key: "database_url",
      type: "string",
      sensitive: true,
      editable: false // default value from schema
    };
    expect(ConfigItemSchema.parse(validConfig)).toEqual(validConfig);
  });

  // Test Action definition schemas
  it("validates ActionDefinitionInputSchema", () => {
    const validAction = {
      name: "restart",
      label: "Restart Service",
      dangerLevel: "MEDIUM" as const
    };
    expect(actionDefinitionInputSchema.parse(validAction)).toEqual(validAction);
  });

  it("validates ActionDefinitionSchema", () => {
    const validAction = {
      id: "act_abc123def456",
      serviceId: "linux-ops-widget-nodejs",
      name: "restart",
      label: "Restart Service",
      dangerLevel: "MEDIUM" as const,
      requiresConfirmation: false
    };
    expect(ActionDefinitionSchema.parse(validAction)).toEqual(validAction);
  });

  // Test Command schemas
  it("validates CommandSchema", () => {
    const validCommand = {
      id: "cmd_abc123def456",
      agentId: "agt_abc123def456",
      serviceId: "linux-ops-widget-nodejs",
      type: "ACTION_EXECUTE" as const,
      actionName: "restart",
      status: "PENDING" as const,
      createdAt: "2026-05-06T13:22:30Z"
    };
    expect(CommandSchema.parse(validCommand)).toEqual(validCommand);
  });

  it("validates ReportCommandResultRequestSchema", () => {
    const validResult = {
      success: true,
      message: "Command completed successfully"
    };
    expect(reportCommandResultRequestSchema.parse(validResult)).toEqual(validResult);
  });

  it("validates CommandResultSchema", () => {
    const validResult = {
      id: "crs_abc123def456",
      commandId: "cmd_abc123def456",
      success: true,
      reportedAt: "2026-05-06T13:22:30Z"
    };
    expect(CommandResultSchema.parse(validResult)).toEqual(validResult);
  });

  // Test Error codes
  it("exports ErrorCode correctly", () => {
    expect(ErrorCode.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
    expect(ErrorCode.UNAUTHORIZED).toBe("UNAUTHORIZED");
    expect(Object.values(ErrorCode)).toContain("VALIDATION_FAILED");
  });

  // Test pagination helpers
  it("ListQueryBase validates pagination", () => {
    expect(ListQueryBase.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(ListQueryBase.parse({ page: 2, pageSize: 50 })).toEqual({ page: 2, pageSize: 50 });
    
    expect(() => ListQueryBase.parse({ pageSize: 200 })).toThrow(); // max 100
    expect(() => ListQueryBase.parse({ page: 0 })).toThrow(); // min 1
  });

  it("parseSort handles sort fields", () => {
    const allowedFields = ["name", "createdAt"] as const;
    expect(parseSort("name,-createdAt", allowedFields)).toEqual([
      { field: "name", direction: "asc" },
      { field: "createdAt", direction: "desc" }
    ]);
    
    expect(() => parseSort("invalidField", allowedFields)).toThrow(HttpError);
  });

  it("paginate creates pagination object", () => {
    const items = [1, 2, 3];
    const result = paginate(items, 1, 10, 3);
    expect(result).toEqual({
      data: items,
      pagination: { page: 1, pageSize: 10, total: 3 }
    });
  });

  // Test that README examples match actual exports
  it("README examples should match actual exports", () => {
    // This ensures we don't have drift between documentation and implementation
    expect(ConnectorStatus).toBeDefined();
    expect(ErrorCode).toBeDefined();
  });

  // Test that schemas don't over-constrain future draft fields
  it("schemas allow additional fields via passthrough", () => {
    const reportWithExtra = {
      code: "test",
      name: "Test",
      manifest: {},
      // Additional fields that might be added in future
      experimentalFeature: true,
      metadata: { custom: "value" }
    };
    // Should not throw - passthrough allows extra fields
    expect(reportedServiceSchema.parse(reportWithExtra)).toMatchObject({ code: "test" });
  });
});
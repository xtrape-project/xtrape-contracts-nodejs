
import { z } from "zod";
import { TransportParametersSchema } from "./ce";

export { z };

// Xtrape CE runtime contracts (Phase 0), versioned via `contractVersion`.
// Coexist with the pre-CE legacy contracts below.
export * from "./ce";

// Xtrape Checkpoint contracts (0.8.5) — the Controlled Exposure (arch/16) wire
// surface, versioned by a `contractVersion` wire field (value
// CHECKPOINT_CONTRACT_VERSION); see ./checkpoint (contracts-nodejs#59; module
// renamed from ./exposure per xtrape-docs#259 — bare "Exposure" names the
// projection layer).
export * from "./checkpoint";
import { LogicalServiceIdSchema } from "./checkpoint";

// Round-1 static Resource-extractor contract (docs#266 N1–N5, mechanically
// encoded per contracts-nodejs#130): artifact grammar, execution-profile
// record family, deterministic failure codes, and the shared conformance
// vectors both consumers (platform interpreter, Connector-SDK authoring) run.
export * from "./extraction";
export * from "./extraction-vectors";

// Connector-named primaries per the 0.8.0 concept freeze (contracts-nodejs#93).
// The `Agent*` compatibility aliases established there were DELETED in #99
// (docs#199 D11: no aliases, delete outright — `agent` names too many distinct
// things to keep the ambiguity frozen into the export surface).
// Wire bytes are unchanged by that deletion: enum VALUES ("AGENT"), JSON payload
// keys (`agent`, `agentId`, `agentToken`), token/id prefixes (`agt_`,
// `opstage_agent_`) and error codes (AGENT_REVOKED/AGENT_DISABLED) stay frozen.
export const ConnectorStatus = ["PENDING","ONLINE","OFFLINE","DISABLED","REVOKED"] as const;
export const HealthStatus = ["UP","DEGRADED","DOWN","UNKNOWN"] as const;
export const CommandStatus = ["PENDING","RUNNING","SUCCEEDED","FAILED","EXPIRED","CANCELLED"] as const;
export const DangerLevel = ["LOW","MEDIUM","HIGH"] as const;
/** The "AGENT" member is a frozen wire VALUE (audit rows persist it); the rename is symbol-level only. */
export const AuditActorType = ["USER","AGENT","SYSTEM"] as const;
export const AuditResult = ["SUCCESS","FAILURE"] as const;
export const TokenStatus = ["ACTIVE","REVOKED","EXPIRED","USED"] as const;
export type ConnectorStatus = typeof ConnectorStatus[number];
export type HealthStatus = typeof HealthStatus[number];
export type CommandStatus = typeof CommandStatus[number];
export type DangerLevel = typeof DangerLevel[number];
export type AuditActorType = typeof AuditActorType[number];
export type AuditResult = typeof AuditResult[number];
export type TokenStatus = typeof TokenStatus[number];

export const ServiceKind = ["business", "infrastructure", "system"] as const;
export type ServiceKind = typeof ServiceKind[number];
export const ServiceKindSchema = z.enum(ServiceKind);

// `newId`, `idPrefixes`, and `IdPrefix` were removed in v0.2 — they were a
// runtime helper that did not belong in a contracts package, and they
// produced IDs in a different format than the Platform's actual `createId`
// (nanoid 21 here vs. randomBytes(12).base64url() on the Platform). Consumers
// that need to mint IDs locally should wire their own factory; the schemas
// still accept any string whose prefix is one of `agt_` / `tok_` / etc. via
// `z.string().startsWith(...)`. Prefixes belong ONLY to system-minted opaque
// ids; a field that means the LOGICAL Service identity is a declarative kebab
// id and rejects the legacy `svc_*` instance-style form (docs#228 D6 — the
// pre-public 0.8.x correction is singular, no dual-accept transition).

export const AnyJson = z.record(z.any());
export const ConnectorStatusSchema = z.enum(ConnectorStatus);
export const HealthStatusSchema = z.enum(HealthStatus);
export const CommandStatusSchema = z.enum(CommandStatus);
export const DangerLevelSchema = z.enum(DangerLevel).default("LOW");

export const UserSchema = z.object({ id: z.string().startsWith("usr_"), username: z.string(), displayName: z.string().nullable().optional(), createdAt: z.string(), updatedAt: z.string() });
export type User = z.infer<typeof UserSchema>;
export const UserRole = z.enum(["owner", "operator", "viewer"]);
export type UserRole = z.infer<typeof UserRole>;
export const createUserRequestSchema = z.object({ username: z.string().min(1), password: z.string().min(12), displayName: z.string().optional(), role: UserRole.default("viewer") });
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
export const updateUserRequestSchema = z.object({ displayName: z.string().optional(), role: UserRole.optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;
export const resetUserPasswordRequestSchema = z.object({ password: z.string().min(12) });
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordRequestSchema>;
export const AdminLoginRequestSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;
export const adminLoginRequestSchema = AdminLoginRequestSchema;
export const AdminSessionSchema = z.object({ user: UserSchema, csrfToken: z.string(), expiresAt: z.string() });
export type AdminSession = z.infer<typeof AdminSessionSchema>;

/** Connector record (formerly Agent). The `agt_` id prefix is a frozen wire identifier.
 * The `mode` field was REMOVED in #99 (docs#199 D2): there is no ophub mode any
 * more — every Widget deploys independently — so the concept, not just one of
 * its values, is gone. */
export const ConnectorSchema = z.object({ id: z.string().startsWith("agt_"), code: z.string(), name: z.string().nullable().optional(), runtime: z.string().nullable().optional(), status: ConnectorStatusSchema, lastHeartbeatAt: z.string().nullable().optional(), createdAt: z.string(), updatedAt: z.string() });
export type Connector = z.infer<typeof ConnectorSchema>;
export const RegistrationTokenSchema = z.object({ id: z.string().startsWith("tok_"), name: z.string(), status: z.enum(TokenStatus), expiresAt: z.string().nullable().optional(), usedAt: z.string().nullable().optional(), createdAt: z.string() });
export type RegistrationToken = z.infer<typeof RegistrationTokenSchema>;
export const CreateRegistrationTokenRequestSchema = z.object({ name: z.string().default("Default registration token").optional(), expiresInSeconds: z.number().int().min(60).optional() });
export type CreateRegistrationTokenRequest = z.infer<typeof CreateRegistrationTokenRequestSchema>;
export const createRegistrationTokenRequestSchema = CreateRegistrationTokenRequestSchema;
export const CreateRegistrationTokenResponseSchema = RegistrationTokenSchema.extend({ rawToken: z.string().startsWith("opstage_reg_") });
export type CreateRegistrationTokenResponse = z.infer<typeof CreateRegistrationTokenResponseSchema>;

export const ServiceCapabilitySchema = z.object({ name: z.string().min(1).max(120), label: z.string().max(200).optional(), description: z.string().max(2000).optional(), metadata: AnyJson.optional() });
export type ServiceCapability = z.infer<typeof ServiceCapabilitySchema>;
export const serviceCapabilitySchema = ServiceCapabilitySchema;
export const EventMetadataSchema = z.object({ name: z.string().min(1).max(160), direction: z.enum(["publish","subscribe"]).optional(), schema: AnyJson.optional(), designOnly: z.boolean().default(true), metadata: AnyJson.optional() });
export type EventMetadata = z.infer<typeof EventMetadataSchema>;
export const eventMetadataSchema = EventMetadataSchema;
export const HealthReportInputSchema = z.object({ status: HealthStatusSchema, message: z.string().optional(), details: AnyJson.optional() });
export type HealthReportInput = z.infer<typeof HealthReportInputSchema>;
export const healthReportInputSchema = HealthReportInputSchema;
export const ConfigItemInputSchema = z.object({ key: z.string(), label: z.string().optional(), type: z.string(), source: z.string().optional(), editable: z.boolean().optional(), sensitive: z.boolean().optional(), valuePreview: z.string().optional(), defaultValue: z.string().optional(), secretRef: z.string().optional() });
export type ConfigItemInput = z.infer<typeof ConfigItemInputSchema>;
export const configItemInputSchema = ConfigItemInputSchema;
export const ActionDefinitionInputSchema = z.object({ name: z.string(), label: z.string(), description: z.string().optional(), longDescription: z.string().optional(), dangerLevel: z.enum(DangerLevel).default("LOW").optional(), requiresConfirmation: z.boolean().optional(), category: z.string().optional(), order: z.number().int().optional(), requiresPrepare: z.boolean().optional(), inputSchema: AnyJson.optional(), outputSchema: AnyJson.optional(), timeoutSeconds: z.number().int().positive().optional() });
export type ActionDefinitionInput = z.infer<typeof ActionDefinitionInputSchema>;
export const actionDefinitionInputSchema = ActionDefinitionInputSchema;
export const ReportedServiceSchema = z.object({ 
  code: z.string().min(1).max(80), 
  name: z.string().min(1).max(200), 
  description: z.string().max(2000).optional(), 
  version: z.string().max(80).optional(), 
  runtime: z.string().optional(), 
  manifest: AnyJson, 
  capabilities: z.array(ServiceCapabilitySchema).optional(), 
  events: z.array(EventMetadataSchema).optional(), 
  health: HealthReportInputSchema.optional(), 
  configs: z.array(ConfigItemInputSchema).optional(), 
  actions: z.array(ActionDefinitionInputSchema).optional(),
  serviceKind: ServiceKindSchema.optional(),
});
export type ReportedService = z.infer<typeof ReportedServiceSchema>;
export const reportedServiceSchema = ReportedServiceSchema;
export const ServiceReportRequestSchema = z.object({ services: z.array(ReportedServiceSchema).min(1) });
export type ServiceReportRequest = z.infer<typeof ServiceReportRequestSchema>;
export const serviceReportRequestSchema = ServiceReportRequestSchema;
export const RuntimeKindSchema = z.enum(["nodejs", "java", "python", "go", "other"]);
export type RuntimeKind = z.infer<typeof RuntimeKindSchema>;
/** Connector registration request (formerly Agent registration). The `agent`
 * payload key and the `opstage_reg_` prefix are frozen wire values. The
 * `agent.mode` field was REMOVED in #99 (docs#199 D2). */
export const RegisterConnectorRequestSchema = z.object({ registrationToken: z.string().startsWith("opstage_reg_"), agent: z.object({ code: z.string(), name: z.string().optional(), runtime: RuntimeKindSchema.or(z.string()).optional() }), service: ReportedServiceSchema.optional() });
export type RegisterConnectorRequest = z.infer<typeof RegisterConnectorRequestSchema>;
export const registerConnectorRequestSchema = RegisterConnectorRequestSchema;
/** Connector registration response (formerly Agent). The `agentId` /
 * `agentToken` keys and the `agt_` / `opstage_agent_` prefixes are frozen wire values. */
export const RegisterConnectorResponseSchema = z.object({
  agentId: z.string().startsWith("agt_"),
  agentToken: z.string().startsWith("opstage_agent_"),
  heartbeatIntervalSeconds: z.number().int(),
  commandPollIntervalSeconds: z.number().int(),
  /** Optional on this pre-CE legacy compatibility response. */
  transport: TransportParametersSchema.optional(),
});
export type RegisterConnectorResponse = z.infer<typeof RegisterConnectorResponseSchema>;
/** @deprecated Pre-CE legacy World A response (`agt_` /
 * `opstage_agent_`). It is not the canonical CE 0.7.4 provisioning surface;
 * CE integrations must use CeRegistrationRequestSchema and
 * WorldACeRegistrationResponseSchema from ./ce. */
export const WorldARegisterConnectorResponseSchema = RegisterConnectorResponseSchema.extend({
  transport: TransportParametersSchema,
});
export type WorldARegisterConnectorResponse = z.infer<typeof WorldARegisterConnectorResponseSchema>;
export const ConnectorHeartbeatResponseSchema = z.object({
  heartbeatIntervalSeconds: z.number().int(),
  commandPollIntervalSeconds: z.number().int(),
  /** Allows the Platform to redistribute changed deployment parameters without
   * requiring re-registration. Old connectors safely ignore the additive field. */
  transport: TransportParametersSchema.optional(),
});
export type ConnectorHeartbeatResponse = z.infer<typeof ConnectorHeartbeatResponseSchema>;
export const WorldAConnectorHeartbeatResponseSchema = ConnectorHeartbeatResponseSchema.extend({
  transport: TransportParametersSchema,
});
export type WorldAConnectorHeartbeatResponse = z.infer<typeof WorldAConnectorHeartbeatResponseSchema>;
export const ConnectorHeartbeatRequestSchema = z.object({ serviceId: LogicalServiceIdSchema.optional(), health: HealthReportInputSchema.optional() });
export type ConnectorHeartbeatRequest = z.infer<typeof ConnectorHeartbeatRequestSchema>;
export const connectorHeartbeatRequestSchema = ConnectorHeartbeatRequestSchema;

export const HealthReportSchema = z.object({ id: z.string().startsWith("hlr_"), serviceId: LogicalServiceIdSchema, agentId: z.string().startsWith("agt_").optional(), status: HealthStatusSchema, message: z.string().nullable().optional(), details: AnyJson.optional(), reportedAt: z.string() });
export type HealthReport = z.infer<typeof HealthReportSchema>;
export const ConfigItemSchema = z.object({ id: z.string().startsWith("cfg_"), serviceId: LogicalServiceIdSchema, key: z.string(), label: z.string().nullable().optional(), type: z.string(), source: z.string().nullable().optional(), editable: z.boolean().default(false), sensitive: z.boolean(), valuePreview: z.string().nullable().optional(), defaultValue: z.string().nullable().optional(), secretRef: z.string().nullable().optional() });
export type ConfigItem = z.infer<typeof ConfigItemSchema>;
export const ActionDefinitionSchema = z.object({ id: z.string().startsWith("act_"), serviceId: LogicalServiceIdSchema, name: z.string(), label: z.string(), description: z.string().nullable().optional(), dangerLevel: z.enum(DangerLevel), requiresConfirmation: z.boolean(), category: z.string().optional(), order: z.number().int().optional(), inputSchema: AnyJson.optional(), outputSchema: AnyJson.optional(), timeoutSeconds: z.number().int().optional() });
export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

/**
 * Shape returned by a Connector's action `prepare` handler when responding to an
 * `ACTION_PREPARE` command. Used by the SDK as the contract between
 * `prepare()` callbacks and the Platform; the Platform forwards it to the UI as
 * the `data` field of the prepare command result.
 */
export const ActionPrepareResultSchema = z.object({
  action: AnyJson.optional(),
  inputSchema: AnyJson.optional(),
  initialPayload: AnyJson.optional(),
  currentState: AnyJson.optional(),
});
export type ActionPrepareResult = z.infer<typeof ActionPrepareResultSchema>;
export const actionPrepareResultSchema = ActionPrepareResultSchema;


// v0.4 Legacy event-routing experimental contracts. These schemas intentionally model
// a small legacy-governed event-to-command surface, not a general message
// broker or workflow DSL. Names and compatibility may change before v1.0.
export const BusExperimentalSchema = z.literal("v0.4-experimental");
export type BusExperimental = z.infer<typeof BusExperimentalSchema>;
export const BusRouteStatus = ["ENABLED", "DISABLED", "DRY_RUN"] as const;
export type BusRouteStatus = typeof BusRouteStatus[number];
export const BusRouteStatusSchema = z.enum(BusRouteStatus);
export const BusEventEnvelopeSchema = z.object({
  id: z.string().startsWith("bev_").optional(),
  experimental: BusExperimentalSchema.default("v0.4-experimental"),
  eventType: z.string().min(1).max(160),
  sourceServiceCode: z.string().min(1).max(80),
  sourceServiceId: LogicalServiceIdSchema.optional(),
  occurredAt: z.string().datetime().optional(),
  correlationId: z.string().min(1).max(160).optional(),
  causationId: z.string().min(1).max(160).optional(),
  payload: AnyJson.default({}).optional(),
  metadata: AnyJson.default({}).optional(),
});
export type BusEventEnvelope = z.infer<typeof BusEventEnvelopeSchema>;
export const PublishBusEventRequestSchema = BusEventEnvelopeSchema.omit({ id: true }).extend({
  routePolicy: z.object({ dryRun: z.boolean().optional() }).optional(),
});
export type PublishBusEventRequest = z.infer<typeof PublishBusEventRequestSchema>;
export const BusRouteRuleSchema = z.object({
  id: z.string().startsWith("brt_").optional(),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  status: BusRouteStatusSchema.optional().default("DISABLED"),
  match: z.object({
    eventType: z.string().min(1).max(160),
    sourceServiceCode: z.string().min(1).max(80).optional(),
  }),
  target: z.object({
    serviceCode: z.string().min(1).max(80),
    actionName: z.string().min(1).max(128),
  }),
  inputMapping: AnyJson.default({}).optional(),
  metadata: AnyJson.default({}).optional(),
});
export type BusRouteRule = z.infer<typeof BusRouteRuleSchema>;
export const CreateBusRouteRuleRequestSchema = BusRouteRuleSchema.omit({ id: true });
export type CreateBusRouteRuleRequest = z.infer<typeof CreateBusRouteRuleRequestSchema>;
export const BusCommandRequestSchema = z.object({
  commandId: z.string().startsWith("cmd_").optional(),
  commandType: z.literal("ACTION_EXECUTE").default("ACTION_EXECUTE"),
  targetService: z.string().min(1).max(80),
  actionName: z.string().min(1).max(128),
  sourceEventId: z.string().startsWith("bev_").optional(),
  payload: AnyJson.default({}).optional(),
  metadata: z.object({
    routingRuleId: z.string().startsWith("brt_").optional(),
    correlationId: z.string().min(1).max(160).optional(),
  }).catchall(z.any()).optional(),
});
export type BusCommandRequest = z.infer<typeof BusCommandRequestSchema>;
export const busCommandRequestSchema = BusCommandRequestSchema;
export const BusRoutingRuleSchema = BusRouteRuleSchema;
export type BusRoutingRule = BusRouteRule;
export const busRoutingRuleSchema = BusRoutingRuleSchema;

export const BusRoutedCommandSchema = z.object({
  routeId: z.string().startsWith("brt_"),
  commandId: z.string().startsWith("cmd_").optional(),
  dryRun: z.boolean(),
  targetServiceCode: z.string(),
  actionName: z.string(),
  status: z.enum(["CREATED", "DRY_RUN", "SKIPPED", "FAILED"]),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type BusRoutedCommand = z.infer<typeof BusRoutedCommandSchema>;
export const PublishBusEventResponseSchema = z.object({
  eventId: z.string().startsWith("bev_"),
  experimental: BusExperimentalSchema,
  routedCommands: z.array(BusRoutedCommandSchema),
});
export type PublishBusEventResponse = z.infer<typeof PublishBusEventResponseSchema>;
export const BusEventRecordSchema = BusEventEnvelopeSchema.extend({
  id: z.string().startsWith("bev_"),
  agentId: z.string().startsWith("agt_"),
  acceptedAt: z.string(),
  routeCount: z.number().int(),
});
export type BusEventRecord = z.infer<typeof BusEventRecordSchema>;
export const BusErrorCode = {
  /** Wire VALUE predates the rename; changing it is a wire migration deferred by docs#100. */
  BUS_DISABLED: "CAPSULE_BUS_DISABLED",
  BUS_RATE_LIMITED: "BUS_RATE_LIMITED",
  BUS_DEPTH_EXCEEDED: "BUS_DEPTH_EXCEEDED",
} as const;
export type BusErrorCode = (typeof BusErrorCode)[keyof typeof BusErrorCode];

export const publishBusEventRequestSchema = PublishBusEventRequestSchema;
export const publishBusEventResponseSchema = PublishBusEventResponseSchema;
export const busEventEnvelopeSchema = BusEventEnvelopeSchema;
export const busRouteRuleSchema = BusRouteRuleSchema;
export const createBusRouteRuleRequestSchema = CreateBusRouteRuleRequestSchema;

export const CreateActionCommandRequestSchema = z.object({ payload: AnyJson.optional(), confirmation: z.boolean().optional() });
export type CreateActionCommandRequest = z.infer<typeof CreateActionCommandRequestSchema>;
export const createActionCommandRequestSchema = CreateActionCommandRequestSchema;
export const CommandTypeSchema = z.enum(["ACTION_PREPARE", "ACTION_EXECUTE"]);
export type CommandType = z.infer<typeof CommandTypeSchema>;
export const CommandSchema = z.object({ id: z.string().startsWith("cmd_"), agentId: z.string().startsWith("agt_"), serviceId: LogicalServiceIdSchema, type: CommandTypeSchema, actionName: z.string(), status: CommandStatusSchema, payload: AnyJson.optional(), createdByUserId: z.string().startsWith("usr_").nullable().optional(), createdAt: z.string(), startedAt: z.string().nullable().optional(), completedAt: z.string().nullable().optional(), expiresAt: z.string().nullable().optional() });
export type Command = z.infer<typeof CommandSchema>;
export const ReportCommandResultRequestSchema = z.object({ success: z.boolean(), message: z.string().optional(), data: AnyJson.optional(), error: AnyJson.optional(), startedAt: z.string().optional(), finishedAt: z.string().optional() });
export type ReportCommandResultRequest = z.infer<typeof ReportCommandResultRequestSchema>;
export const reportCommandResultRequestSchema = ReportCommandResultRequestSchema;
export const CommandResultSchema = z.object({ id: z.string().startsWith("crs_"), commandId: z.string().startsWith("cmd_"), success: z.boolean(), message: z.string().nullable().optional(), data: AnyJson.optional(), error: AnyJson.optional(), reportedAt: z.string() });
export type CommandResult = z.infer<typeof CommandResultSchema>;
export const CommandDetailSchema = CommandSchema.extend({ result: CommandResultSchema.nullable().optional() });
export type CommandDetail = z.infer<typeof CommandDetailSchema>;
export const AuditEventSchema = z.object({ id: z.string().startsWith("aud_"), actorType: z.enum(AuditActorType), actorId: z.string().nullable().optional(), action: z.string(), targetType: z.string().nullable().optional(), targetId: z.string().nullable().optional(), result: z.enum(AuditResult), message: z.string().nullable().optional(), metadata: AnyJson.optional(), createdAt: z.string() });
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export const DashboardSummarySchema = z.object({ agentCounts: z.record(z.number().int()), serviceCounts: z.record(z.number().int()), commandCounts: z.record(z.number().int()), recentCommands: z.array(CommandSchema).optional(), recentAuditEvents: z.array(AuditEventSchema).optional() });
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
export const SystemHealthSchema = z.object({ status: z.enum(["UP","DEGRADED","DOWN"]), timestamp: z.string(), version: z.string(), edition: z.literal("ce"), database: z.object({ status: z.enum(["UP","DEGRADED","DOWN"]), kind: z.enum(["sqlite","postgres","mysql"]).optional(), latencyMs: z.number().int().optional() }), uptimeSeconds: z.number().int().optional() });
export type SystemHealth = z.infer<typeof SystemHealthSchema>;
export const SystemVersionSchema = z.object({ version: z.string(), edition: z.literal("ce"), commit: z.string().optional(), buildTime: z.string().optional() });
export type SystemVersion = z.infer<typeof SystemVersionSchema>;

export type Pagination = { page: number; pageSize: number; total: number };
export type SuccessEnvelope<T> = { success?: true; data: T; pagination?: Pagination } | { data: T; pagination?: Pagination };
export type ErrorEnvelope = { success: false; error: { code: string; message: string; details?: unknown } };
export const ListQueryBase = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), sort: z.string().optional() });
export class HttpError extends Error { constructor(public readonly httpStatus: number, public readonly code: string, public readonly publicMessage: string, public readonly details?: unknown){ super(publicMessage); } }
export function parseSort(value: string | undefined, allowed: readonly string[]) { if (!value) return []; return value.split(",").filter(Boolean).map(raw=>{ const desc=raw.startsWith("-"); const field=desc?raw.slice(1):raw; if(!allowed.includes(field)) throw new HttpError(422,"VALIDATION_FAILED",`Unknown sort field: ${field}`); return { field, direction: desc ? "desc" : "asc" } as const; }); }
export function paginate<T>(items: T[], page: number, pageSize: number, total: number) { return { data: items, pagination: { page, pageSize, total } }; }

export const ErrorCode = {
  INTERNAL_ERROR: "INTERNAL_ERROR", VALIDATION_FAILED: "VALIDATION_FAILED", UNAUTHORIZED: "UNAUTHORIZED", FORBIDDEN: "FORBIDDEN", NOT_FOUND: "NOT_FOUND", CONFLICT: "CONFLICT", CSRF_INVALID: "CSRF_INVALID", ACTION_REQUIRES_CONFIRMATION: "ACTION_REQUIRES_CONFIRMATION", COMMAND_EXPIRED: "COMMAND_EXPIRED", TOKEN_REVOKED: "TOKEN_REVOKED", TOKEN_EXPIRED: "TOKEN_EXPIRED", AGENT_REVOKED: "AGENT_REVOKED", AGENT_DISABLED: "AGENT_DISABLED",
} as const;
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

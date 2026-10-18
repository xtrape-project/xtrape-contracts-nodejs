import { describe, expect, it } from "vitest";
import {
  COMMAND_ORIGIN_FEATURE,
  COMMAND_ORIGIN_HEADER,
  CommandDispatchRequestSchema,
  CommandOriginSchema,
  DeliveredCommandSchema,
  ServiceManifestSchema,
} from "../src/index";
import delivery_with_origin from "../spec/ce/transport/delivery-command-with-origin.valid.json";
import delivery_bad_origin from "../spec/ce/transport/delivery-command-origin-unknown-field.invalid.json";

/**
 * Command origin (xtrape-docs runtime-platform/12, #256): the authenticated
 * Account context a delivered command was issued under. Consumers:
 * platform-ce (fills, at delivery, gated on the Worker's feature bit) and
 * the Connector SDK (exposes on the execute/prepare context).
 */
describe("command origin (contracts for xtrape-docs#256)", () => {
  it("is a strict object of exactly { account?, traceId? } — no class field, no PrincipalType, nothing else", () => {
    expect(CommandOriginSchema.parse({ account: "part_1", traceId: "tr_1" })).toEqual({ account: "part_1", traceId: "tr_1" });
    expect(CommandOriginSchema.parse({})).toEqual({}); // "unknown" is the empty context
    expect(CommandOriginSchema.parse({ traceId: "tr_1" })).toEqual({ traceId: "tr_1" }); // Account unmapped, trace still useful
    // An Account class is NOT part of this wire (12-command-origin §0/§9):
    // neither the canonical PrincipalType (an Originator vocabulary) nor a
    // home-grown human/ai one. Strict, so a producer cannot smuggle it in.
    expect(CommandOriginSchema.safeParse({ accountKind: "USER", account: "part_1" }).success).toBe(false);
    expect(CommandOriginSchema.safeParse({ kind: "human", account: "part_1" }).success).toBe(false);
    expect(CommandOriginSchema.safeParse({ principalType: "AGENT", account: "part_1" }).success).toBe(false);
    expect(CommandOriginSchema.safeParse({ account: "" }).success).toBe(false); // empty is not an account
    expect(CommandOriginSchema.safeParse({ account: 42 }).success).toBe(false);
  });

  it("rides the DELIVERED command as an optional field", () => {
    const base = { operation: "EXECUTE", commandId: "cmd_1", actionName: "addTask", issuedAt: "2026-08-17T00:00:00.000Z" };
    expect(DeliveredCommandSchema.parse(base)).toMatchObject({ commandId: "cmd_1" });
    const withOrigin = DeliveredCommandSchema.parse({ ...base, origin: { account: "part_agent" } });
    expect(withOrigin).toMatchObject({ origin: { account: "part_agent" } });
    // Malformed origin fails the delivery loud rather than being dropped.
    expect(DeliveredCommandSchema.safeParse({ ...base, origin: { kind: "human" } }).success).toBe(false);
    // Frozen fixtures, so the spec dir documents the wire alongside the schema.
    expect(DeliveredCommandSchema.parse(delivery_with_origin)).toMatchObject({ origin: { account: "part_agent_1", traceId: "tr_1" } });
    expect(DeliveredCommandSchema.safeParse(delivery_bad_origin).success).toBe(false);
  });

  it("is NEVER accepted on the dispatch request — the caller does not get to say who it is", () => {
    const ok = CommandDispatchRequestSchema.parse({ contractVersion: 1, input: { x: 1 } });
    expect(ok.input).toEqual({ x: 1 });
    expect(CommandDispatchRequestSchema.safeParse({ contractVersion: 1, origin: { account: "part_1" } }).success).toBe(false);
  });

  it("names the manifest feature bit a Worker declares to receive it, and the World B header carrier", () => {
    expect(COMMAND_ORIGIN_FEATURE).toBe("commandOrigin");
    expect(COMMAND_ORIGIN_HEADER).toBe("x-xtrape-command-origin");
    const manifest = ServiceManifestSchema.parse({
      contractVersion: 1,
      service: { id: "demo-widget", name: "Demo", version: "1.0.0" },
      runtime: { language: "nodejs", agent: "@xtrape/connector" },
      capabilities: ["demo"],
      message: { supportedTypes: ["QUERY"] },
      features: { [COMMAND_ORIGIN_FEATURE]: true },
    });
    expect(manifest.features?.[COMMAND_ORIGIN_FEATURE]).toBe(true);
  });
});

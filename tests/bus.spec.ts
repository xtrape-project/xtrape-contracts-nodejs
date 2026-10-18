import { describe, expect, it } from "vitest";
import {
  BusEventEnvelopeSchema,
  CreateBusRouteRuleRequestSchema,
  PublishBusEventResponseSchema,
  BusCommandRequestSchema,
  BusRoutingRuleSchema,
  BusErrorCode,
} from "../src/index";

describe("v0.4 experimental legacy Bus contracts", () => {
  it("validates a minimal event envelope", () => {
    const parsed = BusEventEnvelopeSchema.parse({
      eventType: "demo.item.created",
      sourceServiceCode: "demo-worker",
      payload: { itemId: "item_1" },
    });
    expect(parsed.experimental).toBe("v0.4-experimental");
  });

  it("validates an event-to-command route rule", () => {
    const parsed = CreateBusRouteRuleRequestSchema.parse({
      name: "Notify on item creation",
      status: "DRY_RUN",
      match: { eventType: "demo.item.created", sourceServiceCode: "demo-worker" },
      target: { serviceCode: "demo-notifier", actionName: "notify" },
    });
    expect(parsed.status).toBe("DRY_RUN");
  });

  it("rejects non-experimental event envelopes", () => {
    expect(() => BusEventEnvelopeSchema.parse({
      experimental: "stable",
      eventType: "demo.item.created",
      sourceServiceCode: "demo-worker",
    })).toThrow();
  });

  it("validates command requests linked to source events", () => {
    const parsed = BusCommandRequestSchema.parse({
      targetService: "demo-notifier",
      actionName: "notify",
      sourceEventId: "bev_123",
      payload: { itemId: "item-1" },
      metadata: { routingRuleId: "brt_123", correlationId: "corr-1" },
    });
    expect(parsed.commandType).toBe("ACTION_EXECUTE");
  });

  it("keeps the implementation-plan BusRoutingRule alias", () => {
    expect(BusRoutingRuleSchema.parse({
      name: "Alias route",
      match: { eventType: "demo.item.created" },
      target: { serviceCode: "demo-worker", actionName: "notify" },
    }).status).toBe("DISABLED");
  });

  // Moved here from the deleted tests/worker-compatibility.spec.ts (#99): the
  // Bus error VALUE survives the legacy Worker face removal and still needs a pin.
  it("pins the legacy Bus wire error-code VALUE behind its canonical property name (docs#100)", () => {
    expect(BusErrorCode.BUS_DISABLED).toBe("CAPSULE_BUS_DISABLED");
  });

  it("validates routed command responses", () => {
    expect(PublishBusEventResponseSchema.parse({
      eventId: "bev_123",
      experimental: "v0.4-experimental",
      routedCommands: [{ routeId: "brt_123", commandId: "cmd_123", dryRun: false, targetServiceCode: "svc", actionName: "notify", status: "CREATED" }],
    }).routedCommands).toHaveLength(1);
  });
});

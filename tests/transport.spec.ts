import { describe, expect, it } from "vitest";
import {
  AckDeliveriesExchangeSchema,
  AckDeliveriesRequestSchema,
  AckDeliveriesResponseSchema,
  ConnectorHeartbeatResponseSchema,
  CE_REGISTRATION_TOKEN_HEADER,
  CeErrorCode,
  CeRegistrationRequestSchema,
  CeRegistrationResponseSchema,
  CommandPollResponseSchema,
  DeliveredCommandOperation,
  DeliveryKind,
  RegisterConnectorResponseSchema,
  TransportMode,
  TransportParametersSchema,
  WORLD_A_CE_REGISTRATION_PATH,
  WorldAConnectorHeartbeatResponseSchema,
  WorldACeRegistrationHeadersSchema,
  WorldACeRegistrationResponseSchema,
  WorldARegisterConnectorResponseSchema,
} from "../src/index";

// The exact shipped conformance fixtures — platform-ce, connector-nodejs and
// Demo validate the same bytes and the same rejections.
import tp_valid from "../spec/ce/transport/transport-parameters.valid.json";
import tp_excess from "../spec/ce/transport/transport-parameters-excess-wait.invalid.json";
import tp_mode from "../spec/ce/transport/transport-parameters-unknown-mode.invalid.json";
import tp_no_batch from "../spec/ce/transport/transport-parameters-missing-max-batch.invalid.json";
import register_worlda from "../spec/ce/transport/register-response-worlda.valid.json";
import register_no_transport from "../spec/ce/transport/register-response-worlda-missing-transport.invalid.json";
import ce_register_request from "../spec/ce/transport/ce-registration-request.valid.json";
import ce_register_mismatch from "../spec/ce/transport/ce-registration-request-service-mismatch.invalid.json";
import ce_register_worlda from "../spec/ce/transport/ce-registration-response-worlda.valid.json";
import ce_register_callback from "../spec/ce/transport/ce-registration-response-callback-token.valid.json";
import ce_register_no_transport from "../spec/ce/transport/ce-registration-response-worlda-missing-transport.invalid.json";
import poll_mixed from "../spec/ce/transport/poll-response-mixed.valid.json";
import poll_redelivery from "../spec/ce/transport/poll-response-redelivery.valid.json";
import poll_empty from "../spec/ce/transport/poll-response-empty-deliveries.invalid.json";
import poll_duplicate_delivery from "../spec/ce/transport/poll-response-duplicate-delivery-id.invalid.json";
import dlv_unknown_kind from "../spec/ce/transport/delivery-unknown-kind.invalid.json";
import dlv_unknown_operation from "../spec/ce/transport/delivery-command-unknown-operation.invalid.json";
import dlv_no_timeout from "../spec/ce/transport/delivery-command-without-timeout.valid.json";
import ack_req from "../spec/ce/transport/ack-request.valid.json";
import ack_req_empty from "../spec/ce/transport/ack-request-empty.invalid.json";
import ack_req_duplicate from "../spec/ce/transport/ack-request-duplicate.invalid.json";
import ack_res from "../spec/ce/transport/ack-response.valid.json";
import ack_res_overlap from "../spec/ce/transport/ack-response-overlap.invalid.json";
import ack_exchange from "../spec/ce/transport/ack-exchange.valid.json";
import ack_exchange_missing from "../spec/ce/transport/ack-exchange-missing-id.invalid.json";
import ack_exchange_foreign from "../spec/ce/transport/ack-exchange-foreign-id.invalid.json";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe("World A long-poll transport (contracts#48, 0.7.4)", () => {
  it("ships exactly one mode and requires concrete Platform-owned parameters", () => {
    expect([...TransportMode]).toEqual(["LONG_POLL"]);
    const tp = TransportParametersSchema.parse(tp_valid);
    expect(tp).toMatchObject({ mode: "LONG_POLL", waitMs: 25_000, maxBatch: 16 });
    expect(ok(TransportParametersSchema, tp_excess)).toBe(false);
    expect(ok(TransportParametersSchema, tp_mode)).toBe(false);
    expect(ok(TransportParametersSchema, tp_no_batch)).toBe(false);
    expect(CeErrorCode.TRANSPORT_MODE_UNSUPPORTED).toBe("TRANSPORT_MODE_UNSUPPORTED");
  });

  it("keeps legacy Opstage provisioning compatible without making it CE authority", () => {
    expect(ok(RegisterConnectorResponseSchema, register_no_transport)).toBe(true);
    expect(ok(ConnectorHeartbeatResponseSchema, {
      heartbeatIntervalSeconds: 30,
      commandPollIntervalSeconds: 1,
    })).toBe(true);

    const registered = WorldARegisterConnectorResponseSchema.parse(register_worlda);
    expect(registered.transport).toEqual(tp_valid);
    expect(ok(WorldARegisterConnectorResponseSchema, register_no_transport)).toBe(false);
    expect(ok(WorldAConnectorHeartbeatResponseSchema, {
      heartbeatIntervalSeconds: 30,
      commandPollIntervalSeconds: 1,
      transport: tp_valid,
    })).toBe(true);
  });

  it("carries execute, review, cancel and message deliveries on one stream", () => {
    expect([...DeliveredCommandOperation]).toEqual(["EXECUTE", "REVIEW"]);
    expect([...DeliveryKind]).toEqual(["COMMAND", "CANCEL", "MESSAGE"]);
    const poll = CommandPollResponseSchema.parse(poll_mixed);
    expect(poll.deliveries).toHaveLength(4);
    const [execute, prepare, cancel, message] = poll.deliveries;
    expect(execute).toMatchObject({
      kind: "COMMAND",
      deliveryId: "dlv_001",
      command: { operation: "EXECUTE", commandId: "cmd_abc", timeoutSeconds: 300 },
    });
    expect(prepare).toMatchObject({
      kind: "COMMAND",
      command: { operation: "REVIEW", commandId: "cmd_prepare", timeoutSeconds: 30 },
    });
    expect(cancel).toMatchObject({
      kind: "CANCEL",
      cancellation: { cancelId: "cancel_abc", commandId: "cmd_abc" },
    });
    expect(message).toMatchObject({
      kind: "MESSAGE",
      message: { messageId: "msg_001", contractVersion: 1 },
    });
  });

  it("redelivers the same logical command with a new delivery id and incremented attempt", () => {
    const poll = CommandPollResponseSchema.parse(poll_redelivery);
    const delivery = poll.deliveries[0];
    expect(delivery).toMatchObject({ attempt: 2 });
    if (delivery.kind !== "COMMAND") throw new Error("expected COMMAND delivery");
    expect(delivery.command.commandId).toBe("cmd_abc");
    expect(delivery.command.operation).toBe("EXECUTE");
    expect(delivery.deliveryId).not.toBe("dlv_001");
  });

  it("freezes 204/no-body as the only empty-poll representation", () => {
    expect(ok(CommandPollResponseSchema, poll_empty)).toBe(false);
  });

  it("rejects unknown kinds/operations and duplicate batch ack keys; accepts an omitted duration", () => {
    expect(ok(CommandPollResponseSchema, dlv_unknown_kind)).toBe(false);
    expect(ok(CommandPollResponseSchema, dlv_unknown_operation)).toBe(false);
    // timeoutSeconds is DISCLOSURE, not a budget (xtrape-docs#242,
    // contracts#14): a delivery that discloses no duration is valid. This is
    // the deliberate one-time break with pre-#14 consumers, whose strict
    // parse required the field (decision 2026-08-09).
    expect(ok(CommandPollResponseSchema, dlv_no_timeout)).toBe(true);
    expect(CommandPollResponseSchema.parse(dlv_no_timeout).deliveries[0]).toMatchObject({ kind: "COMMAND" });
    expect(ok(CommandPollResponseSchema, poll_duplicate_delivery)).toBe(false);
  });

  it("freezes each ack response as an exact partition of the request ids", () => {
    expect(AckDeliveriesRequestSchema.parse(ack_req).deliveryIds).toEqual(["dlv_001", "dlv_002"]);
    expect(ok(AckDeliveriesRequestSchema, ack_req_empty)).toBe(false);
    expect(ok(AckDeliveriesRequestSchema, ack_req_duplicate)).toBe(false);

    const res = AckDeliveriesResponseSchema.parse(ack_res);
    expect(res.acked).toEqual(["dlv_001"]);
    expect(res.unknown).toEqual(["dlv_002"]);
    expect(ok(AckDeliveriesResponseSchema, ack_res_overlap)).toBe(false);

    expect(AckDeliveriesExchangeSchema.parse(ack_exchange).response).toEqual(res);
    expect(ok(AckDeliveriesExchangeSchema, ack_exchange_missing)).toBe(false);
    expect(ok(AckDeliveriesExchangeSchema, ack_exchange_foreign)).toBe(false);
  });
});

describe("canonical CE World A provisioning surface", () => {
  it("freezes endpoint, auth header and strict manifest+instance request", () => {
    expect(WORLD_A_CE_REGISTRATION_PATH).toBe("/v1/instances");
    expect(CE_REGISTRATION_TOKEN_HEADER).toBe("x-xtrape-registration-token");
    expect(WorldACeRegistrationHeadersSchema.parse({
      [CE_REGISTRATION_TOKEN_HEADER]: "xtrape_reg_example",
    })[CE_REGISTRATION_TOKEN_HEADER]).toBe("xtrape_reg_example");
    expect(ok(WorldACeRegistrationHeadersSchema, {})).toBe(false);
    expect(ok(WorldACeRegistrationHeadersSchema, {
      [CE_REGISTRATION_TOKEN_HEADER]: "xtrape_reg_example",
      "content-type": "application/json",
    })).toBe(true);

    const request = CeRegistrationRequestSchema.parse(ce_register_request);
    expect(request.instance.serviceId).toBe(request.manifest.service.id);
    expect(request.instance.tenant).toBe(request.manifest.tenant);
    expect(ok(CeRegistrationRequestSchema, ce_register_mismatch)).toBe(false);
    expect(ok(CeRegistrationRequestSchema, { ...ce_register_request, unexpected: true })).toBe(false);
    expect(ok(CeRegistrationRequestSchema, {
      ...ce_register_request,
      instance: { ...ce_register_request.instance, tenant: "acme" },
    })).toBe(false);
  });

  it("requires transport on the canonical World A CE response while preserving compatibility", () => {
    expect(WorldACeRegistrationResponseSchema.parse(ce_register_worlda).transport).toMatchObject({
      mode: "LONG_POLL",
      waitMs: 25_000,
      maxBatch: 16,
    });
    expect(ok(WorldACeRegistrationResponseSchema, ce_register_no_transport)).toBe(false);
    expect(CeRegistrationResponseSchema.parse(ce_register_no_transport)).toMatchObject({
      instanceId: "demo-echo-7f3a",
    });
  });

  it("negotiates adoption: the Connector DECLARES support in the registration request", () => {
    // Review #82: a Platform must not present the derived token to a Connector
    // that did not declare adoption — an older Connector still enforces its
    // static secret and every dial would 401. The declaration rides the
    // instance body; older Platforms (lenient schema) strip the unknown key,
    // so a new Connector registering against an old Platform degrades to old
    // behavior.
    const declared = CeRegistrationRequestSchema.parse({
      ...ce_register_request,
      instance: { ...ce_register_request.instance, supportsCallbackToken: true },
    });
    expect(declared.instance.supportsCallbackToken).toBe(true);
    expect(CeRegistrationRequestSchema.parse(ce_register_request).instance.supportsCallbackToken).toBeUndefined();
  });

  it("carries a per-instance callback token, and stays valid without one", () => {
    // The credential the Platform presents when it dials the instance back. It
    // is per-instance so that no single secret lets one service impersonate one
    // Platform to another; absent means the Platform has not adopted minting.
    expect(WorldACeRegistrationResponseSchema.parse(ce_register_callback).callbackToken).toBe(
      "xtrape_cb_e2e_example",
    );
    expect(CeRegistrationResponseSchema.parse(ce_register_worlda).callbackToken).toBeUndefined();
    // Empty string is not "no token" — it is a malformed credential.
    expect(ok(CeRegistrationResponseSchema, { ...ce_register_callback, callbackToken: "" })).toBe(false);
  });
});

# CE v0.1 Error Codes

- Status: Implementation Contract
- Edition: CE
- Priority: Current
- Audience: backend developers, frontend developers, agent SDK developers, AI coding agents

> **This file is rendered from `09-contracts/errors.json` by `09-contracts/tools/render-errors.ts`.**
> Edit `errors.json` (the SSOT). CI verifies this file is byte-for-byte equal to the rendered output.
> See ADR 0009 — Contracts Spec and Bindings.

This document enumerates the CE v0.1 error codes. Backend, UI, and Agent SDK MUST use only the codes listed here. New codes require a contract update (edit `errors.json`, regenerate this file).

---

## 1. Error Envelope

All error responses use the OpenAPI `ErrorEnvelope` shape:

```json
{
  "success": false,
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "Agent not found.",
    "details": {}
  }
}
```

Rules:

- `code` MUST be one of the codes in this document. Codes are stable, uppercase, snake-case strings.
- `message` is a human-readable English summary. UI MAY translate it locally.
- `details` is optional and structured. Sensitive values must be redacted before being placed in `details`.
- HTTP status codes are listed alongside each code; Backend MUST use the listed status.

---

## 2. Generic Codes

| Code                  | HTTP | Meaning                                                              |
|-----------------------|------|----------------------------------------------------------------------|
| `VALIDATION_FAILED`   | 422  | Request body or query parameters failed Zod validation.              |
| `UNAUTHORIZED`        | 401  | No valid session or token.                                           |
| `FORBIDDEN`           | 403  | Authenticated but not allowed (includes CSRF token mismatch).        |
| `NOT_FOUND`           | 404  | Requested resource does not exist or is not visible to the caller.   |
| `CONFLICT`            | 409  | State conflict (duplicate resource, idempotency violation).          |
| `RATE_LIMITED`        | 429  | Reserved for future EE/Cloud editions.                               |
| `INTERNAL_ERROR`      | 500  | Unexpected server error. Use sparingly; prefer specific codes.       |
| `SERVICE_UNAVAILABLE` | 503  | Backend cannot reach a critical dependency (e.g. database).          |

---

## 3. Authentication Codes

| Code                       | HTTP | Meaning                                                            |
|----------------------------|------|--------------------------------------------------------------------|
| `LOGIN_FAILED`             | 401  | Username or password invalid (do not reveal which).                |
| `SESSION_EXPIRED`          | 401  | Session cookie present but expired.                                |
| `SESSION_INVALID`          | 401  | Session cookie tampered with or session not found.                 |
| `CSRF_TOKEN_MISMATCH`      | 403  | `X-CSRF-Token` header missing or does not match server-side session token. |

---

## 4. Token Codes

| Code                                | HTTP | Meaning                                                      |
|-------------------------------------|------|--------------------------------------------------------------|
| `REGISTRATION_TOKEN_INVALID`        | 401  | Token does not exist or hash does not match.                 |
| `REGISTRATION_TOKEN_EXPIRED`        | 401  | Token past `expiresAt`.                                      |
| `REGISTRATION_TOKEN_USED`           | 409  | Token already consumed.                                      |
| `REGISTRATION_TOKEN_REVOKED`        | 401  | Token revoked by admin.                                      |
| `AGENT_TOKEN_INVALID`               | 401  | `Authorization: Bearer` header missing or hash mismatch.     |
| `AGENT_TOKEN_REVOKED`               | 401  | Agent token has been revoked.                                |
| `AGENT_TOKEN_EXPIRED`               | 401  | Agent token past `expiresAt`.                                |

---

## 5. Agent Codes

| Code                          | HTTP | Meaning                                                          |
|-------------------------------|------|------------------------------------------------------------------|
| `AGENT_NOT_FOUND`             | 404  | `agentId` does not exist.                                        |
| `AGENT_DISABLED`              | 403  | Agent is `DISABLED`.                                             |
| `AGENT_REVOKED`               | 403  | Agent is `REVOKED`.                                              |
| `AGENT_CODE_TAKEN`            | 409  | An Agent with this `code` already exists in the workspace.       |
| `AGENT_ID_MISMATCH`           | 403  | Path `agentId` does not match the Agent that owns the token.     |

---

## 6. Worker compatibility codes

| Code                              | HTTP | Meaning                                                       |
|-----------------------------------|------|---------------------------------------------------------------|
| `CAPSULE_SERVICE_NOT_FOUND`       | 404  | `serviceId` does not exist.                                   |
| `CAPSULE_SERVICE_NOT_OWNED`       | 403  | Service exists but does not belong to the calling Agent.      |
| `CAPSULE_SERVICE_MANIFEST_INVALID`| 422  | Manifest validation failed (missing required fields, etc.).   |
| `CAPSULE_SERVICE_CODE_TAKEN`      | 409  | Service code conflict in workspace.                           |

---

## 7. Action and Command Codes

| Code                              | HTTP | Meaning                                                          |
|-----------------------------------|------|------------------------------------------------------------------|
| `ACTION_NOT_FOUND`                | 404  | Action name not declared on the service manifest.                |
| `ACTION_DISABLED`                 | 403  | `ActionDefinition.enabled = false`.                              |
| `ACTION_PAYLOAD_INVALID`          | 422  | Payload failed `inputSchema` validation.                         |
| `ACTION_REQUIRES_CONFIRMATION`    | 422  | Confirmation flag missing for an action with `requiresConfirmation = true`. |
| `COMMAND_NOT_FOUND`               | 404  | `commandId` does not exist.                                      |
| `COMMAND_NOT_OWNED`               | 403  | Command exists but is not assigned to the calling Agent.         |
| `COMMAND_ALREADY_TERMINAL`        | 409  | Result reported for a Command already in a terminal state.       |
| `COMMAND_EXPIRED`                 | 410  | Command past `expiresAt` and cannot be reported.                 |
| `COMMAND_INVALID_TRANSITION`      | 409  | Attempted a CommandStatus transition that is not allowed.        |

---

## 8. Config Codes (read-only in CE v0.1)

| Code                       | HTTP | Meaning                                                           |
|----------------------------|------|-------------------------------------------------------------------|
| `CONFIG_ITEM_NOT_FOUND`    | 404  | Config key does not exist for the service.                        |
| `CONFIG_EDIT_NOT_SUPPORTED`| 405  | CE v0.1 does not support config editing — reserved for EE/Cloud.  |

---

## 9. System Codes

| Code                  | HTTP | Meaning                                                                |
|-----------------------|------|------------------------------------------------------------------------|
| `DATABASE_UNAVAILABLE`| 503  | Backend cannot reach SQLite database.                                  |
| `BOOTSTRAP_FAILED`    | 500  | Required environment variable missing — surfaced only via startup logs.|

---

## 10. Reserved Future Codes

The following codes are reserved for EE/Cloud and MUST NOT be emitted by CE v0.1:

```text
TENANT_NOT_FOUND
ORGANIZATION_NOT_FOUND
SUBSCRIPTION_REQUIRED
PERMISSION_DENIED
ROLE_NOT_FOUND
SECRET_NOT_FOUND
LICENSE_INVALID
```

---

## 11. Mapping to AuditEvent

When Backend emits an error response that should also produce an AuditEvent (e.g. `AGENT_TOKEN_INVALID`, `CSRF_TOKEN_MISMATCH`), it writes:

```json
{
  "result": "FAILURE",
  "metadata": {
    "errorCode": "<one of the codes above>"
  }
}
```

This keeps the audit log queryable by error code without proliferating AuditResult enum values.

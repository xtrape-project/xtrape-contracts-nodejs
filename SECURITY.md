# Security Policy

`@xtrape/contracts` is the canonical package for validation schemas and protocol types. Security issues here can affect Xtrape Panel CE validation, Connector SDK behavior, and third-party Worker integrations. The historical package name `@xtrape/capsule-contracts-node` is retained only as a compatibility identifier during migration.

## Reporting a vulnerability

Report suspected vulnerabilities **privately** — never in a public issue, and
never with exploit details, credentials, tokens, or secret-bearing logs. Redact
secrets, personal data, and internal addresses from any report.

Channels, in order (the canonical policy's order):

1. **`security@xtrape.com`** — the project security role address and the
   primary channel.
2. The **private vulnerability-reporting mechanism of the public repository
   host** for the affected repository, when the host offers one and it is
   enabled. The canonical public source of every Xtrape component is the
   `xtrape-project` organisation on `forgejo.xtrape.com`; mirrors on other
   platforms are copies, not intake points.

If neither is available, open only a minimal public request for a private
contact — with no exploit details.

Operational targets (not SLAs): acknowledgement within 3 business days,
initial triage and severity assessment within 7 calendar days. Coordinated
disclosure is preferred, with a stated safe-harbor intent for good-faith
research.

The canonical policy (channels of record, scope, response targets,
coordinated disclosure, and safe-harbor intent) is published with the Xtrape
concept baseline: <https://xtrape.com/governance> and
<https://forgejo.xtrape.com/xtrape-project/xtrape-site/src/branch/main/SECURITY.md>.

## Schema safety guidance

- Avoid weakening validation for externally supplied protocol payloads.
- Keep enum values explicit and documented.
- Treat error messages as public/operator-facing.
- Do not add examples containing real tokens, passwords, API keys, cookies, account emails, or private URLs.
- Coordinate breaking protocol changes with CE, Connector SDK, and docs updates.

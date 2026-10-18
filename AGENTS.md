# AGENTS.md

## Repository Role

This repository owns the TypeScript/Zod wire contracts for Xtrape.

`Capsule` names in existing exports, API fields, and IDs are legacy
compatibility identifiers. `agt_` / `opstage_agent_` prefixes, the `agent`
payload key and the `AGENT_*` error codes are wire-frozen credential-heritage
BYTES — but the `Agent*` EXPORTS themselves were deleted in #99 (docs#199 D11);
use the `Connector*` primaries. New conceptual names use Worker, Connector,
Panel, Package, Service, Platform, and Exposure as defined by `xtrape-docs`.
"Agent" is no longer a top-level concept, and Gateway is retired.

Since #99, **Worker** is the canonical runtime entity (docs#199 D10/D13):
`WorkerSchema` / `Worker` in `src/ce.ts` is the thing that registers, formerly
named `ServiceInstance`. The unrelated pre-CE legacy `Worker*` face was deleted
in the same change. One exception is absolute: `PrincipalType."AGENT"` in
`src/checkpoint.ts` is the autonomous AI originator (arch/16 §3, conformance
family A11 "never renamed") and must never be swept up by an agent rename.

It defines the shared protocol surface used by Xtrape Platform CE (physical
package `xtrape-platform-ce`), the Connector SDK (`@xtrape/connector`,
formerly `@xtrape/agent`), Panel CE, Worker integrations, and documentation.

Since 0.8.5, `src/checkpoint.ts` (named `src/exposure.ts` before the #112
rename; xtrape-docs#259 gives bare "Exposure" to the projection layer) is the
Checkpoint contract surface of the Controlled Exposure design
(`CHECKPOINT_CONTRACT_VERSION = 1`, strict/closed v1): Checkpoint and Resource
identity, Account Token claims, managed access Session state,
authorization-decision shapes, and the §10 durable workflow objects. Canonical
design:
`xtrape-docs/docs/architecture/16-controlled-exposure-and-invocation-authorization.md`.

Primary responsibilities:

- Zod schemas
- TypeScript types
- protocol constants
- validation helpers
- compatibility notes
- wire-level request/response shapes

This repository should stay small, stable, and runtime-neutral.

## Non-goals

Do not add runtime behavior here.

Specifically, do not add:

- ID factories such as `newId()`
- random ID generation dependencies such as `nanoid`
- HTTP clients
- polling loops
- Xtrape Panel business logic
- Connector SDK lifecycle logic
- Connector or local-adapter runtime logic
- database logic
- filesystem token stores
- UI helpers
- demo-only behavior

Contracts define what crosses the wire. They should not decide how a process runs.

## Architecture Boundaries

Allowed:

```text
schemas
types
constants
validation helpers
compatibility helpers
```

Not allowed:

```text
network calls
storage
process management
runtime scheduling
command polling
ID generation
business workflows
```

If a change needs runtime behavior, place it in the appropriate repository.

## Version / Release Train Rules

Xtrape uses matching minor versions across public packages.

During development:
- Before starting implementation, run `git fetch --all --prune` and check whether the current branch is behind its upstream. Pull or rebase the latest upstream code before editing, unless local uncommitted work must first be stashed or committed.
- Do not assume unpublished npm versions exist.
- Do not set dependencies to versions such as `^0.3.0` before that version is published.
- Use GitHub branch dependencies, local workspace linking, or npm prerelease packages when needed.
- Release candidates should use `0.3.0-rc.x` with the `next` npm dist-tag.
- Final releases should use semver versions with the `latest` npm dist-tag.

Recommended release order:

```text
1. contracts (this repository)
2. connector SDK
3. Platform CE
4. demo
5. site
```


## Dependency Policy

This package should have minimal runtime dependencies.

Preferred:

- `zod`
- TypeScript build tooling

Avoid:

- runtime ID generation packages
- HTTP client packages
- filesystem token stores
- framework dependencies
- UI dependencies

If a dependency is not required for schema/type validation, question whether it belongs here.

## Development Commands

Common commands:

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

Before claiming a change is complete, run the relevant commands available in `package.json`.

## Testing Expectations

Contract changes should include tests or schema assertions when practical.

Test at least:

- valid request examples
- invalid request examples
- backwards-compatible parsing where required
- tightened validation behavior
- exported type availability

Do not silently change public schema behavior without documenting whether it is breaking.

## Documentation Rules

When changing exported schemas or types, update:

- README contract examples if present
- release notes if the change is user-visible
- compatibility notes if the change affects downstream packages

Breaking changes must be explicit.

## AI Safety Rules

When working in this repository:

- Do not add runtime helpers just because another repository needs them.
- Do not patch downstream repositories from here.
- Do not introduce undocumented wire changes.
- Do not add broad abstractions without an immediate protocol need.
- Prefer small schema-focused changes.
- Keep exported names stable unless the issue explicitly calls for a breaking change.
- If a schema is shared with a non-Node implementation (for example Go), keep the wire shape language-neutral.

## PR Checklist

- [ ] The change belongs in contracts, not runtime code.
- [ ] Public exports are intentional.
- [ ] Breaking changes are documented.
- [ ] Typecheck/build passes.
- [ ] Tests or schema examples cover the change.
- [ ] Downstream release impact is noted.
- [ ] Version compatibility is considered.

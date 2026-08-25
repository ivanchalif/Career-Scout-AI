---
name: OpenAPI codegen contract sync
description: Keep the API specification complete before regenerating shared clients.
---

The OpenAPI document is the source of truth for generated Zod validators and React Query hooks. Before regenerating it, confirm that all live, typed endpoints and response fields are represented in the specification.

**Why:** Generation clears and replaces the generated folders. If the specification is behind the API, existing hooks and types disappear from the client even though the corresponding server routes still work.

**How to apply:** When adding an endpoint, update the API specification first, regenerate the libraries, and run both API and web-app typechecks. If the generated server schemas use browser upload types, ensure the shared Zod TypeScript configuration includes the DOM library.
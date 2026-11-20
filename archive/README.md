# Archive

Apps kept for reference, outside the workspace (`pnpm-workspace.yaml` only
includes `packages/*` and `apps/*`), so they are not built or tested.

- `mobile-demo` — the phone-only Discover/Chat demo that drove the scroll
  physics, the 120 Hz request and the first Markdown/agent-chat rendering.
  Superseded by the cross-platform gallery in `apps/gallery`; its README and
  measurements remain useful. It is an ancestor of the physics now in
  `packages/platform/src/sdk/scroll.ts`.

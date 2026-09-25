# Architecture decision records

One file per decision. Status is one of proposed, accepted, superseded.

| ADR | Decision |
|-----|----------|
| [0001](0001-preview-host.md) | Superseded by 0011. Preview host is the target repository's own Vite, driven through its JS API with a generated config |
| [0002](0002-source-mapping.md) | Superseded by 0015. Element to source mapping through a pre-transform JSX stamp plus React fiber walking |
| [0003](0003-edits.md) | Superseded by 0015. Edits are surgical AST edits on TSX followed by the target's formatter |
| [0004](0004-acp.md) | ACP is the only agent interface, wrapped in `packages/acp`; launch configurations are data |
| [0005](0005-effect.md) | Superseded by 0009. Effect Schema on the wire, plain TypeScript services |
| [0006](0006-designs-package.md) | Superseded by 0011. Screens live in a workspace package inside the target repository |
| [0007](0007-catalogue.md) | Component catalogue from the TypeScript 5 compiler API plus `cva` parsing |
| [0008](0008-checkpoints.md) | Agent turn checkpoints are snapshots of the designs directory |
| [0009](0009-effect-runtime.md) | Effect 4 runtime, `RpcGroup` over WebSocket, SDK-backed `AcpAgent` service |
| [0010](0010-storage-modes.md) | Settings and state in one of three storage modes: the desktop's home, a configuration file in the repository, or nothing saved |
| [0011](0011-preview-split.md) | Storybook's separation: editor, framework-neutral preview core, renderer, framework package; screens resolve from an anchor package instead of being one |
| [0012](0012-spaces-pages-router.md) | Screens become pages of a space, routed by their file path, with the editor holding the router state in its own URL |
| [0013](0013-agent-scope.md) | Agents are confined to the repository by an operating system sandbox around their process, the same for every ACP agent |
| [0014](0014-editor-mcp.md) | The editor answers agents over MCP: what the project is and where they are working, not a second way to edit files |
| [0015](0015-design-documents.md) | Pages are design documents (`.page.json`) the tool owns; the design system is imported by an agent; an agent turns a page into code |

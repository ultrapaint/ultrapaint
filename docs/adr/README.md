# Architecture decision records

One file per decision. Status is one of proposed, accepted, superseded.

| ADR | Decision |
|-----|----------|
| [0001](0001-preview-host.md) | Preview host is the target repository's own Vite, driven through its JS API with a generated config |
| [0002](0002-source-mapping.md) | Element to source mapping through a pre-transform JSX stamp plus React fiber walking |
| [0003](0003-edits.md) | Edits are surgical AST edits on TSX followed by the target's formatter |
| [0004](0004-acp.md) | ACP is the only agent interface, wrapped in `packages/acp`; launch configurations are data |
| [0005](0005-effect.md) | Superseded by 0009. Effect Schema on the wire, plain TypeScript services |
| [0006](0006-designs-package.md) | Screens live in a workspace package inside the target repository |
| [0007](0007-catalogue.md) | Component catalogue from the TypeScript 5 compiler API plus `cva` parsing |
| [0008](0008-checkpoints.md) | Agent turn checkpoints are snapshots of the designs directory |
| [0009](0009-effect-runtime.md) | Effect 4 runtime, `RpcGroup` over WebSocket, SDK-backed `AcpAgent` service |

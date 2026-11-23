# Pictures in a PR body

<!-- upstream: mattpocock/skills skills/engineering/pr/SKILL.md -->

A picture shows a reviewer the shape of a change faster than prose: where the new piece sits, what now calls what. Pick the **smallest** view that makes the point, put it beside the sentence it supports, and stop at one or two. Keep only the names the point needs: the calls, files, components and states a reviewer has to see, never the whole tree.

| The point | The picture |
| --- | --- |
| Logic or an algorithm | Pseudocode, a few lines |
| What calls what at runtime | A call tree, indented |
| UI structure | A component tree, with the state and package boundaries that matter |
| Which file owns what, or a broad refactor | A shallow file tree, one comment per line |
| How parts talk to each other over time | A Mermaid `sequenceDiagram` or `flowchart` |
| What changes, in a shape that already exists | Any of the above as a `diff` block, `+` and `-` on the lines that move |
| A new piece most of the reader will copy | The code itself, whole |

A `diff` of a tree is often the best picture of all: it shows the existing shape and the change in one block.

```diff
 submitForm
   createSession
     persistPrompt
+    expandSkillMention
     launchAgent
```

```diff
 src/
 ├── commands/
+│   └── expand.ts       # expands the slash command
-└── transport.ts
+└── transport/
+    ├── client.ts
+    └── stream.ts
```

A change with nothing structural to show — a copy fix, a constant, a one-line guard — gets no picture.

# ADR 0119: The person may turn the agents' sandbox off

Status: accepted, 2026-11-23. Amends 0013 (every agent is started in the sandbox) and 0093 (what
Settings › Agents holds).

## Context

0013 starts every agent the editor launches inside the operating system's sandbox, with no way
out but a machine that has none. The sandbox keeps an agent's reads and writes in the project, its
own files and its tools. That is the right default, but it also stops an agent from reaching
what a person may want it to reach: a sibling checkout, a package linked from elsewhere, a tool
installed somewhere the sandbox does not list. Other agent hosts (T3 Code among them) run their
agents unconfined. On 2026-11-23 the person asked for the sandbox to be their choice.

## Decision

- **The sandbox is a setting of the person's, on by default.** `sandbox` in their profile
  (`~/.ultrapaint/profile.json`), written only when off. It is never a project's setting: a
  project that could turn the sandbox off would turn it off for whoever opens it.
- **Settings › Agents has its switch**, *Run agents in a sandbox*, under the agents. It is found
  by the settings search as `sandbox`.
- **It is asked at each launch.** `AgentSandbox.confines` is true when the machine can confine an
  agent and the person has not turned the sandbox off. A session's launch, the `_meta` that stops
  an agent from starting its own sandbox, the thread's `sandboxed` and the briefing's note on
  `.git` all follow it. An agent already running stays as it started.
- **Off means off for every agent the editor starts**: a thread's, a review model's and the probe
  that lists an agent's models. The editor's own checks still hold where they do not depend on
  the sandbox: its ACP writes stay in the repository and out of `.git`, and a reviewer's ACP
  writes stay in its scratch directory.

## Consequences

- With the sandbox off, nothing but the agent's own judgement keeps it out of the home directory
  and `.git`. The switch's description says so.
- A machine that cannot confine (no bubblewrap, or one the kernel refuses) still runs agents
  unconfined with the switch on; the switch does not say so yet.

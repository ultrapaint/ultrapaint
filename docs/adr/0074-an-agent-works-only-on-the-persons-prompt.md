# ADR 0074: An agent works only on the person's prompt

Status: accepted, 2026-11-09. Generalises 0073.

## Context

0073 took out the setup chat the editor started by itself: a turn on the person's account that
nobody asked for, run behind whatever they were doing. The person's rule is wider than setup:
nothing may both run in the background and use their agents. Their agents are their accounts,
their quota and their money; what spends them is theirs to start.

Two things start an agent without a prompt of the person's at that moment, and both stay:

- **The design review** (0063). Its review models look at what a design turn changed and send
  their findings to the designer. The person started that run with their prompt, in a chat they
  see; the review is part of it, shown as Reviewing with a run card, set by the Review chip and
  stopped with the turn.
- **Agent discovery.** It starts each agent at launch to read the models it offers. It sends no
  prompt and spends nothing; `--no-discovery` turns it off.

## Decision

- **An agent is prompted only for a prompt the person sent**, and for what that run does as the
  person set it to (the review's rounds and its findings, the prompts they queued). The editor
  sends nothing on opening, on a timer, on a file changing or on a state it notices.
- **What the editor would have an agent do, it suggests**: a button that opens a chat with the
  command in its composer (`startTask`), for the person to add to and send. A button the person
  presses may send at once (Make from code, a comment's Send to agent, Go on), in a chat that
  opens in front of them.
- **Every place that prompts an agent is listed** with why it is the person's: in the editor,
  each call of `threads.prompt` (`apps/web/src/agent-prompts.test.ts`); in the server, each
  `agent.prompt` (`apps/server/src/agent-prompts.test.ts`). A new one is added there with its
  reason, or it fails.

  Added 2026-11-10: the editor's list holds each call of `threads.sendQueued` too, which sends a
  prompt the person queued.

## Consequences

- A feature that wants an agent's work without the person's prompt (a setup, a sync, a check on
  open) is a suggestion, never a run.
- Starting an agent session that sends no prompt (discovery, a new chat's session) is allowed: it
  costs nothing.

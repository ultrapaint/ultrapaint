# ADR 0156: A check's decline holds in the thread until its node changes, and the checks read what the turns changed

Status: accepted, 2026-11-27, built with UP-217. Amends [0081](0081-checks-are-findings-for-the-designer.md)
("not sent again in the same run", and one finding a value). Follows
[0087](0087-the-designs-history-is-ultrapaints-and-git-is-apart.md) (the designs' history).

## Context

The checks' findings (ADR 0081) were sent to the designing agent with every new prompt. A decline
was remembered only within a run, which starts at the person's last prompt, and was matched by
its title. The checks also read every node of every page in the round, whether the turn had
changed them or not, and each hand-set value was a finding of its own. In two weeks of usage
logs from two client projects, designing agents declined 188 check findings. 51 of those were
declined again in later runs of the same thread, and one round sent 30 check findings. The
agents' replies said most were hand-set values on parts of the page the turn had not touched.

## Decision

1. **A check's finding keeps what it is about.** Each finding of a check carries its places
   (contracts' `CheckPlace`): the page's file, the node, and the node's fields the check read, as
   one string. For the off-system check the node is its id (design-document's `OffSystemValue`
   has `id` beside `node`, its name), and the fields are the node's fields of the finding's kind,
   its breakpoints' included, on the system or off (`OffSystemValue.fields`). For the rendered
   checks, whose frame names no node, the node is the labels of the blocks measured, and the
   fields are what was measured (the gaps, a row's height).
2. **A decline holds in the thread, across runs, while its place reads the same.** The declines
   are read from every round of the thread (`declinedChecksOf`), not only the run's. What a check
   measures again at a place a decline of the same check names, as it read then, is held back
   from the round. A node whose fields of that kind changed is measured anew. Places replace the
   title match (`notDeclined` is gone). A new thread starts with no declines. A finding stored
   before places were kept names none, and holds nothing.
3. **A decline that held something back is listed in the round, carried.** It comes after the
   round's other findings, marked `carried` with its old reason, and is never sent, numbered,
   counted as fixed or declined, or logged again. The findings log keeps each decline once, with
   its kind (ADR 0081 §4). The review card says "Declined check in an earlier round".
4. **The checks read what the turns changed.** A round's turns are the thread's turns that ended
   after its last round started. A page's before is its tree before the first of those turns
   that changed it, read from the designs' history (each turn's point and its `compare`). The
   off-system check reads the nodes `diffTrees` names as changed between that before and the page
   now (`changedNodeIds`: a node whose own fields changed, and every node of an added subtree).
   The rendered checks read every block of a changed page, the frame naming no nodes. A page the
   turns left as it was gets no check's finding. A page they made, or one with no before (a page
   only looked at again, a history that can't say), is checked whole, and its remembered declines
   hold back the repeats.
5. **One finding a kind.** The off-system values are grouped by kind across the round's pages
   (`OffSystemKind`), one finding a kind, not one a value. A kind with one value keeps UP-218's
   title ("Hand-set spacing 13px on Card and others"). One with several is counted ("7 hand-set
   text sizes on Title and others"), its problem names each value whole with its count of places,
   and its `where` names the first five places and counts the rest.

Otherwise ADR 0081 holds: a check's finding is minor, goes to the designer only, and is declined
with a reason.

## Consequences

- A decline the designer disagrees with is undone by asking for the fix in a prompt, or in a new
  thread. Nothing in the editor lifts it.
- A finding the designer neither fixed nor declined, on a node the next turn did not touch, is
  not sent again in that run. The checks speak of the work just done.
- The rendered checks' declines key on labels. Two blocks relabelled, or measured a pixel apart,
  read as a new finding. Node ids replace the labels once the frame names them.
- A turn's before is read from the history, so it survives a restart. A turn that ends in the
  same millisecond as the round before it starts is not one the round covers. No turn runs under
  a review, so only a clock that stands still, as the tests' does, sees that.
- UP-215 (review only what the turn changed) can read the same before (`turn-befores.ts`).

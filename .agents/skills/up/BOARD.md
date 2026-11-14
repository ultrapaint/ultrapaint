# Board

How the `up-*` skills keep a project board, where the **Tracker** setting (`/up` `## Settings`) names one. Without a board, every rule here is skipped: the labels, the branches and the PRs carry the state. The project's own rules add to these and win where they differ.

## Stages

The skills name a board's statuses by **stage**. The **Tracker** setting maps each stage to the board's own status name.

| Stage | Meaning | Who writes it |
| --- | --- | --- |
| **Ideas** | A draft idea, not wanted yet; never a real issue | A skill, on a draft it creates |
| **Triage** | Not evaluated, or waiting on the reporter or on a decision | The board's automation on add, then projected from the labels |
| **Backlog** | Prioritised, not started | Projected from the labels |
| **Ready** | Fully specified | Projected from the labels |
| **Queued** | Wanted now: a worker may claim it. Only where the **Ready signal** is this board column (`/up-deliver`) | **The user**, by hand. A skill only returns a story there (see Rules) |
| **Building** | Being built, validated and self-reviewed on a branch | `/up-implement` § 1, or the `/up-deliver` claim |
| **Review** | PR open, awaiting CI and review | `/up-to-pr` § 5, and the board's automation where it watches linked PRs |
| **Shipping** | Merged; deploy running, awaiting its receipt | `/up-ship` § 1 |
| **Parked** | Optional. A worker stopped on a question; its branch or PR holds the work | `/up-deliver`, at the park |
| **Done** | Closed | The board's automation on close |

A board without some of these stages skips them, and the skills write nothing for a stage it lacks. Without **Parked**, a parked story keeps the stage it had, and its question label and comment are what mark it.

## Labels drive the status, until the work starts

Up to **Ready**, the status is a **projection** of the labels, not a second source of truth: set it in the same pass you set the labels, or the two drift and the board stops being worth reading. From **Queued** — or, without that stage, from the claim — the labels stop driving it and the board **is** the state.

Up to **Ready**, read this table top-down and take the **first** row that matches; the rows overlap in practice, so order is the rule. Labels are named by role (the **Labels** setting).

| Labels on the issue | Stage |
| --- | --- |
| The triage label, or an axis still unset | Triage |
| The info label | Triage — looked at, but waiting on the reporter |
| The discovery label | Triage — looked at, but waiting on a decision |
| A ready label | Ready |
| Every axis set | Backlog |

The triage label outranks a priority deliberately. The two co-occur on real issues: a priority applied at filing time is a guess, and the triage label says a maintainer has still not evaluated the issue. Whoever triages drops it, and only then does the backlog row take effect.

**Queued is intent; a ready label is a property.** A ready label says the story is specified well enough to build. Queued says the user wants it started now. Keeping them apart is what lets a story be honestly ready and still not be started.

## Rules

- **Never add an issue to the board by hand where an automation adds it.** Your job is only the status of an item that is already there.
- **When creating an issue, leave the status alone.** The automation adds the item asynchronously, so anything set in the same breath as the create races it and silently does nothing. Get the labels right instead; the board catches up on its own.
- **When filing an idea, create a draft on the board, never an issue.** A draft is the one item you add by hand, because no automation can. An add automation may still write Triage on it, asynchronously, so `board_idea` below sets Ideas and re-reads until it holds.
- **When labels move an issue along**, set the new stage in the same pass. By then the item exists.
- **Only the user queues a story.** No skill puts an issue in Queued that the user did not put there. A user's explicit yes to a skill's offer — `/up-triage` offers it on a ready story — is the user queuing it. An agent that queues its own work has removed the control the gate exists to give. The one write a skill makes is a **return**: a story the user queued, whose claim produced no branch and no PR, goes back to Queued (`/up-deliver` § 1). The user wanted it started, and a worker that died does not cancel that.
- **A claim is one write, then a read.** Write Building **before** cutting the branch, then re-read the item. A worker that does not see itself as the writer lost the race. This is the only thing stopping two workers building one story.
- **Review when the PR opens**, not after CI goes green: Review covers "PR open, awaiting CI and review", so an amber build belongs there too. The write may agree with an automation that already made it; it costs one call and covers a PR opened without a link.
- **Shipping immediately *before* the merge**, not after. The merge closes the issue, and a close automation then writes Done; a later Shipping write would land on top of Done and stick, because that trigger is spent.
- **Never set Done by hand**, except when reconciling: moving an issue you have just read as **closed** confirms rather than asserts. Setting Done on anything else only masks whether the issue actually closed.
- **Done means closed, not shipped.** A close automation fires on any close, including *not planned*. The merged PR is what says the work landed.
- **Never hardcode the project, field or option ids.** They are regenerated whenever the board is recreated, so resolve them every time.

## When the user asks

| The user says | It means |
| --- | --- |
| "the board" | The board the **Tracker** setting names |
| "save it as an idea", "add it to the board as an idea", "a draft issue" | A draft in Ideas, with `board_idea`. Never a real issue |
| "check the board", "update the statuses" | [Checking the board](#checking-the-board), with every card you moved named in the reply |

## Checking the board

Read every card and move each one whose stage no longer matches what exists. Take the first rule that applies:

1. **The issue is closed**: Done.
2. **Building, Review, Shipping or Parked**: the in-flight table in [`/up-deliver`](../up-deliver/SKILL.md) `### 1. Reconcile what is in flight` — a branch, a PR, a merge.
3. **Triage, Backlog or Ready**: the label table above.
4. **Queued, or a draft in Ideas**: leave it. Both are the user's own moves.

Never queue a story the user did not queue: the only Queued write is the return that step 2 makes. Name every card you moved, from which stage to which, and why. A card moved in silence is a card the user can no longer trust.

## GitHub Projects commands

For a GitHub Project linked to the repository, with a single-select `Status` field. `board` finds the one open board linked to the repo — by that link, not by its title, so renaming it changes nothing. `board_status` sets the status of an issue already on it; `board_idea` saves an idea as a draft and prints the draft's id. Pass the board's own status names, from the **Tracker** setting. An empty item id in `board_status` means the automation has not added the issue yet; leave it, do not add it yourself.

```sh
repo() { # prints "<owner> <name>"
  gh repo view --json owner,name --jq '"\(.owner.login) \(.name)"'
}

board() { # prints "<number> <project-id>": the one open board linked to this repo
  local owner name
  read -r owner name < <(repo)
  gh api graphql -f query='
    query($o:String!,$r:String!){ repository(owner:$o,name:$r){
      projectsV2(first:10){ nodes{ number id closed } } } }' -f o="$owner" -f r="$name" \
    --jq '[.data.repository.projectsV2.nodes[] | select(.closed==false)][0] | "\(.number) \(.id)"'
}

board_option() { # board_option <project-number> <status-name>: prints "<field-id> <option-id>"
  local owner name
  read -r owner name < <(repo)
  gh project field-list "$1" --owner "$owner" --format json \
    --jq ".fields[] | select(.name==\"Status\") | \"\(.id) \(.options[] | select(.name==\"$2\") | .id)\""
}

board_set() { # board_set <project-id> <item-id> <field-id> <option-id>
  gh api graphql -f query='
    mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){
      updateProjectV2ItemFieldValue(input:{
        projectId:$p, itemId:$i, fieldId:$f, value:{singleSelectOptionId:$o}
      }){ projectV2Item{ id } }
    }' -f p="$1" -f i="$2" -f f="$3" -f o="$4" >/dev/null
}

board_item_status() { # board_item_status <item-id>
  gh api graphql -f query='
    query($i:ID!){ node(id:$i){ ... on ProjectV2Item {
      fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }' \
    -f i="$1" --jq '.data.node.fieldValueByName.name'
}

board_status() { # board_status <issue-number> <status-name>
  local issue="$1" target="$2" # not `status`: zsh reserves that name
  local owner name number project_id field_id option_id item_id
  read -r owner name < <(repo)
  read -r number project_id < <(board)
  read -r field_id option_id < <(board_option "$number" "$target")

  item_id=$(gh api graphql -f query='
    query($o:String!,$r:String!,$n:Int!){
      repository(owner:$o,name:$r){ issue(number:$n){
        projectItems(first:10){ nodes{ id project{ id } } } } }
    }' -f o="$owner" -f r="$name" -F n="$issue" \
    --jq ".data.repository.issue.projectItems.nodes[] | select(.project.id==\"$project_id\") | .id") ||
    { echo "issue #$issue does not exist" >&2; return 1; }

  [[ -z "$item_id" ]] && { echo "issue #$issue is not on the board yet" >&2; return 1; }

  board_set "$project_id" "$item_id" "$field_id" "$option_id"
}

board_idea() { # board_idea <title> <body> <ideas-status-name>: prints the draft's item id
  local owner name number project_id field_id option_id item_id
  read -r owner name < <(repo)
  read -r number project_id < <(board)
  read -r field_id option_id < <(board_option "$number" "$3")
  item_id=$(gh project item-create "$number" --owner "$owner" \
    --title "$1" --body "$2" --format json --jq '.id')

  # An add automation may write Triage on the draft, asynchronously:
  # set Ideas until a re-read shows it held.
  local attempt
  for attempt in 1 2 3; do
    board_set "$project_id" "$item_id" "$field_id" "$option_id"
    sleep 5
    [[ "$(board_item_status "$item_id")" == "$3" ]] && { echo "$item_id"; return 0; }
  done
  echo "draft $item_id did not stay in $3" >&2
  return 1
}
```

Writing to a project needs a token carrying the `project` scope; the repo scope alone is not enough, and the default `GITHUB_TOKEN` cannot write an organisation's projects at all. Locally: `gh auth refresh -s project,read:project`.

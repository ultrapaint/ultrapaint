/**
 * The design chat's review loop (ADR 0060, 0061, 0063): when a design turn that changed pages
 * ends, the round's review models look at them, each in a fresh session that can only look
 * (`reviewer.ts`); each answers with findings and whether it approves, which contracts' `review`
 * scores; and unless the review ends there, the findings go to the designer as its next prompt,
 * marked as the review's, and the next round looks at what that turn changed.
 *
 * A review **run** starts at the person's last prompt, and its rounds are the `review` items after
 * it, each written when the round starts and updated as its reviewers answer. The pages a turn
 * changed wait here, by thread, for the next round. The thread session decides when a round runs
 * (`due`, then `run`), shows the thread as reviewing meanwhile, and sends the findings.
 */
import type { ContentBlock } from "@ultrapaint/acp/acp-agent";
import {
  formatReviewModel,
  type LoggedFinding,
  MAX_ROUNDS,
  type ReviewerRound,
  type ReviewModel,
  type ReviewSettings,
  type Round,
  reviewersOfRound,
  reviewSettingsOf,
  verdictOf,
} from "@ultrapaint/contracts/review";
import {
  isModelOption,
  namedChoices,
  type RoundReviewer,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import {
  Clock,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Path,
  Result,
} from "effect";
import { AppLog } from "../../app-log.ts";
import { ServerConfig } from "../../config.ts";
import { makeId } from "../../ids.ts";
import { OpenProject } from "../../project.ts";
import { ProfileService } from "../profile.ts";
import { RepoPaths } from "../repo-paths.ts";
import { AgentConfigs } from "../threads/agent-configs.ts";
import { ChatPreferences } from "../threads/chat-preferences.ts";
import { ThreadStore } from "../threads/thread-store.ts";
import { makeFindingsLog } from "./findings-log.ts";
import { makePageViews } from "./page-views.ts";
import {
  findingsPrompt,
  type PageView,
  reviewerPrompt,
} from "./review-prompts.ts";
import {
  answeredRound,
  declinedOf,
  endedRound,
  type Found,
  handsToAll,
  isPageFile,
  REVIEW_TIMEOUT,
  type ReviewItem,
  reviewerResult,
  roundEndOf,
  roundOf,
  runOf,
  saidSinceLastPrompt,
  standInFor,
  TIMED_OUT,
  toRoundFinding,
  turnsOf,
} from "./review-rounds.ts";
import { makeReviewer, ReviewerFailure } from "./reviewer.ts";

/** A round the thread's review is due: the pages it looks at, and where the run stands. */
export interface DueRound {
  /** The round's number, from 1. */
  readonly number: number;
  /** The pages it looks at, repository-relative. */
  readonly pages: readonly string[];
  /** The run's rounds so far, as the verdict reads them. */
  readonly previous: readonly Round[];
  /** What the person asked, which the reviewers keep to. */
  readonly request: string;
  readonly settings: ReviewSettings;
  /** How many rounds were reviewed in turn so far: who reviews this one. */
  readonly turns: number;
}

/** A round's findings for the designer, and the round's item, which its prompt names. */
export interface ToDesigner {
  readonly review: string;
  readonly text: string;
}

/** What the review shows when nobody can review. */
const NOBODY =
  "No review model can be reached: sign in to an agent, or choose the review models in Settings › Agents › Review.";

/** What a reviewer still looking is shown with when the review is stopped. */
export const STOPPED = "The review was stopped.";

/** A round's findings, the project's name and the round's number, as the log keeps them. */
interface Logged {
  readonly found: readonly Found[];
  readonly project: string;
  readonly round: number;
}

/** A round under way: its item, who is in it, and what its reviewers gave so far. */
interface RoundState {
  readonly found: Found[];
  readonly id: string;
  readonly inRound: Set<string>;
  readonly left: string[];
  readonly scores: Record<string, ReviewerRound>;
}

/** What every round of one review shares. */
interface Review {
  /** The round under way, which a stop ends. */
  current: string | null;
  readonly maxRounds: number;
  readonly models: readonly ReviewModel[];
  readonly projectName: string;
  readonly prompt: readonly ContentBlock[];
  readonly root: string;
  readonly settings: ReviewSettings;
  readonly threadId: string;
  readonly views: readonly PageView[];
}

export class ReviewLoop extends Context.Service<
  ReviewLoop,
  {
    /**
     * The round due now for the thread, its pages taken from those waiting; null when its design
     * isn't to be reviewed now: an implement thread, review off, no page changed, or the run over.
     */
    readonly due: (threadId: string) => Effect.Effect<DueRound | null>;
    /**
     * Runs the round, and when its reviewers are satisfied while every review model is to
     * approve, the closing round of all of them: the findings for the designer, or null when the
     * review ended. Interrupted, the round under way ends "stopped".
     */
    readonly run: (
      threadId: string,
      due: DueRound
    ) => Effect.Effect<ToDesigner | null>;
    /**
     * A turn of the thread ended: the pages it changed wait for the next round, and when it
     * answered a round's findings, the round says what was fixed and declined.
     */
    readonly turnEnded: (
      threadId: string,
      options: { readonly cancelled: boolean }
    ) => Effect.Effect<void>;
  }
>()("ultrapaint/server/ReviewLoop") {
  static readonly layer = Layer.effect(
    ReviewLoop,
    Effect.gen(function* () {
      const store = yield* ThreadStore;
      const agents = yield* AgentConfigs;
      const preferences = yield* ChatPreferences;
      const project = yield* OpenProject;
      const log = yield* AppLog;
      const { version } = yield* ServerConfig;
      const path = yield* Path.Path;
      const lookWith = yield* makeReviewer();
      const viewsOf = yield* makePageViews();
      const findingsLog = yield* makeFindingsLog();
      const profile = yield* ProfileService;
      const newItemId = makeId("item");

      /** The pages each thread's turns changed since its last round. */
      const pending = new Map<string, Set<string>>();
      /** The pages each thread's last round looked at: the next looks again if none changed. */
      const lastPages = new Map<string, readonly string[]>();
      /** A round's findings waiting for the designer's answer, for the log, by the round's item. */
      const unanswered = new Map<string, Logged>();

      const currentPaths = project
        .use(RepoPaths)
        .pipe(Effect.option, Effect.map(Option.getOrNull));

      const patchRound = (
        threadId: string,
        itemId: string,
        patch: (item: ReviewItem) => ReviewItem
      ) =>
        store.patchItem(threadId, itemId, (item) =>
          item.kind === "review" ? patch(item) : item
        );

      /** The pages wait for the next round. */
      const wait = (threadId: string, pages: readonly string[]) =>
        Effect.sync(() => {
          const waiting = pending.get(threadId) ?? new Set<string>();
          for (const page of pages) {
            waiting.add(page);
          }
          pending.set(threadId, waiting);
        });

      /** Findings as the log keeps them, with what the designer did with each. */
      const logFindings = Effect.fnUntraced(function* (
        entry: Logged,
        did: (index: number) => LoggedFinding["designer"]
      ) {
        const at = DateTime.formatIso(
          DateTime.makeUnsafe(yield* Clock.currentTimeMillis)
        );
        yield* findingsLog.append(
          entry.project,
          entry.found.map((f, i) => ({
            ...f.finding,
            agreedBy: [],
            at,
            designer: did(i),
            page: f.page,
            project: entry.project,
            reviewer: f.reviewer,
            round: entry.round,
            section: f.page,
            skill: version,
          }))
        );
      });

      // ---- a turn's end ----

      /** The turn answered a round: the round says what it fixed and declined, and so does the log. */
      const recordAnswer = Effect.fnUntraced(function* (
        threadId: string,
        items: readonly ThreadItem[],
        cancelled: boolean
      ) {
        const round = runOf(items).answering;
        if (round === undefined || round.fixed !== undefined) {
          return;
        }
        // A turn stopped answered nothing.
        const declined = cancelled
          ? new Map<number, string>()
          : declinedOf(saidSinceLastPrompt(items), round.findings);
        if (!cancelled) {
          yield* patchRound(threadId, round.id, (item) =>
            answeredRound(item, declined)
          );
        }
        const waiting = unanswered.get(round.id);
        unanswered.delete(round.id);
        if (waiting) {
          yield* logFindings(waiting, (i): LoggedFinding["designer"] => {
            const reason = declined.get(i);
            if (cancelled) {
              return { did: "unanswered" };
            }
            return reason === undefined
              ? { did: "fixed" }
              : { did: "declined", reason };
          });
        }
      });

      const turnEnded = Effect.fn("ReviewLoop.turnEnded")(function* (
        threadId: string,
        options: { readonly cancelled: boolean }
      ) {
        const thread = yield* store.get(threadId);
        const paths = yield* currentPaths;
        if (!thread || paths === null) {
          return;
        }
        const items = yield* store.items(threadId);
        const end = items.findLast((i) => i.kind === "turn_end");
        if (
          end?.kind === "turn_end" &&
          (thread.purpose ?? "design") === "design"
        ) {
          yield* wait(
            threadId,
            end.changedFiles.filter(
              (file) => isPageFile(file) && paths.isInDesigns(file)
            )
          );
        }
        yield* recordAnswer(threadId, items, options.cancelled);
      });

      // ---- when a round is due ----

      const due = Effect.fn("ReviewLoop.due")(function* (threadId: string) {
        const thread = yield* store.get(threadId);
        const paths = yield* currentPaths;
        if (!thread || paths === null) {
          return null;
        }
        // Keeping findings is the person's (their profile), or a project's that still says so.
        const { keepFindings } = yield* profile.get;
        const settings = {
          ...reviewSettingsOf(paths.settings.review, thread.review),
          ...(keepFindings === true && { findingsLog: true }),
        };
        if (
          (thread.purpose ?? "design") !== "design" ||
          settings.on === false
        ) {
          // Not reviewed: what it changed is not owed a review later.
          pending.delete(threadId);
          return null;
        }
        const run = runOf(yield* store.items(threadId));
        const maxRounds = settings.goal?.maxRounds ?? MAX_ROUNDS;
        if (
          run.rounds.at(-1)?.end !== undefined ||
          run.rounds.length >= maxRounds
        ) {
          return null;
        }
        const changed = [...(pending.get(threadId) ?? [])].sort();
        // A designer that answered by declining everything changed nothing: the pages are looked at again.
        const pages =
          changed.length === 0 && run.answering !== undefined
            ? (lastPages.get(threadId) ?? [])
            : changed;
        if (pages.length === 0) {
          return null;
        }
        pending.delete(threadId);
        lastPages.set(threadId, pages);
        const round: DueRound = {
          number: run.rounds.length + 1,
          pages,
          previous: run.rounds.map(roundOf),
          request: run.request,
          settings,
          turns: turnsOf(run.rounds),
        };
        return round;
      });

      // ---- who reviews ----

      /**
       * With no review models chosen, the strongest model of each agent that has said what it
       * offers (a session or discovery started, so it is there and signed in): the first model
       * it names, which is how the agents list them, the most capable first.
       */
      const strongest = Effect.gen(function* () {
        const configs = yield* agents.list;
        const known = yield* preferences.options;
        return configs.flatMap((config): ReviewModel[] => {
          const option = known
            .find((a) => a.agentId === config.id)
            ?.configOptions.find(isModelOption);
          const [first] = option ? namedChoices(option) : [];
          return first ? [{ agentId: config.id, model: first.value }] : [];
        });
      });

      /** The model in the round, as its agent names it, still looking. */
      const looking = Effect.fnUntraced(function* (model: ReviewModel) {
        const known = yield* preferences.options;
        const option = known
          .find((a) => a.agentId === model.agentId)
          ?.configOptions.find(isModelOption);
        const entry: RoundReviewer = {
          findings: 0,
          key: formatReviewModel(model),
          name:
            option?.options.find((o) => o.value === model.model)?.name ??
            model.model,
          status: "looking",
        };
        return entry;
      });

      // ---- a round ----

      const setReviewer = (
        review: Review,
        state: RoundState,
        key: string,
        patch: Partial<RoundReviewer>
      ) =>
        patchRound(review.threadId, state.id, (item) => ({
          ...item,
          findings: state.found.map(toRoundFinding),
          reviewers: item.reviewers.map((r) =>
            r.key === key ? { ...r, ...patch } : r
          ),
        }));

      /**
       * One review model's look, its answer written in the round. Silent past the time, it hands
       * the round to the next model in turn that isn't in it.
       */
      const lookBy = (
        review: Review,
        state: RoundState,
        model: ReviewModel
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const key = formatReviewModel(model);
          const answered = yield* lookWith(
            model,
            review.root,
            review.prompt
          ).pipe(
            Effect.timeoutOrElse({
              duration: REVIEW_TIMEOUT,
              orElse: () =>
                Effect.fail(new ReviewerFailure({ message: TIMED_OUT })),
            }),
            Effect.result
          );
          if (Result.isSuccess(answered)) {
            const entry = yield* looking(model);
            const given = reviewerResult(review.views, answered.success, {
              key,
              name: entry.name,
            });
            state.scores[key] = given.result;
            state.found.push(...given.found);
            state.left.push(...given.left);
            return yield* setReviewer(review, state, key, given.patch);
          }
          const reason = answered.failure.message;
          state.scores[key] = {
            score: { kind: "none", reason },
            signedOff: false,
          };
          yield* setReviewer(review, state, key, {
            reason,
            status: "no-score",
          });
          const next =
            reason === TIMED_OUT
              ? standInFor(review.models, model, state.inRound)
              : undefined;
          if (next !== undefined) {
            state.inRound.add(formatReviewModel(next));
            const entry = yield* looking(next);
            yield* patchRound(review.threadId, state.id, (item) => ({
              ...item,
              reviewers: [...item.reviewers, entry],
            }));
            yield* lookBy(review, state, next);
          }
        });

      /** A round's item, written as it starts. */
      const pushRound = Effect.fnUntraced(function* (
        review: Review,
        number: number,
        fields: Partial<ReviewItem>
      ) {
        const id = yield* newItemId;
        review.current = id;
        yield* store.push(review.threadId, {
          at: yield* Clock.currentTimeMillis,
          findings: [],
          id,
          kind: "review",
          maxRounds: review.maxRounds,
          reviewers: [],
          round: number,
          ...fields,
        } satisfies ThreadItem);
        return id;
      });

      /** One round by `who`, then the closing one or the end, or the findings to send. */
      const roundBy = (
        review: Review,
        who: readonly ReviewModel[],
        closing: boolean,
        number: number,
        previous: readonly Round[]
      ): Effect.Effect<ToDesigner | null> =>
        Effect.gen(function* () {
          const state: RoundState = {
            found: [],
            id: yield* pushRound(review, number, {
              reviewers: yield* Effect.forEach(who, looking),
              ...(closing && { closing: true }),
            }),
            inRound: new Set(who.map(formatReviewModel)),
            left: [],
            scores: {},
          };
          yield* Effect.forEach(who, (m) => lookBy(review, state, m), {
            concurrency: "unbounded",
            discard: true,
          });
          const rounds: Round[] = [
            ...previous,
            { costUsd: 0, reviewers: state.scores },
          ];
          const verdict = verdictOf(review.settings.goal ?? {}, rounds);
          const logged: Logged = {
            found: state.found,
            project: review.projectName,
            round: number,
          };
          // Findings the designer is not asked about are logged as such.
          const unsent = review.settings.findingsLog
            ? logFindings(logged, () => ({ did: "unanswered" }))
            : Effect.void;
          const toAll = handsToAll({
            approval: review.settings.approval ?? "all",
            closing,
            found: state.found.length,
            models: review.models.length,
            verdict,
            who: who.length,
          });
          if (toAll) {
            yield* unsent;
            return yield* roundBy(
              review,
              review.models,
              true,
              number + 1,
              rounds
            );
          }
          if (verdict.stop || state.found.length + state.left.length === 0) {
            yield* patchRound(review.threadId, state.id, (item) => ({
              ...item,
              end: roundEndOf(verdict),
            }));
            yield* unsent;
            return null;
          }
          if (review.settings.findingsLog) {
            unanswered.set(state.id, logged);
          }
          return {
            review: state.id,
            text: findingsPrompt(
              review.views,
              state.found.map(toRoundFinding),
              state.left
            ),
          };
        });

      /** The round under way ends, its reviewers still looking stopped with it. */
      const endCurrent = (
        review: Review,
        end: NonNullable<ReviewItem["end"]>
      ) =>
        Effect.suspend(() =>
          review.current === null
            ? Effect.void
            : patchRound(review.threadId, review.current, (item) =>
                endedRound(item, end, STOPPED)
              )
        );

      /** The review's rounds from `due`, or the item that says none can run. */
      const reviewFrom = Effect.fnUntraced(function* (
        threadId: string,
        round: DueRound,
        shared: { review: Review | null }
      ) {
        const paths = yield* currentPaths;
        const { settings } = round;
        const chosen = settings.reviewModels ?? [];
        const models = chosen.length > 0 ? chosen : yield* strongest;
        const views =
          paths === null ? [] : yield* viewsOf(paths.root, round.pages);
        if (paths === null || views.length === 0) {
          return null;
        }
        const started: Review = {
          current: null,
          maxRounds: settings.goal?.maxRounds ?? MAX_ROUNDS,
          models,
          projectName: path.basename(paths.root),
          prompt: reviewerPrompt(round.request, views),
          root: paths.root,
          settings,
          threadId,
          views,
        };
        shared.review = started;
        if (models.length === 0) {
          yield* pushRound(started, round.number, {
            end: { problem: NOBODY, reason: "failed", unmet: [] },
          });
          return null;
        }
        return yield* roundBy(
          started,
          reviewersOfRound(models, settings.eachRound ?? "rotate", round.turns),
          false,
          round.number,
          round.previous
        );
      });

      const run = Effect.fn("ReviewLoop.run")(function* (
        threadId: string,
        round: DueRound
      ) {
        const shared: { review: Review | null } = { review: null };
        const ending = (end: NonNullable<ReviewItem["end"]>) =>
          shared.review === null ? Effect.void : endCurrent(shared.review, end);
        return yield* reviewFrom(threadId, round, shared).pipe(
          Effect.onInterrupt(() =>
            // Not reviewed after all: the pages wait for the next round.
            Effect.andThen(
              ending({ reason: "stopped", unmet: [] }),
              wait(threadId, round.pages)
            )
          ),
          Effect.catchDefect((defect) => {
            const problem =
              defect instanceof Error ? defect.message : String(defect);
            return log
              .log(
                "agent",
                "error",
                `a review of ${threadId} broke: ${problem}`
              )
              .pipe(
                Effect.andThen(
                  ending({ problem, reason: "failed", unmet: [] })
                ),
                Effect.as(null)
              );
          })
        );
      });

      return ReviewLoop.of({ due, run, turnEnded });
    })
  );
}

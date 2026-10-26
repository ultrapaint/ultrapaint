# Linear: home page, a landing

## Purpose
Product and engineering teams evaluating a tool for planning and building software come here to learn what Linear is. The page presents Linear as "the product development system for teams and agents" and walks through its four areas: intake, planning, AI agents, and code review. Along the way it shows the product at work, offers proof from known companies, and ends by asking the visitor to sign up. The primary action is signing up ("Sign up" / "Get started"). "Contact sales" is the secondary action.

## Content

### Site navigation
The way around the site, and the entry points to an account.
- Skip link: "Skip to content →"
- Brand: Linear (logo and wordmark)
- Links: Product, Resources, Customers, Pricing, Now, Contact
- Account: "Log in", "Sign up" (the primary action)

### What the product is
The headline promise and the latest news.
- Headline: "The product development system for teams and agents"
- Subline: "Purpose-built for planning and building products. Designed for the AI era."
- An announcement link: label "New", link "Loops →"

### The product at work: an issue being handled by people and an agent
A screenshot of the Linear app shows an issue moving from a Slack report to a draft pull request written by Linear's agent, so the visitor sees the whole workflow at once.
- App navigation: workspace switcher "Linear"; buttons "Search workspace" and "New issue"; Pulse, Inbox, My issues, Reviews; a "Workspace" group with Initiatives, Projects, More; a "Favorites" group with Faster app launch (selected), Agent tasks, Agent Insights, UI Refresh.
- Issue header: "DRV-8852 Faster app launch", a favourite star ("Remove from favorites"), "Issue options", position "1 / 84" with "Previous issue" and "Next issue". Action buttons: "Copy issue URL", "Copy issue ID", "Copy git branch name", "Delegate to an agent", "More delegation options".
- Issue title: "Faster app launch"
- Description: "Render UI before `vehicle_state` sync when minimum required state is present, instead of blocking on full refresh during iOS startup."
- Activity:
  - "Linear created the issue via Slack on behalf of Karri · 2min ago"
  - "Triage Intelligence added the labels Performance and iOS · 2min ago"
  - Comment from karri · 4 min ago: "Right now we show a spinner forever, which makes it look like the car disappeared..."
  - Reply from jori · just now: "@Linear can you take a stab at this?"
  - "Linear connected by Jori · 2 min ago" — "Changed 2 files Draft PR awaiting your review · 2 min ago"
  - "Linear moved from Todo to In Progress · just now"
- Agent conversation (Linear, model "Opus 5.5"), with minimise, expand and close controls:
  - The request: "Fix the dimmed ride rows that never reset and open a PR"; "DRV-364 added to context"
  - "Worked for 10 sec"
  - Reply: "Pushed and opened a draft PR. Removed dimmedIds — isItemDimmed now checks waitingStatusById directly."
  - The change: "Changed 2 files +22 −10", "Preview"; "Draft Reset dimmed ride rows"; branch "master ← ride/drv-364-reset-dimmed-rows"
  - Reply field: "Reply…", with a "Skills" menu
- Issue properties: Reviews: Revert. Properties: In Progress; Medium priority; assignee Karri; Linear; Cycle 144. Labels: Performance, iOS. Releases: Linear App 1.6881... ⋅ Jun 25

### Proof that others use it
A row of customer logos: OpenAI, Vercel, Salesforce, Figma, Cursor, Coinbase, Ramp.
- Caption: "Powering the companies building the future"

### What makes Linear different
A positioning statement and three principles, each with an abstract line illustration labelled as a figure.
- Statement: "A new species of product tool." followed by "Purpose-built for modern teams with AI workflows at its core, Linear sets a new standard for planning and building products." (The first sentence is the lead and the rest supports it.)
- Fig 0.1 — "Purpose-built": "Linear is shaped by the practices and principles of world-class product teams." (illustration: a stack of layers with the Linear mark on top)
- Fig 0.2 — "Powered by agents": "Designed for workflows shared by humans and agents. From drafting PRDs to pushing PRs." (illustration: a cluster of cubes)
- Fig 0.3 — "Designed for speed": "Reduces noise and restores momentum to help teams ship with high velocity and focus." (illustration: a row of panels rising in height)

### Area 1: Intake and integrations
How conversations and feedback turn into routed issues.
- Heading: "Intake and integrations"
- Copy: "Automatically turn conversations and customer feedback into actionable issues that are instantly routed, labeled, and prioritized for the right team."
- Link: "Learn more →"
- Illustration: a Slack thread that turns into issues on a board.
  - Thread in #product:
    - didier 4:21 PM: "Has anyone been looking into the iOS startup performance issues?"
    - lena 4:21 PM: "Anyone else noticing the iOS app feels slow to open if you haven't used it in a bit?"
    - didier 4:21 PM: "Yea, we're still blocking initial render on a full vehicle_state sync every time…"
    - andreas 4:21 PM: "Feels like we could render sooner and load the rest in the background. Probably also worth tracking startup timing so we know how often this happens!"
    - Message being written: "@Linear create issues and assign to me". Composer controls: Attach file, Hide formatting, Emoji, Mention someone, Record video clip, Record audio clip, Run shortcut, Send message, Schedule for later.
  - Issue board, with columns by status. Each column has "Add issue" and "Open menu".
    - Backlog (8): ENG-2085 Reduce UI flicker during autonomy... (No priority); ENG-2094 Add buffering for autonomy event streams (No priority); ENG-2092 Reduce startup delay caused by vehicle sync (No priority); ENG-2200 Fix delayed route updates during rerouting (No priority)
    - Todo (71): ENG-926 Remove UI inconsistencies (High; Bug, Design); ENG-2088 TypeError: Cannot read properties (Medium; Bug); ENG-924 Upgrade to Claude Opus 5.5 (Low; AI); ENG-1882 Optimize load times (No priority; Performance)
    - In Progress (3): ENG-1487 Remove contentData from GraphQL API (Medium; PR 61039); MKT-1028 Launch page assets (Medium; Design); ENG-2187 Prevent duplicate ride requests on poor... (High; Bug; PR 62048)
    - Done (53): ENG-2074 Clean up deprecated APIs... (Medium; API; 61002); ENG-1912 Reduce latency in autonomy st... (Low; 61005); ENG-1951 Reduce ETA fluctuations durin... (Medium; 61202); ENG-1960 Improve fallback messaging (Medium; UI; 61149); ENG-1991 Improve rider visibility into veh... (Medium)
- Features in this area: Linear Agent +, Customer Requests +, Triage +, Linear Asks +

### Area 2: Planning and monitoring
How teams plan from idea to launch and track progress.
- Heading: "Planning and monitoring"
- Copy: "Plan and navigate from idea to launch. Align your team with product initiatives, strategic roadmaps, and clear, up-to-date PRDs."
- Link: "Learn more →"
- Illustration 1: a roadmap timeline running from March to September, with weekly dates (MAR 2 9 16 23, … through SEP 7 14 21 28). Each project is a bar with milestones:
  - UI Refresh — milestones Core screens, Polish (the bar runs past its end into an overdue stretch)
  - Split fares — Internal, Public Beta
  - Autonomy status clarity — Alpha
  - Autonomy telemetry reliability — Beta, GA
- Illustration 2: a chart titled "Cycle time by agent". It is a scatter plot of individual cycle times grouped by month (Oct 2025, Nov 2025, Dec 2025, Jan 2026, Feb 2026), with stepped trend lines running through the months. Each month shows a dense cluster of points spread over a wide range. Nov 2025 has fewer points, split into an upper and a lower cluster.
- Features in this area: Projects +, Documents +, Pulse +, Initiatives +, Visual planning +, Insights +

### Area 3: AI and automations
Agents as teammates that take on whole tasks.
- Heading: "AI and automations"
- Copy: "Build and deploy AI agents that work alongside you as teammates. Work on complex tasks together or delegate entire issues end-to-end."
- Link: "Learn more →"
- Illustration: a set of agent conversations, each a request and its result:
  1. Linear (Opus 5.5) — "what are the three most important customer requests around permissions? add them to the Access Controls project" → "Worked for 8 sec" → "Three issues ranked by customer impact:" ENG-2298 Add granular project permissions (Urgent); ENG-2647 Let guests access multiple teams (Medium); ENG-2352 Create custom roles with scoped access (High) → "I've added them to Access Controls"
  2. Cursor — "add retry handling for failed image uploads described in this issue"; "ENG-2844 added to context" → "Thinking..." → "Started working on ENG-2844 Failed image upload and launched a cloud agent." → "Setting up DRV/rideshare-app… 00:07"
  3. Linear (Opus 5.5) — "Review today's mobile triage and group the issues by what should happen next"; "Mobile Triage added to context" → "Worked for 12 sec" → "Reviewed eight issues: two are ready for backlog, two need details, and four belong to iOS or Android." Backlog · 2: ENG-2521 Missing inbox status colors (High); ENG-2364 Notifications after logout… (High). Needs information · 2: ENG-2557 Deep links discard issue drafts (No priority); ENG-2362 Open PRs from mobile diffs (No priority)
  4. ChatPRD — "review this issue, draft complete offline mode requirements, and break the work into sub-issues"; "ENG-2521 added to context" → "Worked for 1 min" → "Updated the issue with requirements, open product decisions, and acceptance criteria." ENG-2920 Define offline mode requirements (High)
- Features in this area: Linear Agent +, Coding sessions +, Triage +, Linear MCP +

### Area 4: Build, review, and ship
Code review inside Linear, tied to the issues.
- Heading: "Build, review, and ship"
- Copy: "Streamline code reviews with clear diffs, better context, and fewer back-and-forth comments. Keep PRs moving without sacrificing quality."
- Link: "Learn more →"
- Illustration 1: a list of issues with their pull requests, grouped by status.
  - In Review (3): ENG-2498 Replace isFullySynced with a sync status (#54910, iOS, Oct 9); ENG-2380 Show a stale data banner while syncing (#55167, Reliability, Oct 9); ENG-2039 Pass sync status to the dashboard (#55209, Bug, Reliability, Oct 8)
  - In Progress (4): ENG-2076 Reduce ETA jitter (#55423, Performance, Working…, Oct 6); ENG-2108 Handle GPS dropouts gracefully (#55409, Maps, Working…, Oct 2); ENG-2143 Optimize map tile loading on initial app open (Maps, Oct 7); ENG-2187 Prevent duplicate ride requests on poor networks (Bug, Working…, Oct 5)
  - Todo (4): ENG-2254 Reduce unnecessary map re-rendering on home screen (Low, Maps, Oct 10); ENG-2291 Clean up deprecated APIs used by the rider app (Low, API, Oct 9); ENG-2327 Speed up CI pipelines for mobile builds (Medium, Performance, Oct 9); ENG-2358 Reduce flakiness in mobile UI tests (High, Reliability, Oct 4)
- Illustration 2: a before-and-after diff of `kinetic-ios/src/screens/Home/HomeScreen.tsx`, with a "Linear" selector. Lines 03, 07, 09 and 15 changed.
  - Before:
    ```
    import React from 'react'
    import { View, ActivityIndicator } from 'react-native'
    import { useVehicleState } from '@hooks/useVehicleState'
    import { Dashboard } from '@components/Dashboard'

    export const HomeScreen = () => {
      const { vehicleState, isFullySynced } = useVehicleState()

      if (!isFullySynced) {
        return <ActivityIndicator size="large" />
      }

      return (
        <View>
          <Dashboard state={vehicleState} />
        </View>
      )
    }
    ```
  - After: the same file, using `useVehicleState, SyncStatus`, `const { vehicleState, syncStatus } = useVehicleState()`, `if (syncStatus === SyncStatus.PENDING)`, and `<Dashboard state={vehicleState} syncStatus={syncStatus} />`.
- Features in this area: Issues +, Git automations +, Guided reviews +, Cycles +, Diffs +, Releases +

### What's new: Changelog
The four latest releases, newest first, as a timeline. The newest is marked as the current one.
- Heading: "Changelog"
- "Slack and GitHub loop triggers" — "Loops automate product work by responding to changes in Linear and connected tools. You can now trigger them from Slack and GitHub, share them as templates, and customize their reasoning levels." — Oct 22, 2026
- "Stacked pull requests" — "Stacked pull requests are now displayed in Linear Diffs. Move through a stack and see review, CI, and merge status at a glance. Related PRs are grouped into a single collapsible row in Reviews, alongside their issue and project context." — Oct 8, 2026
- "New controls for Linear coding agent" — "Coding sessions are the shortest path from issue to diff. Assign a task to Linear Agent, and it works in a secure cloud environment to write and test the code before opening a pull request for review." — Sep 24, 2026
- "Loops for product management" — "Loops are recurring agent workflows for teams. They now respond to more workspace activity, including changes to initiatives, projects, and cycles. They can also edit Linear documents and post updates to Slack." — Sep 10, 2026
- Link: "View all →"

### What customers say
Two testimonials, each with its company's logo, then the scale of adoption.
- "You'll probably build a better product, just because of the craft that using Linear infuses on your brain." — Gabriel Peal, Staff Software Engineer, OpenAI
- "Our speed is intense and Linear helps us be action biased." — Nik Koblov, Head of Engineering, Ramp
- "Linear powers over **40,000** product teams. From ambitious startups to major enterprises." (40,000 is the figure that stands out)
- Link: "Customer stories →"

### Closing call to action
- Heading: "Built for the future. Available today."
- Buttons: "Get started" (primary), "Contact sales"

### Footer
- Linear logo
- Product: Intake, Plan, AI, Build, Pricing, Security
- Features: Asks, Agents, Coding Sessions, Customer Requests, Insights, Mobile, Integrations, Changelog
- Company: About, Customers, Careers, Now, Method, Quality, Brand
- Resources: Switch, Download, Documentation, Developers, Status, Enterprise, Startups
- Connect: Contact us, Community, X (Twitter), GitHub, YouTube
- Legal links: Privacy, Terms, DPA, AUP

## Behaviour
- The navigation links lead to other pages. "Log in" and "Sign up" lead to the account. "Loops →", each "Learn more →", "View all →" and "Customer stories →" lead to their detail pages.
- Each "Features" entry has a "+", meaning it expands to reveal more about that feature. All are collapsed in the capture.
- The product screenshots are illustrations, not working controls. The selected favourite in the app is "Faster app launch", and the issue shown is 1 of 84.
- The logo row and the agent conversations run on past the edge of the window. They read as a strip that moves or scrolls sideways.

## Viewports
Designed for a desktop window 1440 wide and a phone 390 wide.

Where the phone's content differs:
- The navigation shows the logo, "Log in", "Sign up" and a menu button. The site links sit behind the menu.
- The three principles (Fig 0.1–0.3) and the two testimonials are swiped through one at a time.
- Each area shows one illustration, placed before its heading:
  - Intake: the Slack thread ending in "@Linear create issues and assign to me".
  - Planning: the roadmap timeline only, from June to August (UI Refresh, Split fares' Internal and Public Beta, Autonomy status clarity's Alpha).
  - AI: an "Assign to…" picker listing Codex (Agent), Steven, Ema, GitHub Copilot (Agent), Cursor (Agent).
  - Build: a short diff of `kinetic-ios/Sources/App/AppBootstrapper.swift` reading "/** * A slow and fragmented code review experience. **/ export const CodeReview = () => { <Diff.Provider> <Slow /> <Fragmented /> <Noisy /> </Diff.Provider> };", with the slow, fragmented and noisy lines marked as removed.
- The "Features" lists, the Changelog and the "40,000 product teams" line do not appear.
- The first testimonial's attribution reads "Gabriel Peal, OpenAI".
- The footer has no logo. It adds a "Legal" heading over Privacy, Terms, DPA, AUP, and lists "Docs" in place of "Documentation".

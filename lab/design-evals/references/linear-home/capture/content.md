<!-- The text and controls of https://linear.app at 1440px, in reading order. -->

Skip to content →
<main>
The product developmentsystem for teams and agents
The product development system for teams and agents
Purpose-built for planning and building products. Designed for the AI era.
New
Loops →
[image: undescribed]
<navigation>
[button: Linear]
[button: Search workspace] [button: New issue]
[button: Pulse] [button: Inbox] [button: My issues] [button: Reviews]
[button: Workspace]
[button: Initiatives] [button: Projects] [button: More]
[button: Favorites]
[button: Faster app launch] [button: Agent tasks] [button: Agent Insights] [button: UI Refresh]
</navigation>
<header>
DRV-8852
Faster app launch
[button: Remove from favorites] [button: Issue options]
1 / 84
[button: Previous issue] [button: Next issue]
</header>
[button: Copy issue URL] [button: Copy issue ID] [button: Copy git branch name]
[button: Delegate to an agent]
[button: More delegation options]
### Faster app launch
Render UI before vehicle_state sync when minimum required state is present, instead of blocking on full refresh during iOS startup.
#### Activity
[image: Avatar of Karri]
Linear created the issue via Slack on behalf of Karri
·
2min ago
Triage Intelligence added the labels Performance and iOS
·
2min ago
[image: Avatar of Karri]
karri
·
4 min ago
Right now we show a spinner forever, which makes it look like the car disappeared...
[image: undescribed]
jori
·
just now
@Linear can you take a stab at this?
[image: undescribed]
Linear
connected by Jori
·
2 min ago
Changed 2 files
Draft PR awaiting your review
·
2 min ago
Linear moved from Todo to In Progress
·
just now
<header>
[image: Linear]
Linear
Opus 5.5
</header>
Fix the dimmed ride rows that never reset and open a PR
DRV-364
added to context
Worked for 10 sec
Pushed and opened a draft PR. Removed dimmedIds — isItemDimmed now checks waitingStatusById directly.
Changed
2 files
+22
−10
Draft
Reset dimmed ride rows
master
←
ride/drv-364-reset-dimmed-rows
Preview
Reply…
Skills
Reviews
Revert
Properties
In Progress
[icon: Medium Priority]
Medium
[image: Avatar of Karri]
Karri
[image: Linear]
Linear
Cycle 144
Labels
[button: Performance] [button: iOS]
Releases
Linear App
1.6881...
⋅
Jun 25
Powering the companies building the future
## A new species of product tool. Purpose-built for modern teams with AI workflows at its core, Linear sets a new standard for planning and building products.
Fig 0.1
Purpose-built
Linear is shaped by the practices and principles of world-class product teams.
Fig 0.2
Powered by agents
Designed for workflows shared by humans and agents. From drafting PRDs to pushing PRs.
Fig 0.3
Designed for speed
Reduces noise and restores momentum to help teams ship with high velocity and focus.
## Intakeand integrations
Automatically turn conversations and customer feedback into actionable issues that are instantly routed, labeled, and prioritized for the right team.
[link: Learn more →]
Backlog
8
[button: Add issue] [button: Open menu]
ENG-2085
Reduce UI flicker during autonomy...
[icon: No Priority]
ENG-2094
Add buffering for autonomy event streams
[icon: No Priority]
ENG-2092
Reduce startup delay caused by vehicle sync
[icon: No Priority]
ENG-2200
Fix delayed route updates during rerouting
[icon: No Priority]
Todo
71
[button: Add issue] [button: Open menu]
ENG-926
[image: undescribed]
Remove UI inconsistencies
[icon: High Priority]
Bug
Design
ENG-2088
[image: undescribed]
TypeError: Cannot read properties
[icon: Medium Priority]
Bug
ENG-924
[image: undescribed]
Upgrade to Claude Opus 5.5
[icon: Low Priority]
AI
ENG-1882
Optimize load times
[icon: No Priority]
Performance
In Progress
3
[button: Add issue] [button: Open menu]
ENG-1487
[image: undescribed]
Remove contentData from GraphQL API
[icon: Medium Priority]
61039
MKT-1028
[image: undescribed]
Launch page assets
[icon: Medium Priority]
Design
ENG-2187
[image: undescribed]
Prevent duplicate ride requests on poor...
[icon: High Priority]
Bug
62048
Done
53
[button: Add issue] [button: Open menu]
ENG-2074
Clean up deprecated APIs...
[icon: Medium Priority]
API
61002
ENG-1912
Reduce latency in autonomy st...
[icon: Low Priority]
61005
ENG-1951
Reduce ETA fluctuations durin...
[icon: Medium Priority]
61202
ENG-1960
Improve fallback messaging
[icon: Medium Priority]
UI
61149
ENG-1991
Improve rider visibility into veh...
[icon: Medium Priority]
<header>
Thread
#product
</header>
[image: didier]
didier
4:21 PM
Has anyone been looking into the iOS startup performance issues?
[image: lena]
lena
4:21 PM
Anyone else noticing the iOS app feels slow to open if you haven’t used it in a bit?
[image: didier]
didier
4:21 PM
Yea, we’re still blocking initial render on a full vehicle_state sync every time…
[image: andreas]
andreas
4:21 PM
Feels like we could render sooner and load the rest in the background. Probably also worth tracking startup timing so we know how often this happens!
@Linear
create issues and assign to me
[button: Attach file] [button: Hide formatting] [button: Emoji] [button: Mention someone]
[button: Record video clip] [button: Record audio clip]
[button: Run shortcut]
[button: Send message]
[button: Schedule for later]
Features
[button: Linear Agent +]
[button: Customer Requests +]
[button: Triage +]
[button: Linear Asks +]
## Planningand monitoring
Plan and navigate from idea to launch. Align your team with product initiatives, strategic roadmaps, and clear, up-to-date PRDs.
[link: Learn more →]
MAR
APR
MAY
JUN
JUL
AUG
SEP
2
9
16
23
6
13
20
27
4
11
18
25
1
8
15
22
6
13
20
27
3
10
17
24
7
14
21
28
UI Refresh
Core screens
Polish
Split fares
Internal
Public Beta
Autonomy status clarity
Alpha
Autonomy telemetry reliability
Beta
GA
<header>
Cycle time by agent
</header>
Oct 2025
Nov 2025
Dec 2025
Jan 2026
Feb 2026
Features
[button: Projects +]
[button: Documents +]
[button: Pulse +]
[button: Initiatives +]
[button: Visual planning +]
[button: Insights +]
## AI andautomations
Build and deploy AI agents that work alongside you as teammates. Work on complex tasks together or delegate entire issues end-to-end.
[link: Learn more →]
<header>
[image: Linear]
Linear
Opus 5.5
</header>
what are the three most important customer requests around permissions? add them to the Access Controls project
Worked for 8 sec
Three issues ranked by customer impact:
[icon: Urgent Priority]
ENG-2298
Add granular project permissions
[icon: Medium Priority]
ENG-2647
Let guests access multiple teams
[icon: High Priority]
ENG-2352
Create custom roles with scoped access
I’ve added them to
Access Controls
<header>
Cursor
</header>
add retry handling for failed image uploads described in this issue
ENG-2844
added to context
Thinking...
Started working on
ENG-2844
Failed image upload
and launched a cloud agent.
Setting up DRV/rideshare-app…
00:07
<header>
[image: Linear]
Linear
Opus 5.5
</header>
Review today’s mobile triage and group the issues by what should happen next
Mobile Triage
added to context
Worked for 12 sec
Reviewed eight issues: two are ready for backlog, two need details, and four belong to iOS or Android.
Backlog · 2
[icon: High Priority]
ENG-2521
Missing inbox status colors
[icon: High Priority]
ENG-2364
Notifications after logout…
Needs information · 2
[icon: No Priority]
ENG-2557
Deep links discard issue drafts
[icon: No Priority]
ENG-2362
Open PRs from mobile diffs
<header>
[image: ChatPRD]
ChatPRD
</header>
review this issue, draft complete offline mode requirements, and break the work into sub-issues
ENG-2521
added to context
Worked for 1 min
Updated the issue with requirements, open product decisions, and acceptance criteria.
[icon: High Priority]
ENG-2920
Define offline mode requirements
Features
[button: Linear Agent +]
[button: Coding sessions +]
[button: Triage +]
[button: Linear MCP +]
## Build, review,and ship
Streamline code reviews with clear diffs, better context, and fewer back-and-forth comments. Keep PRs moving without sacrificing quality.
[link: Learn more →]
In Review
3
[button: ENG-2498 Replace isFullySynced with a sync status #54910 iOS Oct 9] [button: ENG-2380 Show a stale data banner while syncing #55167 Reliability Oct 9] [button: ENG-2039 Pass sync status to the dashboard #55209 Bug Reliability Oct 8]
In Progress
4
[icon: Medium Priority]
ENG-2076
Reduce ETA jitter
#55423
Performance
Working…
Working…
[image: undescribed]
[image: undescribed]
Oct 6
[icon: Medium Priority]
ENG-2108
Handle GPS dropouts gracefully
#55409
Maps
Working…
Working…
[image: undescribed]
[image: undescribed]
Oct 2
[icon: High Priority]
ENG-2143
Optimize map tile loading on initial app open
Maps
[image: undescribed]
Oct 7
[icon: No Priority]
ENG-2187
Prevent duplicate ride requests on poor networks
Bug
Working…
Working…
[image: undescribed]
[image: undescribed]
Oct 5
Todo
4
[icon: Low Priority]
ENG-2254
Reduce unnecessary map re-rendering on home screen
Maps
[image: undescribed]
Oct 10
[icon: Low Priority]
ENG-2291
Clean up deprecated APIs used by the rider app
API
[image: undescribed]
Oct 9
[icon: Medium Priority]
ENG-2327
Speed up CI pipelines for mobile builds
Performance
[image: undescribed]
Oct 9
[icon: High Priority]
ENG-2358
Reduce flakiness in mobile UI tests
Reliability
[image: undescribed]
Oct 4
kinetic-ios/src/screens/Home/HomeScreen.tsx
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
import React from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useVehicleState, SyncStatus } from '@hooks/useVehicleState'
import { Dashboard } from '@components/Dashboard'
export const HomeScreen = () => {
const { vehicleState, syncStatus } = useVehicleState()
if (syncStatus === SyncStatus.PENDING) {
return <ActivityIndicator size="large" />
}
return (
<View>
<Dashboard state={vehicleState} syncStatus={syncStatus} />
</View>
)
}
[field: Edit code lines = import React from 'react' import { View, ActivityIndicator } from 'react-native' import { useVehicleState, SyncStatus } from '@hooks/useVehicleState' import { Dashboard } from '@components/Dashboard' export const HomeScreen = () => { const { vehicleState, syncStatus } = useVehicleState() if (syncStatus === SyncStatus.PENDING) { return <ActivityIndicator size="large" /> } return ( <View> <Dashboard state={vehicleState} syncStatus={syncStatus} /> </View> ) }]
[combobox: Linear] [field: text = 0]
Features
[button: Issues +]
[button: Git automations +]
[button: Guided reviews +]
[button: Cycles +]
[button: Diffs +]
[button: Releases +]
## Changelog
Slack and GitHub loop triggers
Loops automate product work by responding to changes in Linear and connected tools. You can now trigger them from Slack and GitHub, share them as templates, and customize their reasoning levels.
Oct 22, 2026
Stacked pull requests
Stacked pull requests are now displayed in Linear Diffs. Move through a stack and see review, CI, and merge status at a glance. Related PRs are grouped into a single collapsible row in Reviews, alongside their issue and project context.
Oct 8, 2026
New controls for Linear coding agent
Coding sessions are the shortest path from issue to diff. Assign a task to Linear Agent, and it works in a secure cloud environment to write and test the code before opening a pull request for review.
Sep 24, 2026
Loops for product management
Loops are recurring agent workflows for teams. They now respond to more workspace activity, including changes to initiatives, projects, and cycles. They can also edit Linear documents and post updates to Slack.
Sep 10, 2026
[link: View all →]
You’ll probably build a better product, just because of the craft that using Linear infuses on your brain.
Gabriel Peal
Staff Software Engineer, OpenAI
Our speed is intense and Linear helps us be action biased.
Nik Koblov
Head of Engineering, Ramp
Linear powers over 40,000 product teams. From ambitious startups to major enterprises.
Customer stories
→
## Built for the future. Available today.
[button: Get started] [button: Contact sales]
</main>
<footer>
[icon: Linear Logo]
### Product
- [link: Intake]
- [link: Plan]
- [link: AI]
- [link: Build]
- [link: Pricing]
- [link: Security]
### Features
- [link: Asks]
- [link: Agents]
- [link: Coding Sessions]
- [link: Customer Requests]
- [link: Insights]
- [link: Mobile]
- [link: Integrations]
- [link: Changelog]
### Company
- [link: About]
- [link: Customers]
- [link: Careers]
- [link: Now]
- [link: Method]
- [link: Quality]
- [link: Brand]
### Resources
- [link: Switch]
- [link: Download]
- [link: Documentation]
- [link: Developers]
- [link: Status]
- [link: Enterprise]
- [link: Startups]
### Connect
- [link: Contact us]
- [link: Community]
- [link: X (Twitter)]
- [link: GitHub]
- [link: YouTube]
Privacy
Terms
DPA
AUP
</footer>

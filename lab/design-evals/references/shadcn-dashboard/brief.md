# Acme Inc.: documents dashboard

## Purpose
A team member at Acme Inc. opens this screen to check the business at a glance (revenue, customers, accounts, growth, visitor traffic) and then work through the sections of a document they are putting together, tracking each section's status, targets and reviewer. The primary action is Quick Create, and on the document outline it is Add Section.

## Content

### Product and navigation
Who the workspace belongs to, and where the user can go in the app.
- Workspace name: **Acme Inc.**
- Primary action: **Quick Create**, next to an **Inbox** button (shown as an icon)
- Main navigation: Dashboard, Lifecycle, Analytics, Projects, Team
- A group headed **Documents**: Data Library, Reports, Word Assistant, More. Each document entry has its own "More" options button.
- Secondary navigation: Settings, Get Help, Search
- Signed-in user: avatar photo, name **shadcn**, email **m@example.com**, with an account menu button

### Page header
Which page this is, plus a control to hide the navigation.
- Toggle Sidebar button
- Page title: **Documents**
- Link: **GitHub**

### Key metrics
Four headline numbers, each with its change, a one-line reading of the trend and a supporting note.
1. **Total Revenue**: $1,250.00, change +12.5% (up). "Trending up this month" (up). "Visitors for the last 6 months"
2. **New Customers**: 1,234, change -20% (down). "Down 20% this period" (down). "Acquisition needs attention"
3. **Active Accounts**: 45,678, change +12.5% (up). "Strong user retention" (up). "Engagement exceed targets"
4. **Growth Rate**: 4.5%, change +4.5% (up). "Steady performance increase" (up). "Meets growth projections"

### Visitor traffic
Visitor traffic over time, with a choice of time range.
- Heading: **Total Visitors**
- Subtitle: "Total for the last 3 months"
- Range options: **Last 3 months** (selected), Last 30 days, Last 7 days
- Chart: daily visitors from early April to June 30, drawn as two unnamed series plotted together, one consistently larger than the other. The date axis reads Apr 7, Apr 13, Apr 19, Apr 26, May 2, May 8, May 14, May 21, May 28, Jun 3, Jun 9, Jun 15, Jun 22, Jun 30. Traffic swings sharply from day to day, with no steady trend. The larger series hits its highest peaks around May 5, May 13–15 and several times in late June (around Jun 18, Jun 24 and Jun 29). Its lowest days are scattered through mid-April, early May and early June. The smaller series follows the same rhythm at roughly half the height. There is no value scale and no legend.

### Document outline
The sections of the document being prepared: what type each is, where it stands, its target and limit, and who reviews it.
- Views (tabs): **Outline** (selected), **Past Performance** (count 3), **Key Personnel** (count 2), **Focus Documents**
- Actions: **Customize Columns** (a menu), **Add Section**
- Columns: drag handle, select-row checkbox (a select-all checkbox in the header), Header, Section Type, Status, Target, Limit, Reviewer, row menu ("Open menu")
- Rows (page 1):

| Header | Section Type | Status | Target | Limit | Reviewer |
|---|---|---|---|---|---|
| Cover page | Cover page | In Process | 18 | 5 | Eddie Lake |
| Table of contents | Table of contents | Done | 29 | 24 | Eddie Lake |
| Executive summary | Narrative | Done | 10 | 13 | Eddie Lake |
| Technical approach | Narrative | Done | 27 | 23 | Jamik Tashpulatov |
| Design | Narrative | In Process | 2 | 16 | Jamik Tashpulatov |
| Capabilities | Narrative | In Process | 20 | 8 | Jamik Tashpulatov |
| Integration with existing systems | Narrative | In Process | 19 | 21 | Jamik Tashpulatov |
| Innovation and Advantages | Narrative | Done | 25 | 26 | Assign reviewer (a picker, none set) |
| Overview of EMR's Innovative Solutions | Technical content | Done | 7 | 23 | Assign reviewer (a picker, none set) |
| Advanced Algorithms and Machine Learning | Narrative | Done | 30 | 28 | Assign reviewer (a picker, none set) |

- Selection summary: "0 of 68 row(s) selected."
- Rows per page: 10 (a picker)
- "Page 1 of 7"
- Pagination: Go to first page, Go to previous page, Go to next page, Go to last page

## Behaviour
- Quick Create starts a new item. Inbox opens messages.
- Toggle Sidebar shows and hides the navigation.
- Each document entry's More button and the user's account button open menus.
- The range options switch the visitor chart between the last 3 months, the last 30 days and the last 7 days. Last 3 months is selected on desktop.
- The tabs switch the table between Outline, Past Performance (3), Key Personnel (2) and Focus Documents. Outline is selected.
- Customize Columns opens a menu for choosing which columns show. Add Section adds a row.
- Rows can be dragged by their handle to reorder sections. Checkboxes select rows one at a time or all at once, and the selection count updates (none selected now).
- Rows with no reviewer offer an "Assign reviewer" picker. Each row's menu offers further actions.
- Rows per page sets the page size. The four pagination buttons move through the 7 pages.

## Viewports
Designed for a desktop window 1440 wide and a phone 390 wide.

On the phone:
- The navigation is hidden behind the Toggle Sidebar button, and the GitHub link does not appear.
- The visitor chart's subtitle reads "Last 3 months". Its range is a single picker set to **Last 7 days**, so the chart shows only the last week, with the axis reading Jun 24, Jun 26, Jun 28, Jun 30. Both series dip around Jun 25, peak around Jun 27, dip again around Jun 29 and rise toward Jun 30.
- The table's views are a single picker showing **Outline**. "Customize Columns" is shortened to **Columns**, and Add Section is a "+" button.
- The table shows only the drag handle, the checkbox and the Header column.
- Pagination shows only "Page 1 of 7" with previous and next. The selection count and the rows-per-page picker do not appear.

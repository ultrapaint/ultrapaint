You are writing a design brief from a page someone made well. A design agent will design the page
from your brief alone, and a judge will compare its design with this one. This brief hands the
agent the page's facts and none of its words: the agent writes every heading, line of copy and
button label itself, so what it writes by habit can be seen.

The page: {{name}}, a {{kind}}. Its capture is in this directory; read every file:

{{files}}

`*-fold.jpg` is what a window shows before scrolling; `*-01.jpg` onwards is the whole page, top to
bottom; `zoom-*.jpg` are parts of the fold enlarged, where its small text can be read; `content.md`
is its text and controls in reading order.

A shot from a gallery is presented: the page may sit on a backdrop, in a browser window or on a
device, or be cut off at an edge. Describe the page alone, as far as it shows; leave out the
backdrop, the window and the device, and do not complete what the picture cuts off.

Write the brief in markdown, in this form:

    # <the product, and what this page is: "Acme: landing page">

    ## Purpose
    Who the page is for and what it should get them to do, in two or three sentences: the one
    thing it is for, and its primary action.

    ## Facts
    What the page has to tell, in its order, grouped by purpose ("what the product does", "proof
    that others use it", "the plans"). Each group: its purpose in one sentence, then its facts as
    plain statements: what the product does and for whom, features and what each does, figures
    with their units, names of customers, people and plans, prices, quotes as the facts they
    report ("a nurse at St Mary's says it halved the time charts take"), the links the navigation
    and the footer offer, the fields a form asks for. Keep names, numbers and prices exact.

    ## Behaviour
    What the controls do, as far as the capture shows.

    ## Viewports
    Designed for {{viewports}}.

Hand no words of the page: no heading, tagline, eyebrow or label over a section, no button or link
wording, no phrase in quotation marks except a person's quote, and no adjective the page uses to
sell itself. Say what each part has to convey, not how the page says it ("the main action: join
the waitlist", not its button's words). Do not list the page's small labels over sections at all;
if one carries a fact (a date, a release), give the fact.

Everything visual is left out too, since it is what the agent is tested on: colour, type, size,
weight, spacing, alignment, columns, grids, position on the page, cards, panels, heroes, imagery
style, light or dark. A picture is described by its subject ("a screenshot of the app's issue
list"); a chart by what it plots and its data.

Text you cannot read in a picture: write your closest reading and mark it [unclear]. Return the
brief as `brief`.

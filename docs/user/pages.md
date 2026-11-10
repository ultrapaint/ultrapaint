# Pages, URLs and canvases

A **page** is a `.page.json` file in a canvas, named after its file: "Billing settings" is
`billing-settings.page.json`. Renaming a page moves the file and keeps everything that points to
it. Nodes placed on the canvas outside any page are kept in the canvas's `canvas.json`.

A page may serve a **URL** in the prototype (`/settings/billing`, `/invoices/:id`), which
`canvas.json` keeps. A screen of the application has one; a sketch or a sheet of components needs
none. A page without a URL is drawn and edited like any other, but no link reaches it, and the
prototype warns when it shows one. A canvas made before URLs were optional serves each page at
the route its path names until its pages next change.

**Prototype**, in the place switch at the top (⌃2 on a Mac, Alt+2 elsewhere), clicks through the
canvas. Its left panel is **Pages**: every page of the canvas with its URL, or **No URL**; a click
opens one. A page's URL is given, changed and taken off in its menu on the canvas (**Set URL…**,
**Change URL…**, **Remove URL**) or in the inspector's **Page** section. Any node in a page can link
to another page (it keeps leading there when the page is renamed or its URL changes), to a URL with
its parameters, back, or to another site: in the inspector, its right-click menu or the selection's
bar. The prototype's bar, at the bottom, has **Back**, **Forward** and **Restart**, the URL, the
device it is tried on (a phone, a tablet or a desktop, without changing the design), **Show
hotspots** for what can be pressed (a press on nothing flashes it too), and **Comment** for the page
you are on. The prototype is one frame: pressing a link swaps the page inside it, and the route is
in the editor's own URL, so the browser's back and forward buttons are the prototype's, and a
prototype state can be reloaded or pasted to someone else.

A page can be drawn again for a **page variant** of its canvas: **Draw a variant**, in its menu,
draws it as `pricing@bold.page.json` (**New variant…** names a new one), at the same URL. The
prototype's bar picks the variant it clicks through, **No variant** for the base pages. A link
copied from a variant's page carries `variant=`, so it opens on that variant, and the element ID
copied for an agent names the variant's file (`pricing@bold.page.json#c_1`), where a URL alone
names the base page.

A **canvas** owns one router and its own pages; a page of one canvas cannot navigate to a page of
another. The canvas shown is named under the project, at the top left, in **Canvas** and the
prototype; it opens the list of canvases over the left panel, with **New canvas** and **Import a
Figma file…**.

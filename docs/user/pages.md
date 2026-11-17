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

A page, or anything on it, can have **variations**: other ways to draw it, kept with it in
`pricing.variations.json` beside the page. The inspector's **Variations** section lists them;
its **+** copies the one in use to edit by hand, and **Make variations…** (in the right-click menu,
or Ask an agent's **Variations** control) has an agent make 2, 3 or 4. They are laid out beside
the page, the page itself showing the one you pick, with **Use this** under it to put it in use;
a double-click picks one part of a variation to put in instead. The prototype shows each page
as its variations in use draw it. Page variants from before (`pricing@bold.page.json`) are
variations of their page now, and an old link with `variant=bold` opens the page with Bold
shown.

A **canvas** owns one router and its own pages; a page of one canvas cannot navigate to a page of
another. The canvas shown is named under the project, at the top left, in **Canvas** and the
prototype; it opens the list of canvases over the left panel, with **New canvas** and **Import a
Figma file…**.

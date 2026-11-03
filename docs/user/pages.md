# Pages, URLs and canvases

A **page** is a `.page.json` file in a canvas, named after its file: "Billing settings" is
`billing-settings.page.json`. Renaming a page moves the file and keeps everything that points to
it. Nodes placed on the canvas outside any page are kept in the canvas's `canvas.json`.

A page may serve a **URL** in the prototype (`/settings/billing`, `/invoices/:id`), which
`canvas.json` keeps. A screen of the application has one; a sketch or a sheet of components needs
none. A page without a URL is drawn and edited like any other, but no link reaches it, and the
prototype warns when it shows one. A canvas made before URLs were optional serves each page at
the route its path names until its pages next change.

The **Pages** panel belongs to the **prototype**: every page of the canvas with its URL,
or a warning when it has none, where URLs are given, changed and taken off. Any node in a page can
link to another page (it keeps leading there when the page is renamed or its URL changes), to a
URL with its parameters, back, or to another site: in the inspector, its right-click menu or the
element toolbar. The prototype's bar shows what can be pressed, and a press on nothing flashes it. It also tries the
prototype on a phone, a tablet or a desktop without changing the design, and takes comments on the
page you are on. In the prototype the whole thing is one iframe: pressing a link swaps the page inside it,
provider and component state survives, and the route is in the editor's own URL — so the
browser's back and forward buttons are the prototype's, and a prototype state can be reloaded or
pasted to someone else.

A **canvas** owns one router and its own pages; a page of one canvas cannot navigate to a page of
another. The canvas's name at the top of the left panel opens the list of canvases.

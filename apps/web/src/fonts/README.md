# Allo at 20 roundness

`AlloVariable-ROND20.woff2` is Allo 1.0.3's variable font (`fonts/webfonts/AlloVariable.woff2`
in the `allo-font` package, https://allo.joshpuckett.me) with its roundness axis pinned at 20 of
0–100, the editor's (ADR 0135). Its weight (100–900) and optical size (9–32) stay variable. Pinned in
the file, the roundness holds in every browser and reaches no other text, as a
`font-variation-settings` would. Allo is under the SIL Open Font License 1.1, in `OFL.txt`; the
file keeps its copyright and licence in its name table.

Made with fontTools:

```sh
fonttools varLib.instancer AlloVariable.woff2 ROND=20 -o AlloVariable-ROND20.woff2
```

To change the roundness or take a newer Allo, make it again from the package's file.

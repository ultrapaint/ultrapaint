# From another machine

`ultrapaint --host <address>` listens on that address instead of loopback: this machine's
address on a private network such as Tailscale, or `0.0.0.0` for every interface. The command
prints the addresses the editor is reachable at. The editor and its backend are served on that
one port. `--dev` stays on loopback as well; with `--host` the editor's dev server listens on
that address too.

The server answers only requests that name it by one of its own names, so that a website you
have open cannot reach it by pointing its own name at your machine. Those are the address it
listens on, or with `0.0.0.0` any address the machine has at the time (a network joined later
included), its host name and `<host name>.local`. A name it has elsewhere (a MagicDNS name, a
fully qualified one, a reverse proxy's) is given with `--allowed-host`, once per name. With
`--dev` the editor's dev server keeps Vite's own check, which knows nothing of these names.

There is no login. Whoever reaches that port can run agents in the repository with your rights,
so keep it to a private network and prefer the network's own address over `0.0.0.0`.

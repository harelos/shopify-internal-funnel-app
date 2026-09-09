# Reproduce the core checks

Requirements: Node.js 20+.

```sh
node extract.cjs
node --test tests/core.test.cjs
```

The extraction script produces the exact core, controller, CSS and manifest from index.html without any network or deployment action.

For a simple local static preview:

```sh
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/index.html?variant=variant-b`.

The full development archive supplied with the chat includes the Chromium fixture suite, local-only Node QA server, synthetic HTTP tests, and their output. Do not run production app deployment commands or point this preview at a live app proxy.

The late-response selector is an explicit scenario simulation, not a real live backend call. Full app integration remains unimplemented. This preview isolates the renderer and selection design for review.

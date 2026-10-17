# Management UI

The React, TypeScript, and SCSS source files in this directory are the maintained
management frontend for this repository. Edit them directly under `src/`.
The backend is in the parent directory and exposes the v8 Management API.

The initial source was imported from
[CLI Proxy API Management Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) revision
`fe2963330f32a933f562282165f62ae52cf57145`, with the customized account quota cards
and aligned sections included. Upstream attribution is preserved in `LICENSE`.

Use Bun 1.3.14 (pinned in `package.json`) and Node.js 24:

```sh
cd management-ui
bun install --frozen-lockfile
bun run dev
```

Vite serves the development app at `http://localhost:5173`. Connect it to the
running proxy through the login screen's custom connection URL. Runtime
credentials must never be committed to this directory.

Run checks and build the single-file production artifact:

```sh
bun run verify
```

This runs the tests, lint, TypeScript compilation, and Vite build. The output is
`dist/index.html`; dependencies and generated artifacts are ignored by Git.
For individual checks, use `bun run test`, `bun run lint`, `bun run type-check`,
or `bun run build`.

The root Dockerfile installs dependencies from the frozen `bun.lock`, runs the
same verification, and copies `dist/index.html` into the image as
`/CLIProxyAPI/static/management.html`. `VERSION` uses the same Docker build
argument as the backend. After dependency installation, Docker runs the tests and
build with networking disabled, using only this checkout's source.

The Mac Compose bundle serves `/CLIProxyAPI/static` and sets
`MANAGEMENT_DISABLE_AUTO_UPDATE=true`, keeping the customized panel versioned and
rolled back with the image. The Docker image uses the same defaults. Host
binaries retain normal updater behavior unless this variable is set; setting it
to `false` explicitly re-enables asset downloads.

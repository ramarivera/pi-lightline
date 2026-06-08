# @ramarivera/pi-lightline

Lightweight Pi statusline, shell command, prompt history, and working-message extension.

This is a lean replacement path for the heavier `pi-powerline-footer` workflow. Startup work stays tiny:

- registers commands and lifecycle hooks only
- does not scan Pi session files at activation
- does not read shell history until `/shell-history`
- does not import `pi-ai` or call a model for working text
- uses Pi's native `ctx.ui.setStatus()` and `ctx.ui.setWorkingMessage()` APIs

## Install

```sh
pi install npm:@ramarivera/pi-lightline@0.0.1
```

## Commands

```text
/shell <command>
/shell-history
/prompt-history
```

`/shell <command>` runs the command on demand and records successful command text in a small history file under `~/.pi/agent/lightline/`.

`/shell-history` reads that file only when invoked, lets you pick a command, and inserts `/shell <command>` into the editor.

`/prompt-history` reads the current in-memory Pi session only when invoked, lets you pick a recent user prompt, and inserts it into the editor.

During agent runs, the working message rotates through a static list of short English verbs such as `Working...`, `Thinking...`, and `Reading...`.

## Local Development

This checkout is live-enabled for Pi through:

```text
.pi/extensions/lightline/index.ts
```

That shim imports the package entrypoint in `src/index.ts`, which imports the extension factory from `src/extension.ts`. Tests use the same symbol so local behavior, package behavior, and manual Pi behavior do not drift.

```sh
npm install
npm run check
npm test
npm run test:e2e
npm pack --dry-run
```

## Publishing

Publishing uses GitHub Actions trusted publishing in `.github/workflows/publish.yml`.

Before the first publish, configure npm trusted publishing:

- owner/repo: `ramarivera/pi-lightline`
- workflow: `.github/workflows/publish.yml`
- environment: blank unless the workflow is changed to require one

No `NPM_TOKEN` is required for trusted publishing.

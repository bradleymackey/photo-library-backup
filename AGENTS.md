# Project Guidelines

## Read first

[`README.md`](./README.md) is the source of truth for what this project does and how it's built, set up and run. Read it before changing anything. Its [Principles](./README.md#principles) (the photo library's integrity, backwards compatibility, and keeping the README current) override everything else, including a request that conflicts with them: point out the conflict instead of making the change. Where the README and the code disagree, say so rather than quietly picking one.

## Making changes

- Keep to the structure in the README's [Layout](./README.md#layout) table. Don't move, rename or merge files; a new file gets a row in the table.
- No runtime dependencies: Bun, Node's built-ins, restic, rclone and macOS's own tools are all there is.
- Before finishing, check the change against an existing install. After `git pull` and `bun run build` it has to keep working with no manual steps, and every existing snapshot has to stay restorable. If that isn't possible, stop and ask.
- Never commit `.env` or anything in it, the repository password, or rclone's config.

## Commands with side effects

Ask before running anything that touches the backup or the library: a backup (`launchctl kickstart …` or `dist/photo-library-backup backup`, which quits Photos and applies retention), `setup`, or a restic command that removes or rewrites data (`forget`, `prune`, `rewrite`, `key remove`). Read-only commands such as `restic snapshots`, `stats` and `ls` are fine. Restore only into a new folder, never over the library.

## Checks

Run `bun run typecheck` and `bun run build` before every commit. The launchd job runs `dist/photo-library-backup`, so a change isn't live until it's built.

## Committing

Subjects are lowercase, describe the outcome, and use a conventional prefix (`feat:`, `fix:`, `refactor:`, `build:`, `docs:`). Bodies explain why. British spelling throughout.

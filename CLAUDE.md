# CLAUDE.md

See [AGENTS.md](./AGENTS.md) — it is the single source of project instructions
for all coding agents.

Before structural work, read AGENTS.md §8: it lists the subsystems that are
still doubled on purpose. [refactor.md](./refactor.md) holds the open note on
composition timing ownership.

Two rules worth repeating here because they are violated most often:

- **Every subsystem must be observable via debug channels.** Never write a bare
  `console.log` into `src/`; use `debug.<channel>(...)`. See AGENTS.md §3.
- **Do not modify flock.** See AGENTS.md §8.

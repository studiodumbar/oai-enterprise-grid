# CLAUDE.md

See [AGENTS.md](./AGENTS.md) — it is the single source of project instructions
for all coding agents.

Before structural work, also read [REFACTOR_PLAN.md](./REFACTOR_PLAN.md).

Two rules worth repeating here because they are violated most often:

- **Every subsystem must be observable via debug channels.** Never write a bare
  `console.log` into `src/`; use `debug.<channel>(...)`. See AGENTS.md §3.
- **Do not modify flock.** See AGENTS.md §8.

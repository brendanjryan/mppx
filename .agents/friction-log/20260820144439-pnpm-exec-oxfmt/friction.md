---
title: 'pnpm exec oxfmt invokes IDE-only wrapper'
severity: 'minor'
---

## Expected Behavior

`pnpm exec oxfmt --check <file>` runs the installed formatter CLI.

## Current Behavior

The command resolves to an IDE-extension wrapper and exits after directing users to `vp fmt`.

## Possible Solution

Expose the actual formatter CLI under `oxfmt`, or document `pnpm exec vp fmt` as the repository formatter entrypoint.

## Minimal Reproducible Example

Run `pnpm exec oxfmt --check .changeset/witty-doors-wave.md`.

## Context

Encountered while fixing a formatting-only failure on main.

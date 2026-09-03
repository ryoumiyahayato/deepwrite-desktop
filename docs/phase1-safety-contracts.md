# Phase 1 Safety Contracts

This file records the release-critical invariants established by the Phase 1 hardening work. It is intentionally narrower than the product roadmap.

## Document lifecycle

- New, Open, Open Recent, external `.dwrite` handoff, and window close must not replace a dirty or failed-save document without an explicit Save / Discard / Cancel decision.
- Autosave completion may mark the UI saved or clear recovery only when it still belongs to the current document session generation.
- Crash recovery is document/path aware rather than a single global recovery slot.
- Saving an existing `.dwrite` is compare-and-swap guarded against external modification.

## AI authority and privacy

- AI output is non-authoritative until the user explicitly accepts or inserts it.
- Replacement suggestions fail closed on document/revision mismatch, ambiguous anchors, invalid structured positions, or exact source-text mismatch.
- Continuation generation is a separate insertion flow and cannot be inserted after the source revision changes.
- Ordinary AI actions use bounded selection/recent context.
- Logic review, contradiction detection, and character-consistency review are full-document diagnostics. Before any diagnostic request is sent, the user must see and confirm the exact overlapping batch plan that will be sent to the configured DeepSeek API. Cancelling the disclosure sends nothing for that run.
- DeepWrite does not persist AI request bodies in suggestion history and does not send document content to the project maintainer.

## Single-instance handoff

- A second process does not rely on a renderer event as the authoritative carrier of a `.dwrite` path.
- The running Rust process first enqueues the path in a FIFO. The event is only a wake-up signal.
- The renderer installs its listener and then drains the FIFO, so a second launch that occurs before React mounts remains recoverable.

## Release validation

The merge gate is the normal repository CI on the final user-authored head: TypeScript typecheck, ESLint, Vitest, Windows bundle validation, production web build, Windows `cargo test`, and Windows `cargo check` must all pass before merging.

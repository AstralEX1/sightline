# ADR 0001: Trade authorization and G2 lifecycle

- Status: Accepted
- Date: 2026-11-27

## Context

Trade Shortcuts renders proposals on Even G2 and sends exchange writes through the server. The app runs inside a host that uses the same foreground events for page lifecycle, exit confirmation, and its contextual menu. The device may also repeat physical events, and network timeouts can leave the result of a write uncertain.

## Decisions

### Exchange writes require a current, explicit proposal confirmation

The executor is the only module that writes to the exchange. A confirmation consumes and persists the proposal and its idempotency key before awaiting anything, serializes writes for the affected position or order, revalidates current state, and records intent before sending. A repeated key returns the original execution. If a request may have reached Bybit but its result is unknown, the server does not retry it; reconciliation is the only path that resolves that state.

Open and Increase proposals first show a Review page. A visible action must be selected to confirm; Dismiss is the initial choice. Stale exchange data removes the confirm action. A close raised from the menu or voice follows the same proposal and confirmation path. A lost response is reported as uncertain and directs the user to check Bybit, never as “not sent.”

### Spoken confirmation is cancellable

A spoken “yes” starts a visible countdown before confirmation. A gesture or “no” cancels it. Voice phrases that open a proposal do not themselves write to the exchange. This adds time to catch a transcription error while preserving the same explicit proposal gate as a tap.

### G2 lifecycle events depend on the current exit state

The host’s foreground events are also used by its exit dialogue and contextual menu. While the exit dialogue is opening, `ENTER` means the page has already been cleared; while it is open, `ENTER` means the user declined and the page must be rebuilt. Outside that dialogue, `ENTER` can mean the contextual menu opened, so the app redraws changed content without rebuilding and closing the menu. `SYSTEM_EXIT` means the user accepted exit. Duplicate physical transitions are ignored within the dedupe window, which only advances when an event is accepted.

### The sandbox cannot write to a live exchange

The sandbox uses the real phone UI and server logic with a simulated host, lens, and fake exchange. Market behavior such as candles, fills, stops, liquidation, and fees is simulation behavior. It is for exercising the app flow and does not establish live exchange or physical-device behavior.

### Rule combinations are constrained by available evidence

The condition/action matrix separates always-allowed combinations from those requiring runtime guards and unsupported combinations. Stacking is symmetric: `B` means AND/OR, `O` means OR only, `A` means AND only, `V` means the same metric, and `-` means unsupported because no common scope or usable live position exists. A LOSS may increase a position only with the stop and one-shot guards; a volume spike cannot choose a direction for an open or add; funding can close before payment or notify; a closed-position event can only notify.

## Consequences

- An uncertain write blocks conflicting actions until reconciliation; it is never blindly resent.
- The lens can safely recover from an exit dialogue or menu without losing the menu to an unnecessary rebuild.
- Speech recognition and device gestures remain outside the exchange authorization boundary.
- The sandbox demonstrates the production UI path while keeping exchange writes simulated.
- Rule authoring remains limited to combinations the server can evaluate and recheck safely.

## Source paths

- `server/src/execute.ts`
- `server/src/session.ts`
- `server/src/rules.ts`
- `app/src/main.ts`
- `app/src/lifecycle.ts`
- `app/src/view.ts`
- `site/sandbox/src/`

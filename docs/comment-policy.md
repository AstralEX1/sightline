# Comment policy

Run `npm run lint:comments` to check the comment ratchet. Existing comment fingerprints in `.comment-baseline.json` are grandfathered; deleting comments is always allowed, while adding or changing one fails the check. TypeScript triple-slash compiler directives are excluded.

To add a comment exception, explain why it cannot be expressed in code or an ADR, then update the baseline with `node scripts/lint-comments.mjs --write-baseline` in the same reviewed change. The baseline stores per-file fingerprints and counts, not comment text.

The ratchet permits incremental cleanup. It does not declare the grandfathered comments acceptable or exempt them from later review.

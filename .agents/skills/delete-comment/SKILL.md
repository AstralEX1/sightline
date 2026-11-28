---
name: delete-comment
description: Audit code comments, remove tautologies and stale notes, move decisions to ADRs, and track implementation excuses.
---

# Delete Comment

Use this skill when asked to review or clean comments in all or part of a repository.

1. Resolve the requested scope and read its `AGENTS.md`. In indexed repositories, use CodeGraph before locating or reading source. Enumerate comments in source files, including inline, block, JSX, CSS, HTML, and configuration comments; ignore comment-like text inside strings.
2. Classify each comment as one of:
   - **Tautology:** repeats behavior or data already clear from nearby code. Delete it.
   - **Stale:** points to removed code or outdated implementation details. Delete it.
   - **Excuse:** explains a shortcut, approximation, or knowingly incomplete implementation. Delete it and file or update one focused issue listing the missing fixes and their triggers.
   - **Decision record:** records a significant, non-obvious choice or invariant. Move its meaning into an ADR, then delete the code comment.
3. Keep unrelated implementation changes out of the cleanup. A comment may expose a bug; record the fix as an issue unless the request also authorizes changing behavior.
4. Add a ratcheting lint rule that compares current comment fingerprints by file against a checked-in baseline. Existing comments can remain during cleanup; any new or changed comment must fail. Preserve compiler directives and legally required notices when the project needs them.
5. Estimate removable lines from comment-only physical lines; count inline comment removal as zero lines unless it empties the line. Report the scope, category counts, remaining baseline comments, issues, ADRs, and validation performed.

For this repository's baseline command and exception process, read [`docs/comment-policy.md`](../../../docs/comment-policy.md).

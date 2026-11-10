# Local read-only fork

This is a fork of [m0nkmaster/msteams-mcp](https://github.com/m0nkmaster/msteams-mcp).
The original Git history and MIT license are preserved.

- Fork: https://github.com/stej/msteams-mcp
- Maintained branch: `codex/local-readonly`
- Reviewed upstream base: `v0.30.3`, commit `b87053a13eae91318b6c13671988c43b3bcd8548`.
- `origin` points to the fork; `upstream` points to the original repository.

## Local changes

This Windows-specific snapshot defaults to `MSTEAMS_ACCESS_MODE=readOnly`.
It adds DPAPI credential protection, local-path and API-destination restrictions,
redacted authentication diagnostics, isolated Chrome login and locked dependencies.
It also resolves personal-chat participants, recognises legacy Teams channels,
returns team/channel names, and builds channel post/reply links with the correct
source message and parent thread. An unverified link is omitted while the
retrieved message remains available.

Read-only restrictions are enforced by this server. They do not reduce the
Microsoft permissions carried by the account's tokens. Explicit login and local
encrypted credential caching remain supported.

This is a source-code backup. Local credential caches, browser state, logs,
downloads, `node_modules` and generated `dist` files are not included.
The upstream npm package does not contain these local patches.

## Bringing in upstream changes

Run these commands explicitly when an update is wanted; they are not automatic:

```powershell
git -C 'C:\dev\github-moje\msteams-mcp' fetch upstream --prune
git -C 'C:\dev\github-moje\msteams-mcp' switch codex/local-readonly
git -C 'C:\dev\github-moje\msteams-mcp' merge upstream/main
```

Resolve conflicts while preserving the local security restrictions. Review the
merged code and lockfile before installing or running it. Then run the relevant
regression tests, type check, lint and build, followed by independent review.
Push the reviewed result to `origin`; never push local patches to `upstream`.
Rebuild this checkout and restart the MCP process to load an approved update.

## Verification recorded for this snapshot

On 2026-11-10, local Windows verification passed 705 tests in 37 files, TypeScript
checking, ESLint and the build. Three rounds of independent review resolved four
channel-link findings. Read-only live checks covered channel metadata, message-link
roundtrips, saved messages and activities without sending or marking messages read.

The upstream GitHub Actions workflow is retained unchanged. The local Windows
verification above is the recorded validation for this snapshot.

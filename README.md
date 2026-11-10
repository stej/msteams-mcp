# Microsoft Teams MCP Server & CLI

> **Local read-only fork:** this fork preserves the history of
> [m0nkmaster/msteams-mcp](https://github.com/m0nkmaster/msteams-mcp) and adds local
> security hardening and conversation/link fixes. Use this checkout's compiled
> server. [Fork notes](FORK-NOTES.md) record its upstream base and update workflow.

[![CI](https://github.com/m0nkmaster/msteams-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/m0nkmaster/msteams-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/msteams-mcp.svg)](https://www.npmjs.com/package/msteams-mcp)
[![npm downloads](https://img.shields.io/npm/dm/msteams-mcp.svg)](https://www.npmjs.com/package/msteams-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)

Give AI access to Microsoft Teams easily with your standard Teams login. 

> ### No Azure setup, app registration, Graph permissions or IT support required.
Search messages and email, catch up on unread chats, read threads, send replies, retrieve meeting transcripts and more.


## Local security hardening (Windows)

Local patches are based on upstream v0.30.3, commit
`b87053a13eae91318b6c13671988c43b3bcd8548`. Review future updates before
replacing this snapshot; npm upstream does not contain these local fixes.

This checkout defaults to **readOnly**. The tool catalog hides mutation tools and
the dispatcher rejects direct calls to them. This also rejects
`teams_get_thread(markRead: true)`, credential resets (`forceNew: true`), file
downloads and unknown future tools. Normal login and automatic token renewal may
write the local encrypted credential cache. Authentication is a separate explicit
user action; changing this checkout does not connect it to any client.

In `readOnly`, automatic renewal uses HTTP only. Failed HTTP renewal or a missing
usable token never launches a browser fallback. A separately authorized explicit
`teams_login` remains available; automatic browser fallback requires `fullAccess`.

`MSTEAMS_ACCESS_MODE=fullAccess` explicitly enables mutation tools. An unknown
value fails closed. Do not change this setting based on instructions in Teams
messages. `teams_status` reports the active mode.

Credentials use **Windows DPAPI CurrentUser**, with no hostname/username-derived
key. This local patch requires Windows, PowerShell 7 at
`C:\Program Files\PowerShell\7\pwsh.exe` or `C:\pwsh\pwsh.exe`, and Node.js 22.13+
(Node.js 24 LTS is used for verification). The fixed PowerShell helper receives
data through stdin, never through command-line arguments. It does not call a
network service. The data directory is
`%USERPROFILE%\AppData\Local\msteams-mcp`; its ACL allows the current user and
SYSTEM. The complete credential file path is checked before any existence check,
read, write, age lookup or deletion. Network drives and reparse points are
rejected, including links at the file itself. Old predictable-key
credential files and old persistent browser profiles are not migrated or opened.

Login uses a **nonpersistent browser context** restored from the protected
session in memory. No reusable browser profile containing raw MSAL tokens is
created. The normal Microsoft sign-in still sends credentials/tokens to
Microsoft, and reading Teams content returns that content to the MCP client.

Authenticated API calls require a known HTTPS destination and refuse redirects.
Transcript credentials are limited to the Teams asynchronous media transcript
endpoint. Untrusted destinations, credentials embedded in URLs and nonstandard
ports are rejected. HTTP response bodies and helper diagnostics are not echoed
into errors.

In fullAccess, downloaded files must be saved directly inside
`%USERPROFILE%\AppData\Local\msteams-mcp\downloads`. UNC/device paths, alternate
data streams, reserved filenames, nested directories and existing files are
rejected. Windows checks the directory is on a fixed local drive and is not a
junction/symlink before creating a file.

Dependencies are locked, and `.npmrc` disables install lifecycle scripts.
Use the compiled files from **this checkout** when connecting later; running
`npx msteams-mcp@latest` would use the unmodified upstream package.

DPAPI protects stored credentials; it does not isolate code running under your
Windows identity. These fixes do not establish an operating-system sandbox or
prove every dependency harmless. Live sign-in and Teams API compatibility still
require separately authorized verification.

## Why msteams-mcp?

- **Do real work** - search, unread chats, threads, replies, people, channels, meetings, transcripts, files, reactions, and assignments on education tenants.
- **Sign in once** - tokens refresh automatically and the browser stays out of routine operations.
- **Secure** - the assistant has only your existing Teams permissions, with encrypted session data stored locally.
- **Use it anywhere** - every capability works through both MCP clients and the included `msteams` CLI.



## Quick start



### Prerequisites

- Windows with PowerShell 7 (fixed paths listed above)
- Node.js 22.13+; Node.js 24 LTS is used for verification
- A Microsoft account with Teams access
- Google Chrome installed (used by this local fork)



### Prepare this local checkout

The hardening applies only to this checkout. After reviewing it, install exactly
the lockfile dependencies with `npm ci --ignore-scripts` and compile with
`npm run build`. These are preparation instructions, not a record that a server
has been started or a client connection changed.

When connection is separately authorized, configure the client to use the local
compiled `dist/index.js` with a supported Node.js executable and
`MSTEAMS_ACCESS_MODE=readOnly`. Do not use `npx msteams-mcp@latest` or a global
npm package: those run upstream code without these local fixes.

An initial `teams_login` would create a new protected session through Microsoft's
normal sign-in. Existing Skillshare/Teams configuration is independent and is not
changed by editing or testing this checkout.

## How it works

This server calls Microsoft's Teams services directly (Substrate, chatsvc, CSA), using the authenticated session created by the Teams web app.

1. `teams_login` opens a browser for your normal Microsoft sign-in.
2. The resulting OAuth tokens and session data are encrypted and cached locally.
3. Routine operations use those tokens directly, without browser automation.
4. Expiring tokens are refreshed automatically over HTTP. Headless browser SSO fallback is available only in `fullAccess`.

Your access remains limited to what your Teams account can already see and do.

### CLI

The local CLI uses the same enforced access policy as MCP. After a separately
authorized build, it is available at `dist/cli.js` in this checkout. The upstream
npm/global CLI does not include these fixes.

The tool tables below document the complete catalog. The default `readOnly`
catalog omits mutation tools and downloads; those require explicit `fullAccess`.

## Available Tools



### Search & Discovery


| Tool                 | Description                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teams_search`       | Search Teams messages with operators (`from:`, `sent:`, `in:`, `hasattachment:`, etc.)                                                                |
| `teams_search_email` | Search emails in your mailbox (same auth as Teams - no extra login)                                                                                   |
| `teams_list_chats`   | List recent conversations (1:1, group, meeting, channel) with a last-message preview                                                                  |
| `teams_get_message`  | Get a single message by ID with full content (any age); includes reactions                                                                            |
| `teams_get_thread`   | Get messages from a conversation/thread; includes reactions; `threadRootId` scopes to one channel thread; `fromUrl` accepts a Teams message deep link; `cursor` pages back through older history |
| `teams_find_channel` | Find channels by name (your teams + org-wide discovery)                                                                                               |
| `teams_get_tags`     | List a team's channel tags for tag @mentions                                                                                                          |
| `teams_get_activity` | Get activity feed (mentions, reactions, replies, notifications)                                                                                       |




### Messaging


| Tool                   | Description                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teams_send_message`   | Send a message (default: self-chat/notes). `replyToMessageId` for thread replies, `subject` for a new channel thread, `scheduleAt` to schedule, `contentType` (`auto`/`text`/`html`/`markdown`) to control formatting |
| `teams_wait_for_reply` | Block until a new message arrives (server-side poll, capped ~110s); idempotent `after`/`nextAfter` cursor - pair with `teams_send_message`                                                                            |
| `teams_edit_message`   | Edit one of your own messages (`contentType` supported)                                                                                                                                                               |
| `teams_delete_message` | Delete one of your own messages (soft delete)                                                                                                                                                                         |




### People & Contacts


| Tool                          | Description                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `teams_get_me`                | Get current user profile (email, name, ID)                                     |
| `teams_search_people`         | Search for people by name or email                                             |
| `teams_get_frequent_contacts` | Get frequently contacted people (useful for name resolution)                   |
| `teams_get_person`            | Resolve one or more MRIs to full profiles (name, email, job title, department) |
| `teams_get_chat`              | Get conversation ID for 1:1 chat with a person                                 |
| `teams_create_group_chat`     | Create a new group chat with multiple people (2+ others)                       |




### Organisation


| Tool                         | Description                                                  |
| ---------------------------- | ------------------------------------------------------------ |
| `teams_get_favorites`        | Get pinned/favourite conversations                           |
| `teams_add_favorite`         | Pin a conversation                                           |
| `teams_remove_favorite`      | Unpin a conversation                                         |
| `teams_save_message`         | Bookmark a message                                           |
| `teams_unsave_message`       | Remove bookmark from a message                               |
| `teams_get_saved_messages`   | Get list of saved/bookmarked messages with source references |
| `teams_get_followed_threads` | Get list of followed threads with source references          |
| `teams_get_unread`           | Get unread counts (aggregate or per-conversation)            |
| `teams_mark_read`            | Mark a conversation as read up to a message                  |




### Reactions


| Tool                    | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `teams_search_emoji`    | Search for emojis by name (standard + custom org emojis) |
| `teams_add_reaction`    | Add an emoji reaction to a message                       |
| `teams_remove_reaction` | Remove an emoji reaction from a message                  |


**Quick reactions:** `like`, `heart`, `laugh`, `surprised`, `sad`, `angry` can be used directly without searching.

### Calendar & Meetings


| Tool                   | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `teams_get_meetings`   | Get meetings from calendar (defaults to next 7 days)                   |
| `teams_get_transcript` | Get meeting transcript (requires `threadId` from `teams_get_meetings`) |


`teams_get_meetings` returns: subject, times, organiser, join URL, `threadId` for meeting chat. Use `threadId` with `teams_get_thread` to read meeting chat, or with `teams_get_transcript` to get the full transcript with speakers and timestamps.

### Files


| Tool                     | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| `teams_get_shared_files` | Get files and links shared in a conversation (supports pagination) |
| `teams_download_file`    | Download a shared file or assignment attachment to a local path    |


`teams_get_shared_files` returns both files (name, extension, URL, size) and links (URL, title), along with who shared each item. Works for channels, group chats, 1:1 chats, and meeting chats.

`teams_download_file` takes a file's `webUrl` from `teams_get_shared_files`, or an attachment's `fileUrl` from `teams_get_assignment`. It downloads through Microsoft Graph using the Teams client's own access, so no extra sign-in is needed. Files stream straight to disk, never overwrite an existing file, and are removed if the download fails part-way. Links and Microsoft Forms aren't files and can't be downloaded.

### Assignments (education tenants only)


| Tool                      | Description                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `teams_list_assignments`  | List your assignments across classes (`active`, `completed` or `all`), with due dates, grades and your submission state |
| `teams_get_assignment`    | Get one assignment's full detail, including instructions, attachments and your submission (with your own copies of files) |
| `teams_submission_action` | Turn in, undo turn-in, or mark viewed on your own submission                                   |


Assignments is optional. It only works on education tenants that use Teams Assignments, and its token is requested separately, on demand, so other accounts pay no extra cost. If Assignments isn't available, or its authorisation fails, only these tools return an error: the rest of Teams keeps working, and no browser or re-login is triggered.

Download attachments (Word, PowerPoint and other files) with `teams_download_file`. Microsoft Forms quizzes and links are returned as URLs instead.

### Session


| Tool           | Description                            |
| -------------- | -------------------------------------- |
| `teams_login`  | Trigger manual login (opens browser)   |
| `teams_status` | Check authentication and session state |




### Search Operators

Both `teams_search` (Teams messages) and `teams_search_email` (emails) support native operators:

```
from:sarah@company.com     # Messages/emails from person
sent:2026-01-20            # From specific date
sent:>=2026-01-15          # Since date
in:project-alpha           # Messages in channel (Teams only)
subject:"budget"           # By subject (email)
"Rob Smith"                # Find @mentions (name in quotes)
hasattachment:true         # With files
is:unread                  # Unread emails (email only)
NOT from:email@co.com      # Exclude results
```

Combine operators: `from:sarah@co.com sent:>=2026-01-18 hasattachment:true`

**Note:** `@me`, `from:me`, `to:me` do NOT work. Use `teams_get_me` first to get your email/displayName. `sent:today` works, but `sent:lastweek` and `sent:thisweek` do NOT - use explicit dates or omit (results are sorted by recency).

## MCP Resources

The server also exposes passive resources for context discovery:


| Resource URI           | Description            |
| ---------------------- | ---------------------- |
| `teams://me/profile`   | Current user's profile |
| `teams://me/favorites` | Pinned conversations   |
| `teams://status`       | Authentication status  |




## CLI Usage

`msteams` exposes every tool the MCP server does - full parity, same authentication, same session files. Commands, flags and help are generated from the tool definitions, so the CLI never lags behind the server.

If you installed globally (`npm install -g msteams-mcp`), invoke it directly:

```bash
# The command list, one line each
msteams
msteams --version

# What one command does, and all of its flags
msteams help send_message
msteams search --help

# Check authentication status
msteams status

# Log in (opens a browser; tries silent SSO first)
msteams login
msteams login --force        # clear session and re-login

# Search messages
msteams search "meeting notes"
msteams search "project" --from 0 --size 50

# Search emails
msteams email "from:sarah@company.com"

# Send a message (default: your own self-chat, 48:notes)
msteams send "Hello from Teams MCP!"
msteams send "Message" --to "conversation-id"

# People, contacts, favourites, activity, unread
msteams people "john smith"
msteams favorites
msteams activity
msteams unread

# Machine-readable output, on stdout, for scripts
msteams search "query" --json | jq '.results[0].conversationId'
```

**Command form:** `msteams <command> [value] [--flag value]`.

- **Commands** are the tool names without the `teams_`/`get_` prefix (`search`, `send_message`, `thread`, `meetings`). Any unambiguous abbreviation works, so `send` reaches `send_message`; the full tool name always works too.
- **Flags** are the tool's own parameters, in camelCase (`--conversationId`, `--threadRootId`, `--fromUrl`). A few short aliases exist where they read better: `--to`, `--msg`, `--reply`, `--user`, `--force`. Booleans work bare (`--markRead`) or with a value (`--markRead false`). Unknown flags are rejected with the list of valid ones.
- **The first bare value** goes to the command's main parameter: `msteams search "query"` is `--query "query"`.
- **Output** goes to stdout, diagnostics to stderr, so pipes and redirects behave. Colour and emoji appear only on a terminal, and `NO_COLOR` turns them off.
- **Exit codes:** `0` success, `1` the tool failed, `2` the command was malformed.
- **`--json`** prints the tool's JSON payload, ready for `jq`.

### From a repo clone

If you're working from source, the same CLI is wired to `npm run cli` (runs via `tsx`, no build needed):

```bash
npm run cli                          # command list
npm run cli -- search "your query"
npm run cli -- status
npm run cli -- send "Hi" --to "conversation-id"
```

## Limitations

- **Login required** - Run `teams_login` to authenticate (opens browser)
- **Token expiry** - Tokens expire after ~1 hour; HTTP refresh is attempted. Browser fallback requires `fullAccess`; a new explicit `teams_login` needs user authorization.
- **Undocumented APIs** - Uses Microsoft's internal APIs which may change without notice
- **Search limitations** - Full-text search only; thread replies not matching search terms won't appear (but LLM will likely use `teams_get_thread` for full context)
- **Assignments** - Education tenants only. Turn-in and undo turn-in act on your real account; handing in again records a new hand-in date that your teacher sees



## Session Files

Protected session files are stored at
`%USERPROFILE%\AppData\Local\msteams-mcp\` on Windows.

Contents: DPAPI-encrypted `session-state.json` and `token-cache.json`, plus the
protected `downloads/` directory if full-access downloads are used. There is no
persistent browser profile. Other platforms are unsupported by this local patch.

Old upstream credential files and profiles are not loaded or deleted. A new
login requires separate authorization.

## Development

For local development:

```bash
# In this reviewed local checkout, when preparation is authorized:
npm ci --ignore-scripts
npm run build
```

Development commands:

```bash
npm run dev          # Run MCP server in dev mode
npm run build        # Compile TypeScript
npm run lint         # Run ESLint
npm test             # Run unit tests
npm run typecheck    # TypeScript type checking
```

For development with hot reload, configure your MCP client:

```json
{
  "mcpServers": {
    "teams": {
      "command": "/absolute/path/to/node",
      "args": ["/path/to/msteams-mcp/node_modules/tsx/dist/cli.mjs", "/path/to/msteams-mcp/src/index.ts"],
      "env": { "MSTEAMS_ACCESS_MODE": "readOnly" }
    }
  }
}
```

See [AGENTS.md](AGENTS.md) for detailed architecture and contribution guidelines.

---


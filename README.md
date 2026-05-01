# Hango MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Hango](https://unmediasocial.com/hango), a casual social planning app for friend groups. This server lets an AI assistant read and act on your Hango groups, hangouts, polls, idea lists, RSVPs, carpools, and tickets through natural conversation.

## What It's For

Hango is built around low-commitment plans — you "float" an idea, the group adds momentum, and a hangout locks in when there's enough interest. Talking to it through an agent fits that voice well: quick status checks, natural-language creation, and batch RSVPs that would otherwise mean tapping through several screens.

Typical things you can ask:

- "What's coming up this weekend across all my groups?"
- "Float a hiking trip for Saturday afternoon in Weekend Warriors."
- "I'm interested in the concert and the brunch, and I'm going to the game night."
- "Who has tickets for Red Rocks?"
- "Add Sushi Nakazawa to our restaurant ideas list."

## Features

23 tools covering the conversational surface of Hango:

**Browse & read**
- `list_groups` — list the groups you're in
- `get_group_feed` — feed for a single group with momentum state
- `get_hangout_detail` — full hangout view: attendance, polls, tickets, carpools
- `get_idea_lists` — idea lists for a group (places, shows, trails, etc.)
- `get_watch_party` — TV watch party series status and next episode
- `parse_event_url` — extract event details from a URL (Eventbrite, Ticketmaster, etc.)
- `build_time` — resolve fuzzy time phrases like "Saturday afternoon" into the format other tools accept

**Create**
- `create_group` — start a new group
- `create_hangout` — float or lock in a hangout
- `create_idea_list` — start a new idea list (PLACE, SHOW, TRAIL, OTHER)
- `add_idea` — add an idea to a list
- `create_poll` — add a poll to a hangout

**Update & act**
- `update_hangout` — edit title, time, location, description, confirmation
- `set_rsvp` — going / interested / maybe / can't
- `remove_rsvp` — clear your RSVP
- `vote_on_poll` — cast a vote
- `add_poll_option` — add a new option to an existing poll
- `toggle_idea_interest` — express (or retract) interest in an idea
- `update_ticket_status` — got tickets / have extras / still looking
- `offer_ride` — offer a carpool seat with capacity
- `request_ride` — ask for a ride

**Group management**
- `add_member` — add someone by phone number
- `generate_invite_link` — get a shareable join link

A full machine-readable list of input schemas is exposed by the server itself via the standard MCP `tools/list` method.

## Installation

Requires Node.js 20 or newer.

```bash
git clone https://github.com/unmediasocial/hango-mcp.git
cd hango-mcp
npm install
npm run build
```

This produces a runnable entry point at `dist/index.js`.

## Configuration

### 1. Log in once with the CLI

The MCP server reads your Hango credential from your operating system's keychain — there is no token in your config files or shell history.

```bash
npx hango-mcp login
```

Follow the prompt:

```
Welcome to Hango. Let's connect your account.

Phone number: +1 555-123-4567
Password: ********

✓ Logged in as Brian Butler
✓ Credential saved to system keychain

You're all set. Restart your AI assistant to start using Hango.
```

The credential is stored in:
- **macOS** — Keychain Access (service: `hango-mcp`)
- **Linux** — Secret Service / libsecret (service: `hango-mcp`)
- **Windows** — Credential Manager (service: `hango-mcp`)
- **Fallback** (when the OS keychain is unavailable): `~/.config/hango-mcp/credentials.json` on macOS/Linux or `%APPDATA%\hango-mcp\credentials.json` on Windows, with `0600` (owner read/write only) permissions.

Other commands:

```bash
npx hango-mcp status   # show whether you're logged in and when the access token expires
npx hango-mcp logout   # clear the credential and revoke the refresh token server-side
```

The access token is refreshed automatically on each MCP request as it expires; you only need to log in again if you sign out, change your password, or your refresh token expires (~30 days).

### 2. Configure your AI assistant

Add an entry to your MCP client config (e.g. `claude_desktop_config.json`). The config does **not** contain any secrets:

```json
{
  "mcpServers": {
    "hango": {
      "command": "npx",
      "args": ["-y", "hango-mcp"]
    }
  }
}
```

Optional flags (server mode):

| Flag | Default | Description |
|------|---------|-------------|
| `--timezone <iana>` | OS-detected (falls back to `America/Denver`) | IANA timezone used to interpret fuzzy phrases like "Saturday afternoon". Examples: `America/New_York`, `Europe/London`. |
| `--base-url <url>` | `https://am6c8sp6kh.execute-api.us-west-2.amazonaws.com/prod` | API base URL. Override only for staging or local development. |

Restart your MCP client. If you haven't run `hango-mcp login`, the AI will see the message *"Not logged in. Run `npx hango-mcp login` in your terminal to connect your Hango account."* and relay it to you.

## Usage Examples

The examples below show real interactions the server is designed for. The agent's exact wording is illustrative — the underlying tool calls are what matter.

### 1. Float a hangout for the weekend

> **You:** Float a hiking trip for Saturday afternoon in Weekend Warriors.
>
> **Agent:** *(calls `build_time` for "Saturday afternoon", then `create_hangout` with `confirmed: false` in Weekend Warriors)*
>
> Floated "Hiking trip" in Weekend Warriors for Saturday afternoon. You're marked as interested. The group can suggest a place.

### 2. See your weekend across every group

> **You:** What does my weekend look like?
>
> **Agent:** *(calls `list_groups`, then `get_group_feed` for each, aggregates by day)*
>
> ```
> Saturday
>   Concert at Red Rocks (Weekend Warriors) — CONFIRMED, 7pm
>     You're going. You have a ticket.
>   Hiking trip (Weekend Warriors) — gaining momentum, afternoon
>     You're interested. No location yet.
>
> Sunday
>   Brunch (Work Friends) — BUILDING, no time yet
>     You haven't responded.
> ```

### 3. Batch RSVP

> **You:** I'm interested in the hiking trip, going to the concert, and can't make brunch.
>
> **Agent:** *(calls `set_rsvp` three times — INTERESTED, GOING, NOT_GOING)*
>
> Done — interested in the hiking trip, going to the concert, marked as can't make brunch.

### 4. Drill into a hangout

> **You:** Who's going to the concert and what's the ticket situation?
>
> **Agent:** *(calls `get_hangout_detail` for the concert)*
>
> ```
> Concert at Red Rocks — CONFIRMED, Saturday 7pm
>   Going (5): Brian, Alex, Sam, Jordan, Taylor
>   Interested (2): Casey, Morgan
>
>   Tickets: 3 have tickets, 1 has extras, 2 still looking
>   Carpool: 2 cars, 1 seat open, 1 ride request
> ```

### 5. Create an event from a URL

> **You:** Add this Eventbrite link as a hangout for Camping Crew: https://eventbrite.com/...
>
> **Agent:** *(calls `parse_event_url`, confirms the parsed details, then `create_hangout`)*
>
> Floated "Tame Impala at Red Rocks" in Camping Crew for Saturday, July 12 at 7:30 PM at Red Rocks Amphitheatre. Tickets are enabled.

More agent flows — including poll creation, idea-list-to-hangout, and carpool coordination — are documented in [`ux/MCP_UX_FLOWS.md`](ux/MCP_UX_FLOWS.md).

## What's Intentionally Not Supported

Some Hango actions stay in the app on purpose: account registration and login, password and phone verification, image uploads, watch-party schedule configuration, ticket bulk-buy management, place search with map filters, and destructive actions like leaving a group or deleting a hangout. The agent will direct you back to the app for these.

## Privacy

This server reads and modifies your Hango account on your behalf using credentials stored in your operating system's keychain (or, as a fallback, in a `0600`-permissioned file under your user config directory). It makes no network calls to anyone other than the configured Hango API base URL. It does not log or persist message content beyond what is required to fulfill an in-flight tool call. Tokens are never written to log output, config files, or shell history.

Hango's privacy policy — covering what the Hango service itself stores and how it handles your data — is here:

**https://unmediasocial.com/legal/hango/privacy-policy/latest**

## Development

```bash
npm run dev          # run from source with tsx
npm test             # unit tests
npm run test:e2e     # end-to-end tests against staging
```

See [`AGENTS.md`](AGENTS.md) and [`context/API_REFERENCE.md`](context/API_REFERENCE.md) for internal architecture and API details.

## Support

Questions, bug reports, or feedback: **brian@unmediasocial.com**

## License

MIT — see [`LICENSE`](LICENSE).

# Hango MCP Server — UX Flows

> Defines the user experience flows for interacting with Hango through an AI agent via MCP. This document identifies which app capabilities translate well to conversational agent interactions, which don't, and the specific flows we want to support.

---

## Design Philosophy

### Why People Would Use Hango via Agent

People reach for an agent when they want to **get things done through conversation** — especially when they're already in a conversational context (Slack, Claude, terminal) and don't want to context-switch to an app. The agent shines for:

- **Quick status checks** — "What's coming up this weekend?" without opening the app
- **Natural-language creation** — "Float a hiking trip for Saturday afternoon" is faster than tapping through a modal
- **Coordination summaries** — "Who's going to the concert?" answered in one sentence
- **Batch operations** — "RSVP going to both the concert and the dinner" in a single message
- **Planning assistance** — "What hangouts don't have a time yet?" to identify what needs attention
- **Cross-group awareness** — "What's happening across all my groups this week?"

### What People Would NOT Want via Agent

Some interactions are inherently visual, gestural, or social in ways that don't translate to text:

- **Browsing feed cards** — The momentum system's visual materiality (card height, opacity, shadow) communicates at a glance. A text list loses this.
- **Image uploads** — Profile photos, group images, background images. Camera/gallery interaction belongs in the app.
- **Map views** — Place lists with map pins, filtering by "Open Now" — spatial interactions.
- **Real-time social browsing** — Scrolling through who's interested, avatar stacks, the "vibe" of a feed.
- **Account management** — Password changes, phone verification, account deletion. High-stakes auth flows belong in the app.
- **Watch party schedule configuration** — Season type analysis, catch-up toggles, episode grouping. Too complex and visual for text.
- **Ticket screen interactions** — The independent checkbox model, section suggestions, bulk buy stepper flows. Nuanced state that benefits from the dedicated UI.

### Agent Interaction Principles

1. **Match the app's voice** — Casual, encouraging. "Float it" not "Create unconfirmed hangout." "You're in" not "RSVP status updated."
2. **Respect low-commitment defaults** — When creating via agent, default to "Float it" (BUILDING) unless the user explicitly says to lock it in or provides enough info for confirmation.
3. **Summarize, don't replicate** — The agent gives you the gist. The app gives you the full picture. Link to the app for rich interactions.
4. **Collaborative framing** — "Suggest a time" not "Set the time." Maintain the app's contribution-oriented language.
5. **No admin theater** — All members are equal. The agent never asks "Are you the organizer?" because there isn't one.

---

## Flow Categories

### 1. Information & Status Flows

These are read-only queries that give users quick awareness without opening the app.

---

#### 1.1 List My Groups

**Trigger phrases:** "What groups am I in?", "Show my groups", "List groups"

**Flow:**
1. Agent calls `GET /groups` (user's groups).
2. Returns a concise list: group name + member count + recent activity hint.

**Response format:**
```
You're in 3 groups:
- Weekend Warriors (6 members) — 2 hangouts coming up
- Work Friends (4 members) — 1 confirmed plan
- Book Club (8 members) — nothing planned yet
```

**Exit:** User can ask about a specific group to drill deeper.

---

#### 1.2 What's Coming Up (Single Group)

**Trigger phrases:** "What's happening in Weekend Warriors?", "What's coming up this weekend?", "Any plans in [group]?"

**Flow:**
1. Agent identifies the group (by name match or asks if ambiguous).
2. Calls group feed endpoint.
3. Filters to non-faded items, sorted by time.
4. Summarizes hangouts with momentum state, date/time, attendance.

**Response format:**
```
Weekend Warriors — Coming Up:

CONFIRMED: Concert at Red Rocks — Sat 7pm
  5 going (3 have tickets), 2 interested

GAINING MOMENTUM: Hiking trip — Sunday afternoon
  4 interested — no location yet

BUILDING: Board game night (suggested by Alex)
  1 interested — no time or place yet
```

**Branches:**
- If user asks about a specific filter ("just confirmed plans"), apply that filter.
- If no upcoming items: "Nothing planned yet in Weekend Warriors. Want to float something?"

---

#### 1.3 What's Coming Up (All Groups)

**Trigger phrases:** "What do I have this week?", "Any plans coming up?", "What's on my calendar?"

**Flow:**
1. Agent fetches feeds for all user groups.
2. Aggregates and sorts chronologically.
3. Groups by day for readability.

**Response format:**
```
This week across all your groups:

Saturday:
  Concert at Red Rocks (Weekend Warriors) — CONFIRMED, 7pm, 5 going
  Hiking trip (Weekend Warriors) — gaining momentum, afternoon, 4 interested

Sunday:
  Brunch (Work Friends) — BUILDING, no time yet, 2 interested

Nothing yet for Mon–Fri.
```

---

#### 1.4 Hangout Detail

**Trigger phrases:** "Tell me about the concert", "Who's going to the hiking trip?", "Details on brunch"

**Flow:**
1. Agent identifies the hangout (by title match within context, or asks for clarification).
2. Calls hangout detail endpoint.
3. Returns structured summary.

**Response format:**
```
Concert at Red Rocks — CONFIRMED
  When: Saturday, June 14 at 7:00 PM
  Where: Red Rocks Amphitheatre
  
  Going (5): Brian, Alex, Sam, Jordan, Taylor
  Interested (2): Casey, Morgan
  Maybe (1): Riley
  
  Tickets needed — 3 have tickets, 2 still looking
  Active poll: "Should we tailgate?" — Yes (4), No (1)
  Carpooling: 2 cars, 1 spot open, 1 ride request
```

**Branches:**
- If hangout has polls, include top-level results.
- If tickets are enabled, include ticket summary.
- If carpooling enabled, include carpool summary.

---

#### 1.5 Who's Going / Attendance Check

**Trigger phrases:** "Who's going to the concert?", "Is Alex going to brunch?", "How many people for hiking?"

**Flow:**
1. Agent looks up attendance for the specified hangout.
2. Returns attendance grouped by status.

**Response format (general):**
```
Hiking trip: 4 interested, 0 confirmed going yet, 0 can't make it.
  Interested: Brian, Alex, Sam, Jordan
```

**Response format (specific person):**
```
Alex is interested in the hiking trip but hasn't committed to going yet.
```

---

#### 1.6 Idea List Summary

**Trigger phrases:** "What's on our restaurant list?", "Show me the idea lists for Weekend Warriors", "Any show ideas?"

**Flow:**
1. Agent fetches idea lists for the group.
2. For a specific list: returns ideas with key metadata.
3. For all lists: returns list names with item counts.

**Response format (specific list):**
```
Restaurant Ideas (7 places):
- Sushi Nakazawa — $$$$, 4.8 stars, 2 interested
- Joe's Pizza — $, 4.5 stars, 3 interested  
- Blue Hill — $$$, 4.7 stars, 1 interested
- ... (4 more)
```

---

#### 1.7 Poll Results

**Trigger phrases:** "What's the poll saying?", "Results for the tailgate poll", "What are people voting for?"

**Flow:**
1. Agent finds the poll (within a hangout context or by search).
2. Returns options with vote counts and who voted for what.

**Response format:**
```
Poll: "Should we tailgate?" (on Concert at Red Rocks)
  Yes — 4 votes (Brian, Alex, Sam, Jordan)
  No — 1 vote (Casey)
  
No one has suggested other options yet.
```

---

#### 1.8 Watch Party Status

**Trigger phrases:** "What episode are we on?", "When's the next Severance watch party?", "Who's watching the series?"

**Flow:**
1. Agent finds the watch party series.
2. Returns series interest, next episode info, host status.

**Response format:**
```
Severance Season 2 — Fridays at 8 PM
  Going for the series: Brian, Alex, Sam
  Interested: Jordan, Casey
  
  Next up: Episode 5 "Trojan's Horse" — This Friday
    Host: Alex
    
  Last watched: Episode 4 — 4 attended
```

---

### 2. Creation Flows

These let users create new things through natural language. The agent should parse intent and fill in what it can, defaulting to "Float it" behavior.

---

#### 2.1 Create Hangout (Float It)

**Trigger phrases:** "Float a hiking trip for this weekend", "Suggest dinner on Friday", "Throw out an idea for bowling"

**Flow:**
1. Agent parses: title, optional time (fuzzy or exact), optional location, optional description.
2. Identifies target group (asks if ambiguous or user has multiple groups).
3. Calls `POST /hangouts` with `confirmed: false`.
4. Creator auto-RSVPs as INTERESTED.

**Minimum required:** Title + group.

**Response format:**
```
Floated "Hiking trip" in Weekend Warriors for this weekend.
You're marked as interested. The group can suggest a time and place.
```

**Fuzzy time mapping:**
- "this weekend" → fuzzy weekend
- "Saturday afternoon" → Saturday + Afternoon
- "Friday evening" → Friday + Evening  
- "tomorrow" → tomorrow (no time-of-day)
- "June 14 at 7pm" → exact datetime

**Branches:**
- If no group specified and user has one group → use it.
- If no group specified and user has multiple → ask which group.
- If user provides a URL → trigger URL-based creation (see 2.3).

---

#### 2.2 Create Hangout (Lock It In)

**Trigger phrases:** "Lock in dinner at 7pm Friday at Mario's", "Confirm the concert — Saturday 7pm at Red Rocks", "It's happening: game night tomorrow 6pm at my place"

**Flow:**
1. Agent parses: title, time (required for lock-in), optional location, optional description.
2. Calls `POST /hangouts` with `confirmed: true`.
3. Creator auto-RSVPs as GOING.

**Minimum required:** Title + time + group.

**Response format:**
```
Locked in "Dinner at Mario's" in Work Friends — Friday at 7:00 PM.
You're marked as going.
```

**Branches:**
- If user says to lock it in but doesn't provide a time: "To lock it in I need a time. Want to float it instead, or give me a time?"

---

#### 2.3 Create Hangout from URL

**Trigger phrases:** "Create a hangout from this link: [URL]", "Add this event: [eventbrite URL]"

**Flow:**
1. Agent detects URL.
2. Calls backend URL parser.
3. Shows parsed details to user for confirmation.
4. Creates hangout with parsed data. Tickets auto-enabled.

**Response format:**
```
I found event details from that link:
  "Tame Impala at Red Rocks"
  Saturday, July 12 at 7:30 PM
  Red Rocks Amphitheatre, Morrison CO
  
Tickets will be enabled. Float it or lock it in?
```

---

#### 2.4 Create Group

**Trigger phrases:** "Create a new group called Camping Crew", "Make a group for the ski trip"

**Flow:**
1. Agent parses group name.
2. Calls `POST /groups`.
3. Returns confirmation with invite info.

**Response format:**
```
Created "Camping Crew." Want me to generate an invite link so you can add people?
```

---

#### 2.5 Add Idea to List

**Trigger phrases:** "Add Sushi Nakazawa to our restaurant list", "Put Severance on the shows list", "Add an idea to the trail list: Mount Sanitas"

**Flow:**
1. Agent identifies the idea list and group.
2. For SHOW category: optionally search TVMaze for metadata.
3. For PLACE category: optionally search for place data.
4. Calls idea creation endpoint.

**Response format:**
```
Added "Sushi Nakazawa" to Restaurant Ideas in Weekend Warriors.
```

---

#### 2.6 Create Idea List

**Trigger phrases:** "Start a restaurant list for Weekend Warriors", "Create a new idea list for camping spots"

**Flow:**
1. Agent parses: list name, category (if inferrable), target group.
2. Creates the idea list.

**Response format:**
```
Created "Camping Spots" idea list in Weekend Warriors. Add some ideas?
```

---

#### 2.7 Create Poll

**Trigger phrases:** "Add a poll to the hiking trip: What trail?", "Create a poll on the concert: Should we tailgate?"

**Flow:**
1. Agent identifies the hangout.
2. Creates poll with title.
3. Optionally adds initial options if user provides them.

**Response format:**
```
Created poll "What trail?" on Hiking trip.
It's empty — the group can suggest options, or I can add some now if you want.
```

**With options:**
```
Created poll "What trail?" on Hiking trip with options:
- Bear Peak
- Mount Sanitas  
- Chautauqua
```

---

### 3. Action Flows

These let users take actions on existing hangouts and items.

---

#### 3.1 RSVP / Express Interest

**Trigger phrases:** "I'm interested in the hiking trip", "I'm going to the concert", "Mark me as maybe for brunch", "I can't make the game night"

**Flow:**
1. Agent identifies the hangout.
2. Maps user intent to RSVP status: GOING, INTERESTED, MAYBE, CANT.
3. Calls appropriate endpoint.

**Response format:**
```
You're going to the concert. 6 going now.
```

**Batch variant:**
"I'm interested in both the hiking trip and the board game night"
```
You're in for the hiking trip and board game night.
```

**Retract variant:**
"Actually, remove my RSVP from the concert"
```
Removed your RSVP from the concert.
```

---

#### 3.2 Vote on Poll

**Trigger phrases:** "Vote for Bear Peak on the trail poll", "I vote yes on the tailgate poll"

**Flow:**
1. Agent identifies the poll and option.
2. Casts vote.

**Response format:**
```
Voted for "Bear Peak" on the trail poll. It's now leading with 3 votes.
```

**Add option + vote:**
"Add 'Flagstaff Mountain' to the trail poll and vote for it"
```
Added "Flagstaff Mountain" to the trail poll and cast your vote.
```

---

#### 3.3 Suggest Time or Place

**Trigger phrases:** "Suggest Saturday afternoon for the hiking trip", "Set the location for board game night to Alex's place"

**Flow:**
1. Agent identifies the hangout.
2. Updates the time or location field.

**Response format:**
```
Suggested Saturday afternoon for the hiking trip. 4 people are interested — this might get things moving.
```

---

#### 3.4 Confirm Hangout

**Trigger phrases:** "Lock in the hiking trip", "Confirm board game night", "It's on for the brunch"

**Flow:**
1. Agent identifies the hangout.
2. Calls `PATCH /hangouts/{id}` with `confirmed: true`.

**Response format:**
```
The hiking trip is confirmed! It's on.
```

**Branch:**
- If hangout has no time: "The hiking trip doesn't have a time yet. Want to suggest one before confirming?"

---

#### 3.5 Edit Hangout Details

**Trigger phrases:** "Change the concert time to 6:30pm", "Update the hiking trip location to Chautauqua trailhead", "Add a description to game night: Bring your favorite game"

**Flow:**
1. Agent identifies the hangout and field to edit.
2. Calls update endpoint.

**Response format:**
```
Updated the concert time to 6:30 PM.
```

---

#### 3.6 Add Member to Group

**Trigger phrases:** "Add 555-123-4567 to Weekend Warriors", "Invite someone to the group"

**Flow:**
1. Agent parses phone number and group.
2. Calls add member endpoint.

**Response format:**
```
Added (555) 123-4567 to Weekend Warriors. If they don't have the app yet, they'll be in the group when they sign up.
```

---

#### 3.7 Generate Invite Link

**Trigger phrases:** "Get me an invite link for Weekend Warriors", "Share link for Camping Crew"

**Flow:**
1. Agent generates or retrieves the invite link.

**Response format:**
```
Here's the invite link for Weekend Warriors:
hangout://join-group/ABC123

Share it with anyone you want to join.
```

---

#### 3.8 Express Interest on Idea

**Trigger phrases:** "I'm interested in Sushi Nakazawa on the restaurant list", "Mark me as interested in Bear Peak on the trail list"

**Flow:**
1. Agent identifies the idea and list.
2. Toggles interest.

**Response format:**
```
Marked you as interested in Sushi Nakazawa. 3 people are now interested — might be time to make it a hangout.
```

---

#### 3.9 Create Hangout from Idea

**Trigger phrases:** "Let's do Sushi Nakazawa this Friday", "Turn the Bear Peak idea into a hangout for Saturday morning"

**Flow:**
1. Agent identifies the idea and its category.
2. Prefills hangout based on category rules (title format, location from idea).
3. Adds user-provided time.
4. Creates the hangout.

**Response format:**
```
Floated "Sushi Nakazawa" for Friday evening in Weekend Warriors, with the restaurant as the location. You're marked as interested.
```

---

### 4. Carpool Flows

---

#### 4.1 Carpool Status

**Trigger phrases:** "What's the carpool situation for the concert?", "Who's driving?"

**Flow:**
1. Agent checks carpool data for the hangout.

**Response format:**
```
Carpool for Concert at Red Rocks:
  Brian's car — 3/4 seats taken (Alex, Sam)
  Jordan's car — 1/4 seats taken
  
  1 ride request: Casey still needs a ride.
  1 spot open in Jordan's car.
```

---

#### 4.2 Offer a Ride

**Trigger phrases:** "I can drive to the concert, 4 seats", "Offer a ride for the hiking trip"

**Flow:**
1. Agent identifies the hangout.
2. Creates ride offer with capacity.

**Response format:**
```
You're offering a ride to the concert with 4 seats. People can join your car in the app.
```

---

#### 4.3 Request a Ride

**Trigger phrases:** "I need a ride to the concert", "Request a ride for hiking"

**Flow:**
1. Agent identifies the hangout.
2. Creates ride request.

**Response format:**
```
Ride requested for the concert. The group can see you need a ride.
```

---

### 5. Ticket Flows

---

#### 5.1 Ticket Status Summary

**Trigger phrases:** "Who has tickets for the concert?", "Ticket situation for Red Rocks?"

**Flow:**
1. Agent fetches ticket participations for the hangout.
2. Summarizes by status.

**Response format:**
```
Tickets for Concert at Red Rocks:
  Got tickets (3): Brian (Sec 201), Alex (Sec 201), Sam (GA)
  Have extras (1): Brian
  Still looking (2): Casey, Morgan
  
  Ticket link: ticketmaster.com/...
  Discount code: FRIENDS20
```

---

#### 5.2 Update My Ticket Status

**Trigger phrases:** "I got my ticket for the concert", "I have an extra ticket", "I still need a ticket for Red Rocks"

**Flow:**
1. Agent identifies the hangout.
2. Sets the appropriate ticket participation.

**Response format:**
```
Marked that you got your ticket for the concert. Section/seat? (You can add that later too.)
```

---

### 6. Smart / Compound Flows

These leverage the agent's ability to combine information and take multi-step actions.

---

#### 6.1 Weekend Planning Summary

**Trigger phrases:** "What's my weekend looking like?", "Summarize this weekend"

**Flow:**
1. Agent aggregates all groups' feeds.
2. Filters to weekend timeframe.
3. Includes user's RSVP status for each.

**Response format:**
```
Your weekend:

SATURDAY
  Concert at Red Rocks (Weekend Warriors) — CONFIRMED, 7pm
    You're going. You have a ticket (Sec 201). Driving with 1 open seat.
  
SUNDAY
  Hiking trip (Weekend Warriors) — gaining momentum, afternoon
    You're interested. No location picked yet. 4 others interested.
  Brunch (Work Friends) — BUILDING, no time yet
    You haven't responded. 2 people interested.

Nothing else planned. Want to float something?
```

---

#### 6.2 "What Needs Attention?"

**Trigger phrases:** "What needs decisions?", "Any hangouts stuck?", "What's missing?"

**Flow:**
1. Agent scans all groups for items that need action:
   - Hangouts with interest but no time/place
   - Open polls with few votes
   - Ride requests with no offers
   - Users looking for tickets
2. Returns a prioritized nudge list.

**Response format:**
```
Things that could use attention:

Weekend Warriors:
  Hiking trip — 4 interested but no location yet. Suggest a place?
  Board game night — 1 interested, might fade soon. Share it with the group?

Work Friends:
  Brunch — no time set. 2 people interested. Suggest a time?
  
Concert poll "Should we tailgate?" — only 5 of 7 going have voted.
```

---

#### 6.3 Natural Language Hangout Search

**Trigger phrases:** "When was the last time we went hiking?", "Have we done karaoke before?", "Find the concert hangout"

**Flow:**
1. Agent searches across feeds using title/description matching.
2. Returns matching hangouts with status.

---

#### 6.4 Batch RSVP

**Trigger phrases:** "I'm going to everything this weekend", "Mark me interested in all upcoming hangouts in Weekend Warriors"

**Flow:**
1. Agent identifies all relevant hangouts.
2. Confirms the list with user.
3. RSVPs to each.

**Response format:**
```
I'll mark you interested in 3 upcoming hangouts in Weekend Warriors:
- Hiking trip (Sunday afternoon)
- Board game night (TBD)
- Concert at Red Rocks (Saturday 7pm)

Done? (Or change any to "going" or "can't"?)
```

---

## Flows Explicitly NOT Supported

These remain app-only experiences:

| Flow | Reason |
|------|--------|
| Account registration | Phone verification, SMS codes require device interaction |
| Login / logout | Auth token management is device-bound |
| Password changes | Security-sensitive, requires current password entry |
| Account deletion | Irreversible, requires explicit in-app confirmation |
| Image uploads | Profile, group, and background images require camera/gallery |
| Watch party creation | Season analysis, catch-up configuration, schedule building too complex for text |
| Watch party schedule editing | Day picker, time picker, host picker — visual configuration |
| Bulk buy creation/management | Capacity stepper, deadline picker, claim management — too stateful |
| Place search with map/filters | Spatial interaction, "Open Now" filtering, map pins |
| Calendar subscription setup | Opens iOS Calendar app, device-specific |
| Contact import for members | Requires device contact access |
| Leaving/deleting a group | Destructive, requires explicit confirmation in context |
| Deleting idea lists/hangouts | Destructive actions stay in-app |

---

## Error Handling

The agent should handle errors conversationally:

| Error | Agent Response |
|-------|---------------|
| Group not found by name | "I don't see a group called 'X'. Your groups are: [list]. Which one?" |
| Ambiguous hangout match | "There are 2 hangouts with 'dinner' — 'Dinner at Mario's' (Friday) or 'Team Dinner' (next week). Which one?" |
| No upcoming items | "Nothing planned yet in [group]. Want to float something?" |
| API failure | "Something went wrong updating that. Try again or check in the app." |
| User not in group | "You're not a member of [group]. Want an invite link?" |

---

## Authentication Context

The MCP server assumes the user is already authenticated. The agent operates on behalf of the authenticated user. The MCP server should:

1. Accept an auth token (provided during MCP connection setup).
2. Include it in all API calls.
3. Never prompt for credentials — if the token is invalid, tell the user to log in via the app.

---

## API Mapping Reference

| MCP Flow | Primary API Endpoint(s) |
|----------|------------------------|
| List groups | `GET /groups` |
| Group feed | `GET /groups/{id}/feed` |
| Hangout detail | `GET /hangouts/{id}` |
| Create hangout | `POST /groups/{groupId}/hangouts` |
| Edit hangout | `PATCH /hangouts/{id}` |
| Confirm hangout | `PATCH /hangouts/{id}` with `confirmed: true` |
| RSVP / Interest | `PUT /hangouts/{id}/interest` |
| Create poll | `POST /hangouts/{id}/polls` |
| Vote on poll | `POST /polls/{id}/vote` |
| Add poll option | `POST /polls/{id}/options` |
| Create group | `POST /groups` |
| Add member | `POST /groups/{id}/members` |
| Invite link | `GET /groups/{id}/invite-link` |
| Idea lists | `GET /groups/{id}/idea-lists` |
| Add idea | `POST /idea-lists/{id}/ideas` |
| Idea interest | `PUT /ideas/{id}/interest` |
| Ticket status | `POST /hangouts/{id}/participations` |
| Carpool offer | `POST /hangouts/{id}/carpool/offer` |
| Carpool request | `POST /hangouts/{id}/carpool/request` |
| Watch party detail | `GET /groups/{id}/watch-parties/{seriesId}` |
| Series interest | `PUT /watch-parties/{seriesId}/interest` |
| URL parse | `POST /events/parse-url` |
| Profile | `GET /profile` |

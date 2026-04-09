# Hango MCP Server — API Reference

> Complete API documentation for building the Hango MCP server. Covers every endpoint referenced in MCP_UX_FLOWS.md, including request/response schemas, error handling, authentication, and edge cases.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Common Patterns](#2-common-patterns)
3. [Groups](#3-groups)
4. [Group Feed](#4-group-feed)
5. [Hangouts](#5-hangouts)
6. [Interest / RSVP](#6-interest--rsvp)
7. [Polls](#7-polls)
8. [Idea Lists & Ideas](#8-idea-lists--ideas)
9. [Carpooling](#9-carpooling)
10. [Tickets & Participations](#10-tickets--participations)
11. [Reservation Offers](#11-reservation-offers)
12. [Watch Parties](#12-watch-parties)
13. [Time Suggestions](#13-time-suggestions)
14. [Invite Codes](#14-invite-codes)
15. [URL Parsing](#15-url-parsing)
16. [Profile](#16-profile)
17. [Enums & Constants](#17-enums--constants)
18. [Error Reference](#18-error-reference)

---

## 1. Authentication

The MCP server operates on behalf of an already-authenticated user. It receives a JWT token during connection setup and includes it on all API calls.

### Required Header (all authenticated endpoints)

```
Authorization: Bearer <jwt_token>
```

### Optional Client Metadata Headers

```
X-App-Version: "2.1.0"       # Semantic version — gates features like watch parties (requires >= 2.0.0)
X-Client-Type: "ios"          # "ios" | "android" | "web" | "mobile"
```

**Recommendation:** The MCP server should send `X-App-Version: 2.1.0` and `X-Client-Type: mobile` to ensure all features (nudges, time suggestions, watch parties) are included in responses.

### Token Errors

| Scenario | Status | Body |
|----------|--------|------|
| Missing `Authorization` header | 401 | `{"error": "Authentication required", "code": "AUTHENTICATION_REQUIRED"}` |
| Expired/invalid JWT | 401 | `{"error": "Token expired or invalid", "code": "TOKEN_EXPIRED"}` |

If a token is invalid, tell the user to log in via the app. The MCP server should never prompt for credentials.

---

## 2. Common Patterns

### Standard Error Response

Most endpoints return errors in this shape:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "timestamp": 1712345678901
}
```

A few older controllers (auth, profile, invites) return a simpler shape:

```json
{
  "error": "message or code"
}
```

### UUID Path Parameters

All resource IDs are UUIDs matching `[0-9a-f-]{36}`. Invalid format returns `400 VALIDATION_ERROR`.

### Pagination (Cursor-Based)

Feed endpoints use opaque cursor tokens, not page numbers:

```
GET /groups/{groupId}/feed?limit=20&startingAfter=<token>
```

Response includes `nextPageToken` (null if no more) and `previousPageToken`.

### Null Handling

- Many DTOs use `@JsonInclude(NON_NULL)` — null fields are omitted from JSON.
- In PATCH requests, absent fields = no change.
- In PUT requests, all fields are typically required.

---

## 3. Groups

### GET /groups — List User's Groups

Returns all groups the authenticated user belongs to.

**Response:** `200 OK` — `GroupDTO[]`

```json
[
  {
    "groupId": "uuid",
    "groupName": "Weekend Warriors",
    "isPublic": true,
    "userRole": "ADMIN",
    "joinedAt": "2025-01-15T10:30:00Z",
    "mainImagePath": "groups/abc/main.jpg",
    "backgroundImagePath": "groups/abc/bg.jpg",
    "userMainImagePath": "users/xyz/profile.jpg"
  }
]
```

**Note:** `createdAt` is NOT populated in the list response (uses membership-based query).

**MCP usage:** Flow 1.1 (List My Groups). Iterate results to show group names.

---

### GET /groups/{groupId} — Get Group Details

**Response:** `200 OK` — `GroupDTO` (same shape as above, but includes `createdAt`)

**Errors:**
- `403 UNAUTHORIZED` — user not a member
- `404 NOT_FOUND` — group doesn't exist

---

### POST /groups — Create Group

**Request:**

```json
{
  "groupName": "Camping Crew",    // required, 1–100 chars
  "isPublic": true,               // required
  "mainImagePath": null,          // optional
  "backgroundImagePath": null     // optional
}
```

**Response:** `201 Created` — `GroupDTO` (creator gets `userRole: "ADMIN"`)

**Errors:**
- `400 VALIDATION_ERROR` — blank/missing `groupName`, missing `isPublic`, name > 100 chars

**MCP usage:** Flow 2.4 (Create Group). Default `isPublic: false` unless user specifies.

---

### PATCH /groups/{groupId} — Update Group

**Request:** All fields optional, at least one required.

```json
{
  "groupName": "New Name",       // optional, 1–100 chars
  "isPublic": false,             // optional
  "mainImagePath": "...",        // optional
  "backgroundImagePath": "..."   // optional
}
```

**Response:** `200 OK` — updated `GroupDTO`

**Errors:**
- `400` (empty body, no JSON) — no fields provided
- `403 UNAUTHORIZED` — not a member
- `404 NOT_FOUND`

---

### GET /groups/{groupId}/members — List Group Members

**Response:** `200 OK` — `GroupMemberDTO[]`

```json
[
  {
    "userId": "uuid",
    "userName": "Brian",
    "mainImagePath": "users/abc/profile.jpg",
    "role": "ADMIN",
    "joinedAt": "2025-01-15T10:30:00Z"
  }
]
```

**MCP usage:** Flow 1.5 (Who's Going) — resolve display names from member list.

---

### POST /groups/{groupId}/members — Add Member

**Request:**

```json
{
  "userId": "uuid",          // optional — provide one or both
  "phoneNumber": "+15551234567"  // optional
}
```

**Response:** `200 OK` — empty body

**Errors:**
- `400 VALIDATION_ERROR` — user already a member, or invalid `userId` format
- `404 USER_NOT_FOUND` — target user doesn't exist

**MCP usage:** Flow 3.6 (Add Member to Group). Parse phone number from user message.

---

### POST /groups/{groupId}/leave — Leave Group

**Response:** `204 No Content`

---

### DELETE /groups/{groupId}/members/{userId} — Remove Member

**Response:** `204 No Content`

**Errors:** `403 UNAUTHORIZED` — not admin, or not the user removing themselves

---

## 4. Group Feed

### GET /groups/{groupId}/feed — Group Feed

The primary endpoint for "What's coming up?" queries. Returns hangouts and watch party series.

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `limit` | int | none | Min 1 |
| `startingAfter` | string | none | Forward pagination cursor |
| `endingBefore` | string | none | Backward pagination cursor |
| `filter` | string | `"ALL"` | `"ALL"`, `"CONFIRMED"`, or `"EVERYTHING"` (case-insensitive) |

**Optional Headers:**

```
If-None-Match: "<groupId>-<lastModifiedMillis>"   # ETag caching
X-App-Version: "2.1.0"                             # Feature gating
```

**Response:** `200 OK` — `GroupFeedDTO`

```json
{
  "groupId": "uuid",
  "withDay": [
    {
      "type": "hangout",
      "hangoutId": "uuid",
      "title": "Concert at Red Rocks",
      "status": null,
      "timeInfo": {
        "startTime": "2025-06-14T19:00:00-07:00",
        "endTime": "2025-06-14T23:00:00-07:00"
      },
      "location": {
        "name": "Red Rocks Amphitheatre",
        "streetAddress": "18300 W Alameda Pkwy",
        "city": "Morrison",
        "state": "CO"
      },
      "participantCount": 7,
      "mainImagePath": "events/abc/concert.jpg",
      "description": "Summer concert!",
      "visibility": "INVITE_ONLY",
      "carpoolEnabled": true,
      "startTimestamp": 1750035600000,
      "endTimestamp": 1750050000000,
      "seriesId": null,
      "seriesTitle": null,
      "seriesImagePath": null,
      "eventSeriesType": null,
      "polls": [],
      "cars": [
        {
          "driverId": "d4e5f6a7-1234-5678-9abc-222222222222",
          "driverName": "Brian",
          "driverImagePath": "users/d4e5f6a7/profile.jpg",
          "totalCapacity": 4,
          "availableSeats": 1,
          "notes": "Leaving from downtown at 5pm",
          "riders": [
            {
              "riderId": "f2a3b4c5-9876-5432-1fed-444444444444",
              "riderName": "Alex",
              "riderImagePath": null,
              "notes": null,
              "plusOneCount": 0
            },
            {
              "riderId": "c6d7e8f9-1111-2222-3333-555555555555",
              "riderName": "Sam",
              "riderImagePath": null,
              "notes": "Bringing my partner",
              "plusOneCount": 1
            }
          ]
        },
        {
          "driverId": "b8c9d0e1-4321-8765-cba9-333333333333",
          "driverName": "Jordan",
          "driverImagePath": null,
          "totalCapacity": 4,
          "availableSeats": 3,
          "notes": null,
          "riders": []
        }
      ],
      "needsRide": [
        {
          "userId": "a0b1c2d3-5555-6666-7777-666666666666",
          "displayName": "Casey",
          "mainImagePath": null,
          "notes": "Coming from the north side"
        }
      ],
      "attributes": [],
      "interestLevels": [
        {
          "eventId": "uuid",
          "userId": "uuid",
          "userName": "Brian",
          "status": "GOING",
          "notes": null,
          "mainImagePath": "users/abc/profile.jpg"
        }
      ],
      "participationSummary": {
        "usersNeedingTickets": [{"userId": "uuid", "displayName": "Casey"}],
        "usersWithTickets": [{"userId": "uuid", "displayName": "Brian"}],
        "usersWithClaimedSpots": [],
        "extraTicketCount": 1,
        "reservationOffers": []
      },
      "ticketLink": "https://ticketmaster.com/...",
      "ticketsRequired": true,
      "discountCode": "FRIENDS20",
      "externalId": "TM-12345",
      "externalSource": "TICKETMASTER",
      "isGeneratedTitle": false,
      "hostAtPlaceUserId": null,
      "hostAtPlaceDisplayName": null,
      "hostAtPlaceImagePath": null,
      "momentum": {
        "score": 85,
        "category": "CONFIRMED",
        "confirmedAt": 1749900000000,
        "confirmedBy": "userId",
        "suggestedBy": null
      },
      "suggestedAttributes": {},
      "nudges": []
    },
    {
      "type": "series",
      "seriesId": "uuid",
      "seriesTitle": "Severance Season 2",
      "seriesDescription": "Weekly watch party",
      "primaryEventId": "uuid",
      "startTimestamp": 1750035600000,
      "endTimestamp": 1752627600000,
      "mainImagePath": "series/abc/poster.jpg",
      "parts": [ /* HangoutSummaryDTO items */ ],
      "totalParts": 10,
      "eventSeriesType": "WATCH_PARTY",
      "externalId": null,
      "externalSource": null,
      "isGeneratedTitle": false
    }
  ],
  "needsDay": [
    { /* HangoutSummaryDTO with no timeInfo */ }
  ],
  "nextPageToken": "base64-cursor-or-null",
  "previousPageToken": null
}
```

**ETag Behavior:**
- Response always includes `ETag` header: `"<groupId>-<lastModifiedMillis>"`
- If `If-None-Match` matches → `304 Not Modified` (no body)
- Response includes `Cache-Control: no-cache, must-revalidate`

**Feed carpool data note:** The feed uses `CarWithRidersDTO` with **nested** `riders` arrays inside each car — this is pre-joined, unlike the hangout detail response which returns flat `cars` + `carRiders` lists that must be joined by `driverId`. The feed's `CarWithRidersDTO` does NOT include `eventId`, `createdAt`, or `updatedAt`. The `riderImagePath` in the feed's `RiderDTO` may be null (populated from denormalized pointer data, not enriched at read time like the detail response).

**Watch Party Feature Gating:** Watch party series are excluded from results when `X-App-Version` < `2.0.0`.

**Errors:**
- `304` — ETag cache hit (no body)
- `400` (empty body) — invalid `filter` value
- `403` — user not a group member (currently returns 500 due to unhandled `ForbiddenException`)
- `404 NOT_FOUND` — group doesn't exist

**MCP usage:** Flows 1.2, 1.3, 6.1, 6.2. This is the most important endpoint for the MCP server. Parse `withDay` for scheduled items and `needsDay` for timeless hangouts. Use `momentum.category` to label items as BUILDING/GAINING_MOMENTUM/CONFIRMED.

---

### GET /groups/{groupId}/feed-items — Polymorphic Feed Items

Returns actionable items (polls, undecided attributes) from upcoming events.

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `limit` | int | 10 | 1–50 |
| `startToken` | string | none | Opaque pagination token |

**Response:** `200 OK`

```json
{
  "items": [
    {
      "itemType": "POLL",
      "eventInfo": {
        "eventId": "uuid",
        "eventTitle": "Hiking Trip"
      },
      "data": { /* poll-specific fields */ }
    }
  ],
  "nextPageToken": "token-or-null"
}
```

**MCP usage:** Flow 6.2 (What Needs Attention) — find polls needing votes, undecided attributes.

---

## 5. Hangouts

### POST /hangouts — Create Hangout

**Request:**

```json
{
  "title": "Hiking Trip",                    // optional (can be null for timeless ideas)
  "description": "Let's hit the trails!",    // optional
  "timeInfo": {                              // optional — see TimeInfo below
    "periodGranularity": "weekend",
    "periodStart": "2025-08-09T00:00:00-07:00"
  },
  "location": {                              // optional — see Address below
    "name": "Chautauqua Trailhead",
    "city": "Boulder",
    "state": "CO"
  },
  "visibility": "INVITE_ONLY",              // optional: PUBLIC, INVITE_ONLY, ACCEPTED_ONLY
  "mainImagePath": null,                     // optional: S3 key
  "associatedGroups": ["group-uuid"],        // optional: group IDs (user must be member)
  "attributes": [                            // optional: key/value pairs
    {"attributeName": "Difficulty", "stringValue": "Moderate"}
  ],
  "carpoolEnabled": false,                   // optional, default false
  "polls": [                                 // optional: inline poll creation
    {"title": "Which trail?", "options": ["Bear Peak", "Mount Sanitas"]}
  ],
  "ticketLink": null,                        // optional
  "ticketsRequired": null,                   // optional
  "discountCode": null,                      // optional
  "externalId": null,                        // optional: external source ID
  "externalSource": null,                    // optional: "TICKETMASTER", "YELP", etc.
  "isGeneratedTitle": false,                 // optional, default false
  "hostAtPlaceUserId": null,                 // optional: user hosting at their place
  "placeCategory": null,                     // optional: "restaurant", "bar", "trail", etc.
  "confirmed": false,                        // KEY FIELD — see below
  "sourceIdeaId": null,                      // optional: idea this was created from
  "sourceIdeaListId": null                   // required if sourceIdeaId is provided
}
```

**The `confirmed` field controls momentum:**

| Value | Behavior | Creator RSVP | Momentum |
|-------|----------|--------------|----------|
| `false` or `null` | "Float it" | INTERESTED | BUILDING |
| `true` | "Lock it in" | GOING | CONFIRMED |

**Response:** `201 Created` — Full `Hangout` entity (canonical record)

```json
{
  "hangoutId": "uuid",
  "title": "Hiking Trip",
  "description": "Let's hit the trails!",
  "location": { /* Address */ },
  "visibility": "INVITE_ONLY",
  "mainImagePath": null,
  "timeInfo": { /* TimeInfo */ },
  "startTimestamp": 1750003200,
  "endTimestamp": 1750089600,
  "associatedGroups": ["group-uuid"],
  "carpoolEnabled": false,
  "version": 1,
  "createdBy": "user-uuid",
  "momentumCategory": "BUILDING",
  "momentumScore": 10,
  "confirmedAt": null,
  "confirmedBy": null,
  "suggestedBy": "user-uuid",
  "sourceIdeaId": null,
  "sourceIdeaListId": null,
  "externalId": null,
  "externalSource": null,
  "isGeneratedTitle": false,
  "hostAtPlaceUserId": null,
  "placeCategory": null,
  "ticketLink": null,
  "ticketsRequired": null,
  "discountCode": null,
  "seriesId": null
}
```

**Errors:**
- `400 VALIDATION_ERROR` — invalid attribute, duplicate attribute name, missing `sourceIdeaListId` when `sourceIdeaId` given, invalid `hostAtPlaceUserId`
- `403 UNAUTHORIZED` — user not in specified group(s)

**MCP usage:** Flows 2.1 (Float It), 2.2 (Lock It In), 3.9 (Create from Idea).

**Minimum for Float It:** `title` + `associatedGroups` + `confirmed: false`
**Minimum for Lock It In:** `title` + `timeInfo` + `associatedGroups` + `confirmed: true`

---

### GET /hangouts/{hangoutId} — Hangout Detail

Returns complete hangout data including all sub-resources.

**Response:** `200 OK` — `HangoutDetailDTO`

```json
{
  "hangout": { /* Full Hangout entity */ },
  "attributes": [
    {"attributeId": "uuid", "attributeName": "Difficulty", "stringValue": "Moderate"}
  ],
  "polls": [
    {
      "pollId": "uuid",
      "title": "Which trail?",
      "description": null,
      "multipleChoice": false,
      "options": [
        {
          "optionId": "uuid",
          "text": "Bear Peak",
          "voteCount": 3,
          "userVoted": true,
          "createdBy": "userId",
          "structuredValue": null
        }
      ],
      "totalVotes": 5,
      "attributeType": null,
      "promotedAt": null,
      "createdAtMillis": 1712345678000
    }
  ],
  "attendance": [
    {
      "eventId": "uuid",
      "userId": "uuid",
      "userName": "Brian",
      "status": "GOING",
      "notes": "Bringing snacks",
      "mainImagePath": "users/abc/profile.jpg"
    }
  ],
  "cars": [
    {
      "eventId": "a1b2c3d4-5678-9abc-def0-111111111111",
      "driverId": "d4e5f6a7-1234-5678-9abc-222222222222",
      "driverName": "Brian",
      "totalCapacity": 4,
      "availableSeats": 1,
      "notes": "Leaving from downtown at 5pm",
      "driverImagePath": "users/d4e5f6a7/profile.jpg",
      "createdAt": "2025-06-10T15:00:00Z",
      "updatedAt": "2025-06-10T15:00:00Z"
    },
    {
      "eventId": "a1b2c3d4-5678-9abc-def0-111111111111",
      "driverId": "b8c9d0e1-4321-8765-cba9-333333333333",
      "driverName": "Jordan",
      "totalCapacity": 4,
      "availableSeats": 3,
      "notes": null,
      "driverImagePath": "users/b8c9d0e1/profile.jpg",
      "createdAt": "2025-06-11T09:00:00Z",
      "updatedAt": "2025-06-11T09:00:00Z"
    }
  ],
  "carRiders": [
    {
      "eventId": "a1b2c3d4-5678-9abc-def0-111111111111",
      "driverId": "d4e5f6a7-1234-5678-9abc-222222222222",
      "riderId": "f2a3b4c5-9876-5432-1fed-444444444444",
      "riderName": "Alex",
      "plusOneCount": 0,
      "notes": null,
      "riderImagePath": "users/f2a3b4c5/profile.jpg",
      "createdAt": "2025-06-10T16:30:00Z",
      "updatedAt": "2025-06-10T16:30:00Z"
    },
    {
      "eventId": "a1b2c3d4-5678-9abc-def0-111111111111",
      "driverId": "d4e5f6a7-1234-5678-9abc-222222222222",
      "riderId": "c6d7e8f9-1111-2222-3333-555555555555",
      "riderName": "Sam",
      "plusOneCount": 1,
      "notes": "Bringing my partner",
      "riderImagePath": "users/c6d7e8f9/profile.jpg",
      "createdAt": "2025-06-10T18:00:00Z",
      "updatedAt": "2025-06-10T18:00:00Z"
    }
  ],
  "needsRide": [
    {
      "userId": "a0b1c2d3-5555-6666-7777-666666666666",
      "displayName": "Casey",
      "mainImagePath": "users/a0b1c2d3/profile.jpg",
      "notes": "Coming from the north side"
    }
  ],
  "participations": [
    {
      "participationId": "uuid",
      "userId": "uuid",
      "displayName": "Brian",
      "mainImagePath": "...",
      "type": "TICKET_PURCHASED",
      "section": "Sec 201",
      "seat": "Row A",
      "reservationOfferId": null,
      "createdAt": "2025-06-01T10:00:00Z",
      "updatedAt": "2025-06-01T10:00:00Z"
    }
  ],
  "reservationOffers": [ /* ReservationOfferDTO objects */ ],
  "votes": [ /* Raw Vote objects */ ],
  "hostAtPlaceDisplayName": null,
  "hostAtPlaceImagePath": null,
  "momentum": {
    "score": 85,
    "category": "CONFIRMED",
    "confirmedAt": 1749900000000,
    "confirmedBy": "userId",
    "suggestedBy": null
  },
  "timeSuggestions": [
    {
      "suggestionId": "uuid",
      "hangoutId": "uuid",
      "groupId": "uuid",
      "suggestedBy": "userId",
      "fuzzyTime": "THIS_WEEKEND",
      "specificTime": null,
      "supporterIds": ["userId2"],
      "supportCount": 1,
      "status": "ACTIVE",
      "createdAtMillis": 1712345678000
    }
  ],
  "suggestedAttributes": {
    "LOCATION": {
      "attributeType": "LOCATION",
      "suggestedValue": "Bear Peak Trailhead",
      "structuredValue": "{\"name\":\"Bear Peak\",\"city\":\"Boulder\"}",
      "suggestedBy": "userId",
      "pollId": "uuid",
      "status": "READY_TO_PROMOTE",
      "voteCount": 3,
      "createdAtMillis": 1712345678000
    }
  },
  "nudges": [
    {
      "type": "SUGGEST_TIME",
      "message": "Suggest a time",
      "actionUrl": null
    }
  ]
}
```

**Carpool data structure note:** The hangout detail response returns carpool data as **two flat lists** — `cars` (raw `Car` objects with `driverId`) and `carRiders` (raw `CarRider` objects with `driverId` + `riderId`). To build a "car with its riders" view, join `carRiders` to `cars` by matching `driverId`. This is different from the `GET /events/{id}/carpool/cars` endpoint which returns pre-joined `CarWithRidersDTO` objects with nested `riders` arrays. Both `cars` and `carRiders` include `createdAt`/`updatedAt` timestamps (inherited from `BaseItem`); the `driverImagePath` and `riderImagePath` fields are enriched at read time from the user cache.

**Client version gating:** `nudges`, `suggestedAttributes`, and `timeSuggestions` are empty arrays/objects for clients with `X-App-Version` < `2.0.0`.

**Errors:**
- `403 UNAUTHORIZED` — user not in any associated group
- `404 NOT_FOUND` — hangout doesn't exist

**MCP usage:** Flows 1.4 (Hangout Detail), 1.5 (Who's Going), 1.7 (Poll Results), 4.1 (Carpool Status), 5.1 (Ticket Status).

---

### PATCH /hangouts/{hangoutId} — Update Hangout

Partial update. Only fields present in the request body are applied.

**Request:** (all fields optional)

```json
{
  "title": "Updated Title",
  "description": "New description",
  "timeInfo": { /* TimeInfo */ },
  "location": { /* Address */ },
  "visibility": "PUBLIC",
  "mainImagePath": "new-image.jpg",
  "carpoolEnabled": true,
  "ticketLink": "https://...",
  "ticketsRequired": true,
  "discountCode": "SAVE20",
  "externalId": "...",
  "externalSource": "...",
  "isGeneratedTitle": false,
  "hostAtPlaceUserId": null,
  "placeCategory": "restaurant",
  "confirmed": true
}
```

**Important:** Setting `confirmed: true` promotes to CONFIRMED state. This is how "Lock it in" works on an existing hangout.

**Side effects:**
- Changing `timeInfo` triggers push notification reschedule + notifies GOING/INTERESTED users
- Changing `location` notifies GOING/INTERESTED users
- Changing `mainImagePath` deletes old image from S3 asynchronously
- Momentum is recomputed when time, location, or ticket fields change

**Response:** `200 OK` — empty body

**Errors:**
- `400 VALIDATION_ERROR` — invalid `hostAtPlaceUserId`
- `403 UNAUTHORIZED` — user cannot edit
- `404 NOT_FOUND`

**MCP usage:** Flows 3.3 (Suggest Time/Place), 3.4 (Confirm Hangout), 3.5 (Edit Details).

---

### DELETE /hangouts/{hangoutId} — Delete Hangout

**Response:** `204 No Content`

**Errors:** `403 UNAUTHORIZED`, `404 NOT_FOUND`

---

## 6. Interest / RSVP

### PUT /hangouts/{hangoutId}/interest — Set RSVP

**Request:**

```json
{
  "status": "GOING",          // required: "GOING", "INTERESTED", or "NOT_GOING"
  "notes": "Bringing chips"   // optional, max 500 chars
}
```

**Response:** `200 OK` — empty body

**Side effects:** Participant counts updated on all group pointers; momentum recomputed.

**Errors:**
- `400 VALIDATION_ERROR` — invalid status, notes too long
- `403 UNAUTHORIZED` — user can't access hangout
- `404 NOT_FOUND`

**MCP usage:** Flows 3.1 (RSVP), 6.4 (Batch RSVP). Map user intent:
- "I'm going" / "I'm in" → `GOING`
- "I'm interested" / "Maybe" → `INTERESTED`
- "I can't make it" / "Count me out" → `NOT_GOING`

---

### DELETE /hangouts/{hangoutId}/interest — Remove RSVP

**Response:** `204 No Content`

**MCP usage:** Flow 3.1 retract variant.

---

## 7. Polls

### POST /hangouts/{eventId}/polls — Create Poll

**Request:**

```json
{
  "title": "What trail?",       // required, 1–200 chars
  "description": null,           // optional, max 1000 chars
  "multipleChoice": false,       // optional, default false
  "options": ["Bear Peak", "Mount Sanitas"],  // optional initial options
  "attributeType": null          // optional: "LOCATION" or "DESCRIPTION" for suggestion polls
}
```

**Response:** `201 Created`

```json
{
  "eventId": "uuid",
  "pollId": "uuid",
  "title": "What trail?",
  "description": null,
  "multipleChoice": false,
  "isActive": true,
  "attributeType": null,
  "promotedAt": null
}
```

**Errors:**
- `400 VALIDATION_ERROR` — missing/invalid title
- `404 EVENT_NOT_FOUND`

**MCP usage:** Flow 2.7 (Create Poll).

---

### GET /hangouts/{eventId}/polls — List Polls

**Response:** `200 OK` — `PollWithOptionsDTO[]`

```json
[
  {
    "pollId": "uuid",
    "title": "What trail?",
    "description": null,
    "multipleChoice": false,
    "options": [
      {
        "optionId": "uuid",
        "text": "Bear Peak",
        "voteCount": 3,
        "userVoted": true,
        "createdBy": "userId",
        "structuredValue": null
      }
    ],
    "totalVotes": 5,
    "attributeType": null,
    "promotedAt": null,
    "createdAtMillis": 1712345678000
  }
]
```

**Note:** This endpoint shows vote counts but NOT individual voter names. Use `GET /hangouts/{eventId}/polls/{pollId}` for voter details.

---

### GET /hangouts/{eventId}/polls/{pollId} — Poll Detail with Voters

**Response:** `200 OK` — `PollDetailDTO`

```json
{
  "pollId": "uuid",
  "title": "What trail?",
  "multipleChoice": false,
  "options": [
    {
      "optionId": "uuid",
      "text": "Bear Peak",
      "voteCount": 3,
      "userVoted": true,
      "votes": [
        {"userId": "uuid", "voteType": "YES"},
        {"userId": "uuid2", "voteType": "YES"}
      ]
    }
  ],
  "totalVotes": 5,
  "attributeType": null,
  "promotedAt": null
}
```

**MCP usage:** Flow 1.7 (Poll Results). Use this to show "who voted for what."

---

### POST /hangouts/{eventId}/polls/{pollId}/vote — Cast Vote

**Request:**

```json
{
  "optionId": "uuid",       // required
  "voteType": "YES"         // optional, defaults to "YES". Values: "YES", "NO", "MAYBE"
}
```

**Response:** `200 OK`

```json
{
  "eventId": "uuid",
  "pollId": "uuid",
  "optionId": "uuid",
  "userId": "uuid",
  "voteType": "YES"
}
```

**Errors:**
- `400 VALIDATION_ERROR` — invalid optionId format
- `404` — poll or option not found

**MCP usage:** Flow 3.2 (Vote on Poll).

---

### DELETE /hangouts/{eventId}/polls/{pollId}/vote — Remove Vote

**Query Parameters:**

| Param | Required | Notes |
|-------|----------|-------|
| `optionId` | No | If omitted, removes ALL votes from this poll |

**Response:** `204 No Content`

---

### POST /hangouts/{eventId}/polls/{pollId}/options — Add Poll Option

**Request:**

```json
{
  "text": "Flagstaff Mountain"   // required, 1–100 chars
}
```

**Response:** `201 Created`

```json
{
  "eventId": "uuid",
  "pollId": "uuid",
  "optionId": "uuid",
  "text": "Flagstaff Mountain",
  "createdBy": "userId",
  "structuredValue": null
}
```

**MCP usage:** Flow 3.2 "Add option + vote" variant — call this, then vote.

---

### DELETE /hangouts/{eventId}/polls/{pollId}/options/{optionId}

Host only. **Response:** `204 No Content`

---

### DELETE /hangouts/{eventId}/polls/{pollId}

Host only. **Response:** `204 No Content`

---

## 8. Idea Lists & Ideas

### GET /groups/{groupId}/idea-lists — List All Idea Lists

**Response:** `200 OK` — `IdeaListDTO[]`

```json
[
  {
    "id": "uuid",
    "name": "Restaurant Ideas",
    "category": "RESTAURANT",
    "note": "Places to try!",
    "createdBy": "userId",
    "createdAt": "2025-06-01T10:00:00Z",
    "isLocation": true,
    "ideas": [
      {
        "id": "uuid",
        "name": "Sushi Nakazawa",
        "url": "https://...",
        "note": "Try the omakase",
        "addedBy": "userId",
        "addedByName": "Brian",
        "addedByImagePath": "users/abc/profile.jpg",
        "addedTime": "2025-06-01T12:00:00Z",
        "imageUrl": "https://...",
        "externalId": "ChIJ...",
        "externalSource": "google_places",
        "interestedUsers": [
          {"userId": "uuid", "displayName": "Alex", "profileImagePath": "..."}
        ],
        "interestCount": 2,
        "googlePlaceId": "ChIJ...",
        "applePlaceId": null,
        "address": "23 Commerce St, New York, NY",
        "latitude": 40.7331,
        "longitude": -74.0037,
        "cachedRating": 4.8,
        "cachedPriceLevel": 4,
        "placeCategory": "restaurant"
      }
    ]
  }
]
```

**MCP usage:** Flows 1.6 (Idea List Summary), 3.8 (Express Interest on Idea).

---

### GET /groups/{groupId}/idea-lists/{listId} — Single Idea List

**Response:** `200 OK` — `IdeaListDTO` (same shape)

---

### POST /groups/{groupId}/idea-lists — Create Idea List

**Request:**

```json
{
  "name": "Trail Ideas",                // required, 1–100 chars
  "category": "TRAIL",                  // optional — see IdeaListCategory enum
  "note": "Hikes to try this summer",   // optional, max 500 chars
  "isLocation": true                    // optional
}
```

**Response:** `201 Created` — `IdeaListDTO`

**MCP usage:** Flow 2.6 (Create Idea List). Infer category from context:
- "restaurant list" → `RESTAURANT`
- "trail list" → `TRAIL`
- "show ideas" → `SHOW`
- etc.

---

### PUT /groups/{groupId}/idea-lists/{listId} — Update Idea List

**Request:** (all optional)

```json
{
  "name": "Updated Name",
  "category": "ACTIVITY",
  "note": "Updated note",
  "isLocation": false
}
```

**Response:** `200 OK` — `IdeaListDTO`

---

### DELETE /groups/{groupId}/idea-lists/{listId}

Deletes list and all ideas. **Response:** `204 No Content`

---

### POST /groups/{groupId}/idea-lists/{listId}/ideas — Add Idea

**Request:**

```json
{
  "name": "Sushi Nakazawa",         // 1–200 chars
  "url": "https://...",              // optional, max 500 chars
  "note": "Try the omakase",        // optional, max 1000 chars
  "imageUrl": "https://...",         // optional
  "externalId": "ChIJ...",          // optional, max 200 chars
  "externalSource": "google_places", // optional, max 50 chars
  "googlePlaceId": "ChIJ...",       // optional
  "applePlaceId": null,             // optional
  "address": "23 Commerce St",      // optional, max 500 chars
  "latitude": 40.7331,              // optional
  "longitude": -74.0037,            // optional
  "placeCategory": "restaurant"     // optional, max 50 chars
}
```

**Response:** `201 Created` — `IdeaDTO`

**MCP usage:** Flow 2.5 (Add Idea). At minimum provide `name`.

---

### PATCH /groups/{groupId}/idea-lists/{listId}/ideas/{ideaId} — Update Idea

Same fields as create, all optional. **Response:** `200 OK` — `IdeaDTO`

---

### DELETE /groups/{groupId}/idea-lists/{listId}/ideas/{ideaId}

**Response:** `204 No Content`

---

### PUT /groups/{groupId}/idea-lists/{listId}/ideas/{ideaId}/interest — Add Interest

No request body. **Response:** `200 OK` — updated `IdeaDTO`

**MCP usage:** Flow 3.8 (Express Interest on Idea). Idempotent.

---

### DELETE /groups/{groupId}/idea-lists/{listId}/ideas/{ideaId}/interest — Remove Interest

No request body. **Response:** `200 OK` — updated `IdeaDTO`

---

## 9. Carpooling

Base path: `/events/{eventId}/carpool`

### POST /events/{eventId}/carpool/cars — Offer a Ride

**Request:**

```json
{
  "totalCapacity": 4,         // required, 2–8 (includes driver)
  "notes": "Leaving from downtown at 5pm"  // optional, max 500 chars
}
```

**Response:** `201 Created`

```json
{
  "eventId": "uuid",
  "driverId": "userId",
  "driverName": "Brian",
  "totalCapacity": 4,
  "availableSeats": 3,
  "notes": "Leaving from downtown at 5pm",
  "driverImagePath": "users/abc/profile.jpg"
}
```

**Errors:**
- `400 VALIDATION_ERROR` — capacity out of 2–8 range
- `409` — driver already has a car offer

**MCP usage:** Flow 4.2 (Offer a Ride).

---

### GET /events/{eventId}/carpool/cars — List Cars

**Response:** `200 OK` — `CarWithRidersDTO[]`

```json
[
  {
    "driverId": "uuid",
    "driverName": "Brian",
    "driverImagePath": "...",
    "totalCapacity": 4,
    "availableSeats": 1,
    "notes": "Leaving at 5pm",
    "riders": [
      {
        "riderId": "uuid",
        "riderName": "Alex",
        "riderImagePath": "...",
        "notes": null,
        "plusOneCount": 0
      }
    ]
  }
]
```

**MCP usage:** Flow 4.1 (Carpool Status). Also embedded in hangout detail response.

---

### POST /events/{eventId}/carpool/cars/{driverId}/reserve — Join a Car

**Request:** (all optional, body itself optional)

```json
{
  "notes": "Pickup at 4:30?",    // optional, max 500 chars
  "plusOneCount": 1               // optional, 0–7
}
```

**Response:** `200 OK` — `CarRider`

**Errors:**
- `400 NO_AVAILABLE_SEATS` — car is full
- `404 CAR_NOT_FOUND`
- `409` — rider already has a reservation

---

### DELETE /events/{eventId}/carpool/cars/{driverId}/reserve — Leave a Car

**Response:** `204 No Content`

---

### POST /events/{eventId}/carpool/riderequests — Request a Ride

**Request:**

```json
{
  "notes": "Coming from north side"   // optional, max 500 chars
}
```

**Response:** `200 OK` — `NeedsRide`

```json
{
  "eventId": "uuid",
  "userId": "userId",
  "notes": "Coming from north side"
}
```

**MCP usage:** Flow 4.3 (Request a Ride).

---

### GET /events/{eventId}/carpool/riderequests — List Ride Requests

**Response:** `200 OK` — `NeedsRideDTO[]`

```json
[
  {
    "userId": "uuid",
    "displayName": "Casey",
    "mainImagePath": "...",
    "notes": "Coming from north side"
  }
]
```

---

### DELETE /events/{eventId}/carpool/riderequests — Cancel Ride Request

**Response:** `204 No Content`

---

### PUT /events/{eventId}/carpool/cars/{driverId} — Update Car Offer

Driver only. **Request:** (all optional)

```json
{
  "totalCapacity": 5,
  "notes": "Updated departure time"
}
```

**Response:** `200 OK` — `Car`

---

### DELETE /events/{eventId}/carpool/cars/{driverId} — Cancel Car Offer

Driver only. **Response:** `204 No Content`

---

## 10. Tickets & Participations

### POST /hangouts/{hangoutId}/participations — Create Participation

**Request:**

```json
{
  "type": "TICKET_PURCHASED",        // required — see ParticipationType enum
  "section": "Section 201",          // optional, max 200 chars
  "seat": "Row A, Seat 4",          // optional, max 50 chars
  "reservationOfferId": null         // optional: links to a reservation offer
}
```

**Response:** `201 Created` — `ParticipationDTO`

```json
{
  "participationId": "uuid",
  "userId": "uuid",
  "displayName": "Brian",
  "mainImagePath": "...",
  "type": "TICKET_PURCHASED",
  "section": "Section 201",
  "seat": "Row A, Seat 4",
  "reservationOfferId": null,
  "createdAt": "2025-06-01T10:00:00Z",
  "updatedAt": "2025-06-01T10:00:00Z"
}
```

**MCP usage:** Flow 5.2 (Update Ticket Status). Map user intent:
- "I got my ticket" → `TICKET_PURCHASED`
- "I have an extra" → `TICKET_EXTRA`
- "I still need a ticket" → `TICKET_NEEDED`

---

### GET /hangouts/{hangoutId}/participations — List Participations

**Response:** `200 OK` — `ParticipationDTO[]`

---

### PUT /hangouts/{hangoutId}/participations/{participationId} — Update

**Request:** (all optional, null = no change)

```json
{
  "type": "TICKET_PURCHASED",
  "section": "GA",
  "seat": null
}
```

**Response:** `200 OK` — updated `ParticipationDTO`

---

### DELETE /hangouts/{hangoutId}/participations/{participationId}

**Response:** `204 No Content`

**Note:** For `CLAIMED_SPOT` participations, use the dedicated unclaim endpoint on ReservationOffers instead.

---

## 11. Reservation Offers

### POST /hangouts/{hangoutId}/reservation-offers — Create Offer

**Request:**

```json
{
  "type": "TICKET",              // required: "TICKET" or "RESERVATION"
  "buyDate": { /* TimeInfo */ }, // optional: deadline for commitments
  "section": "Section 102",     // optional, max 200 chars
  "capacity": 10,                // optional, 1–1000 (null = unlimited)
  "status": "COLLECTING"        // optional, defaults to "COLLECTING"
}
```

**Response:** `201 Created` — `ReservationOfferDTO`

```json
{
  "offerId": "uuid",
  "userId": "userId",
  "displayName": "Brian",
  "mainImagePath": "...",
  "type": "TICKET",
  "buyDate": null,
  "section": "Section 102",
  "capacity": 10,
  "claimedSpots": 0,
  "remainingSpots": 10,
  "status": "COLLECTING",
  "completedDate": null,
  "ticketCount": null,
  "totalPrice": null,
  "version": 1,
  "createdAt": "2025-06-01T10:00:00Z",
  "updatedAt": "2025-06-01T10:00:00Z"
}
```

---

### POST /hangouts/{hangoutId}/reservation-offers/{offerId}/claim-spot — Claim Spot

No request body.

**Response:** `201 Created` — `ParticipationDTO` with `type: "CLAIMED_SPOT"`

**Errors:**
- `409 CAPACITY_EXCEEDED` — no spots remaining

---

### POST /hangouts/{hangoutId}/reservation-offers/{offerId}/unclaim-spot — Unclaim Spot

No request body. **Response:** `204 No Content`

**Errors:**
- `400 ILLEGAL_OPERATION` — user never claimed a spot

---

### POST /hangouts/{hangoutId}/reservation-offers/{offerId}/complete — Complete Offer

**Request:**

```json
{
  "convertAll": true,                        // required boolean
  "participationIds": [],                    // required if convertAll=false
  "ticketCount": 5,                          // optional, >= 0
  "totalPrice": "125.00"                     // optional, decimal
}
```

**Response:** `200 OK` — completed `ReservationOfferDTO`

---

### GET /hangouts/{hangoutId}/reservation-offers — List Offers

**Response:** `200 OK` — `ReservationOfferDTO[]`

---

### PUT /hangouts/{hangoutId}/reservation-offers/{offerId} — Update Offer

**Request:** (all optional, null = no change)

```json
{
  "buyDate": { /* TimeInfo */ },
  "section": "Updated",
  "capacity": 15,
  "status": "COMPLETED"
}
```

**Response:** `200 OK` — updated `ReservationOfferDTO`

---

### DELETE /hangouts/{hangoutId}/reservation-offers/{offerId}

**Response:** `204 No Content`

---

## 12. Watch Parties

### GET /groups/{groupId}/watch-parties/{seriesId} — Watch Party Detail

**Response:** `200 OK` — `WatchPartyDetailResponse`

```json
{
  "seriesId": "uuid",
  "seriesTitle": "Severance Season 2",
  "groupId": "uuid",
  "eventSeriesType": "WATCH_PARTY",
  "showId": 12345,
  "seasonNumber": 2,
  "defaultTime": "20:00",
  "timezone": "America/Los_Angeles",
  "dayOverride": 5,
  "defaultHostId": "userId",
  "mainImagePath": "https://static.tvmaze.com/...",
  "hangouts": [
    {
      "hangoutId": "uuid",
      "title": "S2E5: Trojan's Horse",
      "startTimestamp": 1750035600,
      "endTimestamp": 1750039200,
      "externalId": "98765",
      "combinedExternalIds": ["98765"]
    }
  ],
  "interestLevels": [
    {
      "userId": "uuid",
      "level": "GOING",
      "userName": "Brian",
      "mainImagePath": "..."
    }
  ]
}
```

**MCP usage:** Flow 1.8 (Watch Party Status). Use `interestLevels` for "who's watching" and `hangouts` sorted by `startTimestamp` for episode schedule.

---

### POST /watch-parties/{seriesId}/interest — Set Series Interest

**Request:**

```json
{
  "level": "GOING"   // required: "GOING", "INTERESTED", or "NOT_GOING"
}
```

**Response:** `200 OK` — empty body

**Errors:**
- `400 VALIDATION_ERROR` — invalid level
- `403` — not a member of the watch party's group
- `404` — series not found

---

### DELETE /watch-parties/{seriesId}/interest — Remove Series Interest

**Response:** `204 No Content`

---

### POST /groups/{groupId}/watch-parties — Create Watch Party

**Request:**

```json
{
  "showId": 12345,                  // required: TVMaze show ID
  "seasonNumber": 2,                // required
  "showName": "Severance",          // required
  "defaultTime": "20:00",           // required: HH:mm format
  "timezone": "America/Los_Angeles", // required: IANA timezone
  "dayOverride": 5,                 // optional: 0 (Sun) – 6 (Sat)
  "defaultHostId": "userId",        // optional
  "showImageUrl": "https://static.tvmaze.com/...", // optional, must be tvmaze domain
  "tvmazeSeasonId": 456,            // optional: auto-fetch episodes from TVMaze
  "episodes": [                     // required if no tvmazeSeasonId
    {
      "episodeId": 98765,
      "episodeNumber": 1,
      "title": "Hello, Ms. Cobel",
      "airTimestamp": 1750035600,
      "runtime": 55
    }
  ]
}
```

**Note:** Either `tvmazeSeasonId` or `episodes` must be provided.

**Response:** `201 Created` — `WatchPartyResponse`

---

### PUT /groups/{groupId}/watch-parties/{seriesId} — Update Watch Party

**Request:** (all optional)

```json
{
  "defaultTime": "19:30",
  "timezone": "America/New_York",
  "dayOverride": null,
  "defaultHostId": "",
  "showImageUrl": "",
  "changeExistingUpcomingHangouts": true
}
```

**Response:** `200 OK` — `WatchPartyDetailResponse`

---

### DELETE /groups/{groupId}/watch-parties/{seriesId}

**Response:** `204 No Content`

---

## 13. Time Suggestions

For hangouts with no time set. Base path: `/groups/{groupId}/hangouts/{hangoutId}/time-suggestions`

### POST — Create Time Suggestion

**Request:**

```json
{
  "fuzzyTime": "THIS_WEEKEND",    // required — see FuzzyTime enum
  "specificTime": 1753200000       // optional: Unix timestamp (seconds)
}
```

**FuzzyTime values:** `TONIGHT`, `TOMORROW`, `THIS_WEEKEND`, `NEXT_WEEKEND`, `MONDAY`, `TUESDAY`, `WEDNESDAY`, `THURSDAY`, `FRIDAY`, `SATURDAY`, `SUNDAY`, `NEXT_WEEK`, `IN_TWO_WEEKS`, `THIS_MONTH`, `SOMETIME_SOON`

**Response:** `201 Created` — `TimeSuggestionDTO`

```json
{
  "suggestionId": "uuid",
  "hangoutId": "uuid",
  "groupId": "uuid",
  "suggestedBy": "userId",
  "fuzzyTime": "THIS_WEEKEND",
  "specificTime": null,
  "supporterIds": [],
  "supportCount": 0,
  "status": "ACTIVE",
  "createdAtMillis": 1712345678000
}
```

---

### POST /{suggestionId}/support — Endorse a Time Suggestion

No request body. **Response:** `200 OK` — updated `TimeSuggestionDTO`

---

### GET — List Time Suggestions

**Response:** `200 OK` — `TimeSuggestionDTO[]`

---

## 14. Invite Codes

### POST /groups/{groupId}/invite-code — Generate Invite Code

Must be a group member.

**Response:** `200 OK`

```json
{
  "inviteCode": "abc123XY",
  "shareUrl": "https://hangout.app/join/abc123XY"
}
```

**MCP usage:** Flow 3.7 (Generate Invite Link).

---

### GET /groups/invite/{inviteCode} — Preview Group (Public, No Auth)

Rate limited per IP.

**Response:** `200 OK`

For public group:
```json
{
  "isPrivate": false,
  "groupName": "Weekend Warriors",
  "mainImagePath": "groups/abc/main.jpg"
}
```

For private group:
```json
{
  "isPrivate": true
}
```

**Errors:**
- `404` — code not found/expired
- `429` — `{"error": "Rate limit exceeded", "message": "Too many requests. Please try again later."}` (note: different shape than standard errors — no `timestamp` field)

---

### POST /groups/invite/join — Join Group via Code

**Request:**

```json
{
  "inviteCode": "abc123XY"   // required, not blank
}
```

**Response:** `200 OK` — `GroupDTO` (the joined group, with `userRole: "MEMBER"`)

**Errors:**
- `400 VALIDATION_ERROR` — blank code, or user already a member
- `404 NOT_FOUND` — code not found/expired
- `409 TRANSACTION_FAILED` — concurrent join conflict

---

## 15. URL Parsing

### POST /external/parse — Parse Event from URL

**No authentication required.**

**Request:**

```json
{
  "url": "https://www.ticketmaster.com/event/..."   // required, valid HTTPS URL
}
```

**Response:** `200 OK`

```json
{
  "title": "Tame Impala at Red Rocks",
  "description": "Summer concert series...",
  "startTime": "2025-07-12T19:30:00-06:00",
  "endTime": "2025-07-12T23:00:00-06:00",
  "location": {
    "name": "Red Rocks Amphitheatre",
    "streetAddress": "18300 W Alameda Pkwy",
    "city": "Morrison",
    "state": "CO",
    "postalCode": "80465",
    "country": "US"
  },
  "imageUrl": "https://...",
  "url": "https://www.ticketmaster.com/...",
  "sourceUrl": "https://www.ticketmaster.com/...",
  "ticketOffers": [
    {
      "name": "General Admission",
      "url": "https://...",
      "price": 75.00,
      "priceCurrency": "USD",
      "availability": "InStock"
    }
  ]
}
```

**Errors:**
- `400` — invalid or unsafe URL
- `404` — no schema.org event data found on page
- `422` — unable to parse event data
- `503` — network error accessing URL

**MCP usage:** Flow 2.3 (Create Hangout from URL). Parse the URL, show results to user, then create hangout with the parsed data.

---

## 16. Profile

### GET /profile — Get User Profile

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "phoneNumber": "+15555550100",
  "username": "jeana",
  "displayName": "Jeana",
  "password": null,
  "mainImagePath": "users/abc/profile.jpg",
  "accountStatus": "ACTIVE",
  "creationDate": "2025-01-15T10:00:00Z",
  "isTestAccount": false
}
```

**Note:** `password` is always `null` in the response (stripped server-side).

**MCP usage:** Use at MCP connection setup to get the current user's ID and display name.

---

## 17. Enums & Constants

### MomentumCategory

Progression: `BUILDING` → `GAINING_MOMENTUM` → `CONFIRMED` (one-way, never demoted)

| Value | Meaning |
|-------|---------|
| `BUILDING` | Floated idea, early interest gathering |
| `GAINING_MOMENTUM` | Growing interest, details filling in |
| `CONFIRMED` | Locked in, it's happening |

### RSVP Status (InterestLevel)

| Value | MCP Terminology |
|-------|-----------------|
| `GOING` | "Going" / "I'm in" |
| `INTERESTED` | "Interested" / "Maybe" |
| `NOT_GOING` | "Can't make it" |

### EventVisibility

| Value | Meaning |
|-------|---------|
| `PUBLIC` | Anyone can see |
| `INVITE_ONLY` | Members of associated groups only |
| `ACCEPTED_ONLY` | Only those who've RSVP'd going |

### IdeaListCategory

`RESTAURANT`, `ACTIVITY`, `TRAIL`, `MOVIE`, `BOOK`, `TRAVEL`, `SHOW`, `BAR`, `OTHER`

### ParticipationType

| Value | Meaning |
|-------|---------|
| `TICKET_NEEDED` | User needs a ticket |
| `TICKET_PURCHASED` | User has a ticket |
| `TICKET_EXTRA` | User has extra tickets |
| `SECTION` | Section/seat info only |
| `CLAIMED_SPOT` | Claimed via reservation offer |

### OfferType

`TICKET`, `RESERVATION`

### OfferStatus

`COLLECTING`, `COMPLETED`, `CANCELLED`

### NudgeType

| Value | When Shown |
|-------|-----------|
| `SUGGEST_TIME` | Has interested people but no time |
| `ADD_LOCATION` | Has interested people but no location |
| `MAKE_RESERVATION` | Restaurant/food hangout with traction |
| `CONSIDER_TICKETS` | Event/entertainment with enough interest |

### FuzzyTime (for Time Suggestions)

`TONIGHT`, `TOMORROW`, `THIS_WEEKEND`, `NEXT_WEEKEND`, `MONDAY`, `TUESDAY`, `WEDNESDAY`, `THURSDAY`, `FRIDAY`, `SATURDAY`, `SUNDAY`, `NEXT_WEEK`, `IN_TWO_WEEKS`, `THIS_MONTH`, `SOMETIME_SOON`

### TimeInfo — periodGranularity Values

| Value | Duration Window |
|-------|----------------|
| `morning` | 4 hours |
| `afternoon` | 4 hours |
| `evening` | 4 hours |
| `night` | 8 hours |
| `day` | 12 hours |
| `weekend` | 48 hours |

**Note:** `exact` is rejected — use `startTime`/`endTime` for exact times.

### TimeInfo Object (Two Modes)

**Fuzzy time:**
```json
{
  "periodGranularity": "evening",
  "periodStart": "2025-08-09T18:00:00-07:00"
}
```

**Exact time:**
```json
{
  "startTime": "2025-08-09T19:00:00-07:00",
  "endTime": "2025-08-09T22:00:00-07:00"
}
```

Use one mode or the other, not both. `periodStart` and `startTime`/`endTime` are ISO 8601 with timezone offset.

### Address Object

```json
{
  "name": "Red Rocks Amphitheatre",
  "streetAddress": "18300 W Alameda Pkwy",
  "city": "Morrison",
  "state": "CO",
  "postalCode": "80465",
  "country": "US"
}
```

All fields optional strings. Can also be deserialized from a plain string (maps to `streetAddress` only).

---

## 18. Error Reference

### Error Codes by HTTP Status

| Status | Error Code | Description |
|--------|-----------|-------------|
| **400** | `VALIDATION_ERROR` | Field validation failure, constraint violation |
| **400** | `NO_AVAILABLE_SEATS` | Carpool car is full |
| **400** | `ILLEGAL_OPERATION` | Business rule violation |
| **400** | `INVALID_KEY` | Malformed UUID |
| **400** | `INVALID_PLACE_OWNER` | Invalid place owner |
| **400** | `TVMAZE_NO_EPISODES` | TVMaze season has no episodes |
| **401** | `AUTHENTICATION_REQUIRED` | No Authorization header |
| **401** | `TOKEN_EXPIRED` | Invalid/expired JWT |
| **403** | `UNAUTHORIZED` | Insufficient permissions (misleading name — means forbidden) |
| **404** | `NOT_FOUND` | Generic resource not found |
| **404** | `USER_NOT_FOUND` | User doesn't exist |
| **404** | `EVENT_NOT_FOUND` | Hangout doesn't exist |
| **404** | `CAR_NOT_FOUND` | Carpool car not found |
| **404** | `PLACE_NOT_FOUND` | Place not found |
| **404** | `OFFER_NOT_FOUND` | Reservation offer not found |
| **404** | `PARTICIPATION_NOT_FOUND` | Participation not found |
| **409** | `TRANSACTION_FAILED` | DynamoDB transaction failure |
| **409** | `VERSION_CONFLICT` | Optimistic locking failure |
| **409** | `CAPACITY_EXCEEDED` | Capacity limit hit |
| **409** | `CONFLICT` | DynamoDB conditional check failure |
| **409** | `TRANSACTION_CONFLICT` | DynamoDB transaction canceled |
| **429** | `THROTTLED` | DynamoDB throughput exceeded |
| **429** | `TOO_MANY_REQUESTS` | Rate limit exceeded |
| **500** | `INTERNAL_ERROR` | Unexpected server error |
| **500** | `REPOSITORY_ERROR` | Database write failure |
| **500** | `DATABASE_ERROR` | Unexpected DynamoDB error |
| **501** | `NOT_IMPLEMENTED` | Unsupported operation |
| **503** | `SERVICE_UNAVAILABLE` | Downstream service unavailable |
| **503** | `TVMAZE_SERVICE_UNAVAILABLE` | TVMaze API unreachable |

### Error Response Shapes

**Shape A** (most endpoints — controllers extending `BaseController`):
```json
{"error": "ERROR_CODE", "message": "Human-readable", "timestamp": 1712345678901}
```

**Shape B** (older auth/profile controllers):
```json
{"error": "message or code"}
```

**Shape C** (rate limiting on invite preview):
```json
{"error": "Rate limit exceeded", "message": "Too many requests. Please try again later."}
```

### Handling Guidance for MCP

| Error | MCP Agent Response |
|-------|-------------------|
| `401 AUTHENTICATION_REQUIRED` / `TOKEN_EXPIRED` | "Your session has expired. Please log in again via the app." |
| `403 UNAUTHORIZED` | "You don't have access to that. You might not be a member of that group." |
| `404 NOT_FOUND` | "I couldn't find that [hangout/group/etc]." |
| `409 VERSION_CONFLICT` | Retry the request once (someone else updated simultaneously) |
| `409 TRANSACTION_FAILED` | Retry once, then: "Something went wrong, try again." |
| `429 THROTTLED` / `TOO_MANY_REQUESTS` | Wait 5 seconds and retry once |
| `500 INTERNAL_ERROR` | "Something went wrong on the server. Try again, or check in the app." |

---

## API Mapping Summary (MCP Flow → Endpoints)

| MCP Flow | Endpoints Used |
|----------|---------------|
| 1.1 List Groups | `GET /groups` |
| 1.2 Group Feed | `GET /groups/{id}/feed` |
| 1.3 All Groups Feed | `GET /groups` → `GET /groups/{id}/feed` for each |
| 1.4 Hangout Detail | `GET /hangouts/{id}` |
| 1.5 Who's Going | `GET /hangouts/{id}` → read `attendance` |
| 1.6 Idea Lists | `GET /groups/{id}/idea-lists` |
| 1.7 Poll Results | `GET /hangouts/{id}/polls/{pollId}` |
| 1.8 Watch Party | `GET /groups/{id}/watch-parties/{seriesId}` |
| 2.1 Float Hangout | `POST /hangouts` with `confirmed: false` |
| 2.2 Lock In Hangout | `POST /hangouts` with `confirmed: true` |
| 2.3 From URL | `POST /external/parse` → `POST /hangouts` |
| 2.4 Create Group | `POST /groups` |
| 2.5 Add Idea | `POST /groups/{id}/idea-lists/{listId}/ideas` |
| 2.6 Create Idea List | `POST /groups/{id}/idea-lists` |
| 2.7 Create Poll | `POST /hangouts/{id}/polls` |
| 3.1 RSVP | `PUT /hangouts/{id}/interest` |
| 3.1 Retract RSVP | `DELETE /hangouts/{id}/interest` |
| 3.2 Vote | `POST /hangouts/{id}/polls/{pollId}/vote` |
| 3.2 Add Option + Vote | `POST /hangouts/{id}/polls/{pollId}/options` → `POST .../vote` |
| 3.3 Suggest Time | `PATCH /hangouts/{id}` with `timeInfo` |
| 3.3 Suggest Place | `PATCH /hangouts/{id}` with `location` |
| 3.4 Confirm | `PATCH /hangouts/{id}` with `confirmed: true` |
| 3.5 Edit Details | `PATCH /hangouts/{id}` |
| 3.6 Add Member | `POST /groups/{id}/members` |
| 3.7 Invite Link | `POST /groups/{id}/invite-code` |
| 3.8 Idea Interest | `PUT /groups/{id}/idea-lists/{listId}/ideas/{ideaId}/interest` |
| 3.9 Hangout from Idea | `POST /hangouts` with `sourceIdeaId` + `sourceIdeaListId` |
| 4.1 Carpool Status | `GET /hangouts/{id}` → read `cars`, `carRiders`, `needsRide` |
| 4.2 Offer Ride | `POST /events/{id}/carpool/cars` |
| 4.3 Request Ride | `POST /events/{id}/carpool/riderequests` |
| 5.1 Ticket Status | `GET /hangouts/{id}` → read `participations` + `participationSummary` |
| 5.2 Update Tickets | `POST /hangouts/{id}/participations` or `PUT .../participations/{pid}` |
| 6.1 Weekend Summary | `GET /groups` → `GET /groups/{id}/feed` for each (filter by weekend) |
| 6.2 Needs Attention | `GET /groups/{id}/feed` → check `nudges`, timeless hangouts, low-vote polls |
| 6.4 Batch RSVP | `PUT /hangouts/{id}/interest` for each hangout |

---

## Important Notes for MCP Implementation

1. **Carpool endpoints use `/events/{eventId}/`** (legacy path), not `/hangouts/`. The hangout ID works as the event ID.

2. **Feed sorting:** `withDay` items are sorted chronologically, then by momentum (CONFIRMED → GAINING_MOMENTUM → BUILDING). `needsDay` items have no time and appear separately.

3. **InterestLevel in feed vs detail:** The feed's `interestLevels` array on each hangout gives you RSVP data without needing a separate detail call. Use this for "who's going" summaries in list views.

4. **ParticipationSummary in feed:** The feed's `participationSummary` gives grouped ticket data (who needs, who has, extras) without a detail call. Use for ticket status summaries.

5. **Momentum score interpretation:** In feed responses, the raw score is returned (not normalized 0-100). In detail responses, it's normalized. Prefer `category` over `score` for display.

6. **ETag caching:** Implement ETag support on feed calls. If you get `304 Not Modified`, use your cached version. This is important for the "all groups" flows that hit multiple feeds.

7. **Disambiguation:** When the user says "the hiking trip," you'll need to search across feeds by title. Consider fuzzy matching since users won't use exact titles.

8. **Version gating:** Always send `X-App-Version: 2.1.0` to get nudges, time suggestions, suggested attributes, and watch parties in responses.

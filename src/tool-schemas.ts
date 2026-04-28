/**
 * MCP tool schema definitions for all 5 chunk-1 tools.
 * Each schema follows the MCP tool format: name, description, inputSchema.
 */

export const TOOL_SCHEMAS = {
  build_time: {
    name: 'build_time',
    description:
      "Convert a natural language time expression into a structured TimeInfo object for use with create_hangout or update_hangout. Always use this tool to construct time values — do not build TimeInfo JSON manually.\n\nExamples of inputs: 'Saturday afternoon', '7pm Friday', 'this weekend', 'tomorrow evening', 'June 14 at 7:30 PM', 'next Saturday morning'.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description:
            "Natural language time expression (e.g., 'Saturday afternoon', '7pm Friday', 'this weekend')",
        },
      },
      required: ['text'],
    },
  },

  list_groups: {
    name: 'list_groups',
    description:
      "List all groups the user belongs to. Returns group names and IDs. Use this first when the user mentions a group by name — match the name to get the groupId needed by other tools. Also use when the user asks 'what groups am I in?' or you need to iterate all groups for cross-group queries.",
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  get_group_feed: {
    name: 'get_group_feed',
    description:
      "Get upcoming hangouts and watch party series for a group. Returns two lists: 'scheduled' (hangouts with a date/time, sorted chronologically) and 'timeless' (hangouts with no date yet). Each hangout includes its title, hangoutId, momentum status (BUILDING, GAINING_MOMENTUM, or CONFIRMED), time info, location, attendance summary, and poll/ticket/carpool summaries. Use this to answer 'what's coming up?', 'what's happening this weekend?', or to find a hangout by name when you need its hangoutId. For cross-group queries, call this once per group from list_groups.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'UUID of the group',
        },
        filter: {
          type: 'string',
          enum: ['ALL', 'CONFIRMED', 'EVERYTHING'],
          description:
            'Filter hangouts. ALL = non-faded items (default). CONFIRMED = only confirmed. EVERYTHING = include faded/past.',
        },
      },
      required: ['groupId'],
    },
  },

  create_hangout: {
    name: 'create_hangout',
    description:
      "Create a new hangout in a group. Set confirmed=false to 'float it' (casual suggestion, creator marked as interested) or confirmed=true to 'lock it in' (it's happening, creator marked as going — requires time). At minimum provide a title and groupId. Optionally include time, location, description, and polls.\n\nFor time: use build_time first to convert natural language into a timeInfo object, then pass that object here. Do not construct timeInfo manually.\n\nTo create a hangout from an idea list, include sourceIdeaId AND sourceIdeaListId (both required).",
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'UUID of the group to create the hangout in',
        },
        title: {
          type: 'string',
          description: 'Hangout title, 1-100 characters',
        },
        description: {
          type: 'string',
          description: 'Optional description',
        },
        confirmed: {
          type: 'boolean',
          description: "false = 'float it' (default), true = 'lock it in' (requires time)",
        },
        timeInfo: {
          type: 'object',
          description:
            'Time for the hangout. Use EITHER {periodGranularity, periodStart} for fuzzy times OR {startTime, endTime} for exact times.',
          properties: {
            periodGranularity: {
              type: 'string',
              enum: ['morning', 'afternoon', 'evening', 'night', 'day', 'weekend'],
            },
            periodStart: {
              type: 'string',
              description: 'ISO 8601 datetime with timezone offset',
            },
            startTime: {
              type: 'string',
              description: 'ISO 8601 datetime with timezone offset',
            },
            endTime: {
              type: 'string',
              description: 'ISO 8601 datetime with timezone offset',
            },
          },
        },
        location: {
          type: 'object',
          description: 'Location for the hangout',
          properties: {
            name: { type: 'string' },
            streetAddress: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            postalCode: { type: 'string' },
            country: { type: 'string' },
          },
        },
        carpoolEnabled: {
          type: 'boolean',
          description: 'Enable carpooling. Default false.',
        },
        ticketLink: {
          type: 'string',
          description: 'URL where tickets can be purchased',
        },
        ticketsRequired: {
          type: 'boolean',
          description: 'Whether tickets are needed for this hangout',
        },
        discountCode: {
          type: 'string',
          description: 'Discount/promo code for tickets',
        },
        polls: {
          type: 'array',
          description: 'Polls to create with the hangout',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
            },
            required: ['title'],
          },
        },
        sourceIdeaId: {
          type: 'string',
          description:
            'UUID of the idea this hangout is created from. Requires sourceIdeaListId.',
        },
        sourceIdeaListId: {
          type: 'string',
          description:
            'UUID of the idea list containing the source idea. Required when sourceIdeaId is provided.',
        },
      },
      required: ['groupId', 'title'],
    },
  },

  set_rsvp: {
    name: 'set_rsvp',
    description:
      "Set the user's RSVP status for a hangout. Use GOING for 'I'm going' / 'I'm in' / 'count me in'. Use INTERESTED for 'I'm interested' / 'sounds good'. Use NOT_GOING for 'I can't make it' / 'count me out'. Optionally include a note.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout',
        },
        status: {
          type: 'string',
          enum: ['GOING', 'INTERESTED', 'NOT_GOING'],
          description: 'RSVP status',
        },
        notes: {
          type: 'string',
          description: "Optional note (e.g. 'Bringing chips'), max 500 chars",
        },
      },
      required: ['hangoutId', 'status'],
    },
  },
  get_idea_lists: {
    name: 'get_idea_lists',
    description:
      "Get all idea lists for a group, or a specific list with its ideas. Each idea list has a name, category, and list of ideas with interest counts. Use when the user asks about restaurant/trail/show lists, or when you need to find an ideaId or ideaListId for other operations.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'UUID of the group',
        },
        listId: {
          type: 'string',
          description:
            'UUID of a specific idea list. If omitted, returns all lists for the group.',
        },
      },
      required: ['groupId'],
    },
  },

  get_watch_party: {
    name: 'get_watch_party',
    description:
      "Get details for a watch party series including episode schedule, who's watching, and next episode info. You need the seriesId — find it from get_group_feed where type='series'.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'UUID of the group',
        },
        seriesId: {
          type: 'string',
          description: 'UUID of the watch party series',
        },
      },
      required: ['groupId', 'seriesId'],
    },
  },

  create_idea_list: {
    name: 'create_idea_list',
    description:
      "Create a new idea list in a group. Infer the category from context: 'restaurant list' → RESTAURANT, 'trail list' → TRAIL, 'show ideas' → SHOW, 'bar list' → BAR, 'book list' → BOOK, 'movie list' → MOVIE, 'travel list' → TRAVEL, 'activity list' → ACTIVITY. Default to OTHER if unclear.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'UUID of the group',
        },
        name: {
          type: 'string',
          description: 'List name, 1-100 characters',
        },
        category: {
          type: 'string',
          enum: ['RESTAURANT', 'ACTIVITY', 'TRAIL', 'MOVIE', 'BOOK', 'TRAVEL', 'SHOW', 'BAR', 'OTHER'],
          description: 'Category for the list',
        },
        note: {
          type: 'string',
          description: 'Optional description, max 500 characters',
        },
      },
      required: ['groupId', 'name'],
    },
  },

  add_idea: {
    name: 'add_idea',
    description:
      'Add an idea to an existing idea list. At minimum provide a name. For places (restaurants, bars, trails), include address info if known.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'UUID of the group',
        },
        listId: {
          type: 'string',
          description: 'UUID of the idea list',
        },
        name: {
          type: 'string',
          description: 'Idea name, 1-200 characters',
        },
        note: {
          type: 'string',
          description: 'Optional note, max 1000 characters',
        },
        url: {
          type: 'string',
          description: 'Optional URL for the idea',
        },
        address: {
          type: 'string',
          description: 'Optional address, max 500 characters',
        },
      },
      required: ['groupId', 'listId', 'name'],
    },
  },

  toggle_idea_interest: {
    name: 'toggle_idea_interest',
    description:
      "Toggle the user's interest on an idea. If the user is not interested, marks them as interested. If already interested, removes their interest.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'UUID of the group',
        },
        listId: {
          type: 'string',
          description: 'UUID of the idea list',
        },
        ideaId: {
          type: 'string',
          description: 'UUID of the idea',
        },
        interested: {
          type: 'boolean',
          description: 'true to add interest, false to remove',
        },
      },
      required: ['groupId', 'listId', 'ideaId', 'interested'],
    },
  },

  offer_ride: {
    name: 'offer_ride',
    description:
      'Offer a ride (carpool) for a hangout. Capacity is total seats including the driver, between 2 and 8.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout',
        },
        capacity: {
          type: 'integer',
          minimum: 2,
          maximum: 8,
          description: 'Total seats including driver (2-8)',
        },
        notes: {
          type: 'string',
          description: "Optional note (e.g., 'Leaving from downtown at 5pm'), max 500 chars",
        },
      },
      required: ['hangoutId', 'capacity'],
    },
  },

  request_ride: {
    name: 'request_ride',
    description:
      "Request a ride to a hangout. Lets the group know you need a ride.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout',
        },
        notes: {
          type: 'string',
          description: "Optional note (e.g., 'Coming from north side'), max 500 chars",
        },
      },
      required: ['hangoutId'],
    },
  },

  update_ticket_status: {
    name: 'update_ticket_status',
    description:
      "Update the user's ticket status for a hangout. Use TICKET_PURCHASED for 'I got my ticket', TICKET_EXTRA for 'I have extra tickets', TICKET_NEEDED for 'I still need a ticket'. Optionally include section and seat info.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout',
        },
        type: {
          type: 'string',
          enum: ['TICKET_PURCHASED', 'TICKET_EXTRA', 'TICKET_NEEDED'],
          description: 'Ticket status type',
        },
        section: {
          type: 'string',
          description: "Optional section info (e.g., 'Section 201'), max 200 chars",
        },
        seat: {
          type: 'string',
          description: "Optional seat info (e.g., 'Row A, Seat 4'), max 50 chars",
        },
      },
      required: ['hangoutId', 'type'],
    },
  },

  parse_event_url: {
    name: 'parse_event_url',
    description:
      'Parse event details from a URL (Ticketmaster, Eventbrite, etc.). Returns structured event data that can be used to create a hangout. After showing the parsed details to the user, use create_hangout with the parsed data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'HTTPS URL of the event page',
        },
      },
      required: ['url'],
    },
  },

  get_hangout_detail: {
    name: 'get_hangout_detail',
    description:
      "Get full details for a specific hangout including attendance list (with names), polls with results, carpool status, and ticket status. Use this when the user asks about a specific hangout's details, who's going, poll results, carpool situation, or ticket status. You need the hangoutId — find it first using get_group_feed if you only have a name.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout',
        },
      },
      required: ['hangoutId'],
    },
  },

  update_hangout: {
    name: 'update_hangout',
    description:
      "Update an existing hangout. Use this to suggest a time, suggest a place, confirm a hangout ('lock it in'), or edit any detail. Only fields you include will be changed. To confirm a hangout, set confirmed=true. For time changes, use build_time first to get the timeInfo object.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout to update',
        },
        title: { type: 'string' },
        description: { type: 'string' },
        confirmed: {
          type: 'boolean',
          description: 'Set to true to confirm/lock in the hangout',
        },
        timeInfo: {
          type: 'object',
          description: 'Same format as create_hangout timeInfo',
          properties: {
            periodGranularity: {
              type: 'string',
              enum: ['morning', 'afternoon', 'evening', 'night', 'day', 'weekend'],
            },
            periodStart: { type: 'string' },
            startTime: { type: 'string' },
            endTime: { type: 'string' },
          },
        },
        location: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            streetAddress: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            postalCode: { type: 'string' },
            country: { type: 'string' },
          },
        },
        carpoolEnabled: { type: 'boolean' },
        ticketLink: { type: 'string' },
        ticketsRequired: { type: 'boolean' },
        discountCode: { type: 'string' },
      },
      required: ['hangoutId'],
    },
  },

  remove_rsvp: {
    name: 'remove_rsvp',
    description:
      "Remove the user's RSVP from a hangout entirely. Use when the user says 'remove my RSVP' or 'take me off that'.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout',
        },
      },
      required: ['hangoutId'],
    },
  },

  create_group: {
    name: 'create_group',
    description:
      'Create a new group. The user becomes the admin. Groups are private by default.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupName: {
          type: 'string',
          description: 'Name for the group, 1-100 characters',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the group is publicly visible. Default false.',
        },
      },
      required: ['groupName'],
    },
  },

  create_poll: {
    name: 'create_poll',
    description:
      "Create a poll on a hangout, or start a new suggestion list (the GUI presents polls as suggestion lists). Use this whenever the user wants to 'make a suggestion', 'suggest a time', 'suggest a place', 'put up options', 'start a vote', or any phrasing that proposes alternatives for the group to weigh in on. Also use it for traditional polls.\n\nFor a TIME poll (proposing one or more times for an undecided hangout), set attributeType='TIME' and pass each option as { timeInput: TimeInfo }. Use build_time first to construct each timeInput from natural language. TIME polls are auto-multipleChoice.\n\nFor a regular text poll, omit attributeType and pass options as { text: '...' }.\n\nIf the hangout already has an active TIME poll, use add_poll_option to add another time suggestion to it instead of calling this tool.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout (referred to as eventId in the API)',
        },
        title: {
          type: 'string',
          description: "Poll question, 1-200 characters. For TIME polls a generic title like 'Vote on a time' works.",
        },
        attributeType: {
          type: 'string',
          enum: ['TIME', 'LOCATION', 'DESCRIPTION'],
          description:
            "Optional poll kind. Use 'TIME' to propose times for an undecided hangout (each option needs timeInput, not text). Omit for a generic text poll.",
        },
        options: {
          type: 'array',
          description:
            "Initial options. For TIME polls each option must have { timeInput }. For other polls each option must have { text } (1-100 chars).",
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Option text for non-TIME polls (1-100 chars).',
              },
              timeInput: {
                type: 'object',
                description:
                  'Time for a TIME poll option. Use EITHER {periodGranularity, periodStart} for fuzzy times OR {startTime, endTime} for exact times. Build via build_time.',
                properties: {
                  periodGranularity: {
                    type: 'string',
                    enum: ['morning', 'afternoon', 'evening', 'night', 'day', 'weekend'],
                  },
                  periodStart: { type: 'string', description: 'ISO 8601 datetime with timezone offset' },
                  startTime: { type: 'string', description: 'ISO 8601 datetime with timezone offset' },
                  endTime: { type: 'string', description: 'ISO 8601 datetime with timezone offset' },
                },
              },
            },
          },
        },
        multipleChoice: {
          type: 'boolean',
          description: 'Allow multiple votes per person. Default false. Ignored for TIME polls (always multi).',
        },
      },
      required: ['hangoutId', 'title'],
    },
  },

  vote_on_poll: {
    name: 'vote_on_poll',
    description:
      "Cast a vote on a poll option, or '+1 / support' a time suggestion (TIME polls — see get_hangout_detail.timeSuggestions). Voting twice for the same option is idempotent. Use this when the user says 'I'll go with that one', 'support this time', '+1 the Saturday option', or 'vote for X'. To add a new option and vote on it, first call add_poll_option, then vote on the returned optionId.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout',
        },
        pollId: {
          type: 'string',
          description: 'UUID of the poll',
        },
        optionId: {
          type: 'string',
          description: 'UUID of the option to vote for',
        },
      },
      required: ['hangoutId', 'pollId', 'optionId'],
    },
  },

  add_poll_option: {
    name: 'add_poll_option',
    description:
      "Add a new option to an existing poll/suggestion list — i.e., 'make another suggestion', 'add another time', 'propose another option', or 'add an option to a poll'. The GUI presents polls as suggestion lists, so primary user phrasing will be about suggesting, not voting.\n\nFor a TIME poll (visible in get_hangout_detail's timeSuggestions array), pass timeInput. Use build_time first to convert natural language. For a regular text poll, pass text.\n\nReturns the new optionId, which can be passed to vote_on_poll if the user also wants to support their own suggestion.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        hangoutId: {
          type: 'string',
          description: 'UUID of the hangout',
        },
        pollId: {
          type: 'string',
          description: 'UUID of the poll. For a time suggestion, this is the pollId from get_hangout_detail.timeSuggestions[].',
        },
        text: {
          type: 'string',
          description: 'Option text for a regular (non-TIME) poll, 1-100 characters. Omit for TIME polls.',
        },
        timeInput: {
          type: 'object',
          description:
            "Required for TIME polls (time suggestions). Use EITHER {periodGranularity, periodStart} for fuzzy times OR {startTime, endTime} for exact times. Build via build_time. Omit for non-TIME polls.",
          properties: {
            periodGranularity: {
              type: 'string',
              enum: ['morning', 'afternoon', 'evening', 'night', 'day', 'weekend'],
            },
            periodStart: { type: 'string', description: 'ISO 8601 datetime with timezone offset' },
            startTime: { type: 'string', description: 'ISO 8601 datetime with timezone offset' },
            endTime: { type: 'string', description: 'ISO 8601 datetime with timezone offset' },
          },
        },
      },
      required: ['hangoutId', 'pollId'],
    },
  },

  add_member: {
    name: 'add_member',
    description:
      "Add a member to a group by phone number or user ID. Use phone number when the user says 'add 555-123-4567 to the group'. Format the phone number as E.164 (e.g., +15551234567).",
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'UUID of the group',
        },
        phoneNumber: {
          type: 'string',
          description: 'Phone number in E.164 format (e.g., +15551234567)',
        },
        userId: {
          type: 'string',
          description: 'UUID of the user to add',
        },
      },
      required: ['groupId'],
    },
  },

  generate_invite_link: {
    name: 'generate_invite_link',
    description:
      'Generate a shareable invite link for a group. Anyone with the link can join.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'UUID of the group',
        },
      },
      required: ['groupId'],
    },
  },
} as const;

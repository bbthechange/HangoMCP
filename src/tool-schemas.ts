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
} as const;

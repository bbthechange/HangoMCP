/**
 * Fixture factories for MCP server tests.
 * Each builder returns a valid object with sensible defaults;
 * pass overrides to customise individual fields.
 */

import type {
  Address,
  ApiGroupDTO,
  ApiGroupFeedResponse,
  ApiHangoutDetail,
  ApiHangoutSummary,
  ApiSeriesSummary,
  InterestLevel,
  Momentum,
  TimeInfo,
} from '../types.js';

// ─── Primitives ─────────────────────────────────────────────────────────────

let _seq = 0;
function seq(): string {
  return String(++_seq).padStart(3, '0');
}

/** Reset the sequence counter (call between test files if needed). */
export function resetSeq(): void {
  _seq = 0;
}

export function buildTimeInfo(overrides?: Partial<TimeInfo>): TimeInfo {
  return {
    startTime: '2025-04-12T19:00:00-07:00',
    ...overrides,
  };
}

export function buildAddress(overrides?: Partial<Address>): Address {
  return {
    name: 'Central Park',
    streetAddress: '123 Main St',
    city: 'Portland',
    state: 'OR',
    ...overrides,
  };
}

export function buildMomentum(overrides?: Partial<Momentum>): Momentum {
  return {
    score: 50,
    category: 'BUILDING',
    confirmedAt: null,
    confirmedBy: null,
    suggestedBy: null,
    ...overrides,
  };
}

export function buildInterestLevel(overrides?: Partial<InterestLevel>): InterestLevel {
  const id = seq();
  return {
    eventId: `hangout-${id}`,
    userId: `user-${id}`,
    userName: `User ${id}`,
    status: 'GOING',
    notes: null,
    mainImagePath: null,
    ...overrides,
  };
}

// ─── API Response Factories ─────────────────────────────────────────────────

export function buildHangout(overrides?: Partial<ApiHangoutSummary>): ApiHangoutSummary {
  const id = seq();
  return {
    type: 'hangout',
    hangoutId: `hangout-${id}`,
    title: `Test Hangout ${id}`,
    status: null,
    timeInfo: buildTimeInfo(),
    location: buildAddress(),
    participantCount: 3,
    mainImagePath: null,
    description: 'A test hangout',
    visibility: 'GROUP',
    carpoolEnabled: false,
    startTimestamp: 1744498800000,
    endTimestamp: null,
    seriesId: null,
    seriesTitle: null,
    seriesImagePath: null,
    eventSeriesType: null,
    polls: [],
    cars: [],
    needsRide: [],
    attributes: [],
    interestLevels: [
      buildInterestLevel({ status: 'GOING', userId: 'user-001', userName: 'Test User' }),
      buildInterestLevel({ status: 'INTERESTED' }),
      buildInterestLevel({ status: 'NOT_GOING' }),
    ],
    participationSummary: null,
    ticketLink: null,
    ticketsRequired: null,
    discountCode: null,
    externalId: null,
    externalSource: null,
    isGeneratedTitle: false,
    hostAtPlaceUserId: null,
    hostAtPlaceDisplayName: null,
    hostAtPlaceImagePath: null,
    momentum: buildMomentum(),
    suggestedAttributes: {},
    nudges: [],
    ...overrides,
  };
}

export function buildSeries(overrides?: Partial<ApiSeriesSummary>): ApiSeriesSummary {
  const id = seq();
  return {
    type: 'series',
    seriesId: `series-${id}`,
    seriesTitle: `Test Series ${id}`,
    seriesDescription: null,
    primaryEventId: `hangout-${id}`,
    startTimestamp: null,
    endTimestamp: null,
    mainImagePath: null,
    parts: [],
    totalParts: 4,
    eventSeriesType: 'TV_WATCH_PARTY',
    externalId: null,
    externalSource: null,
    isGeneratedTitle: false,
    ...overrides,
  };
}

export function buildFeedResponse(overrides?: Partial<ApiGroupFeedResponse>): ApiGroupFeedResponse {
  return {
    groupId: 'group-001',
    withDay: [],
    needsDay: [],
    nextPageToken: null,
    previousPageToken: null,
    ...overrides,
  };
}

export function buildGroup(overrides?: Partial<ApiGroupDTO>): ApiGroupDTO {
  const id = seq();
  return {
    groupId: `group-${id}`,
    groupName: `Test Group ${id}`,
    isPublic: false,
    userRole: 'ADMIN',
    joinedAt: '2025-01-01T00:00:00Z',
    mainImagePath: null,
    backgroundImagePath: null,
    userMainImagePath: null,
    ...overrides,
  };
}

export function buildHangoutDetail(overrides?: Partial<ApiHangoutDetail>): ApiHangoutDetail {
  return {
    hangout: {
      hangoutId: 'hangout-detail-001',
      title: 'Detail Hangout',
      description: 'A detailed hangout',
      location: buildAddress(),
      visibility: 'GROUP',
      mainImagePath: null,
      timeInfo: buildTimeInfo(),
      startTimestamp: 1744498800000,
      endTimestamp: null,
      associatedGroups: ['group-001'],
      carpoolEnabled: false,
      version: 1,
      createdBy: 'user-001',
      momentumCategory: 'BUILDING',
      momentumScore: 50,
      confirmedAt: null,
      confirmedBy: null,
      suggestedBy: null,
      sourceIdeaId: null,
      sourceIdeaListId: null,
      externalId: null,
      externalSource: null,
      isGeneratedTitle: false,
      hostAtPlaceUserId: null,
      placeCategory: null,
      ticketLink: null,
      ticketsRequired: null,
      discountCode: null,
      seriesId: null,
    },
    attributes: [],
    polls: [],
    attendance: [
      buildInterestLevel({ eventId: 'hangout-detail-001', userId: 'user-001', userName: 'Test User', status: 'GOING' }),
    ],
    cars: [],
    carRiders: [],
    needsRide: [],
    participations: [],
    reservationOffers: [],
    votes: [],
    hostAtPlaceDisplayName: null,
    hostAtPlaceImagePath: null,
    momentum: buildMomentum(),
    suggestedAttributes: {},
    nudges: [],
    ...overrides,
  };
}

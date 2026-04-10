import { describe, it, expect } from 'vitest';
import {
  formatTimeInfo,
  formatAddress,
  computeAttendance,
  findUserRsvp,
  formatFeedHangout,
  formatGroupFeed,
} from './formatters.js';
import {
  buildHangout,
  buildInterestLevel,
  buildAddress,
  buildTimeInfo,
  buildFeedResponse,
  buildSeries,
} from './__fixtures__/index.js';

const TZ = 'America/Los_Angeles';

describe('formatTimeInfo', () => {
  it('formats exact start time', () => {
    const result = formatTimeInfo({ startTime: '2025-04-12T19:00:00-07:00' }, TZ);
    expect(result).toBe("Saturday, Apr 12 at 7:00 PM");
  });

  it('formats start + end same day', () => {
    const result = formatTimeInfo({
      startTime: '2025-04-12T19:00:00-07:00',
      endTime: '2025-04-12T22:00:00-07:00',
    }, TZ);
    expect(result).toBe("Saturday, Apr 12 at 7:00 PM – 10:00 PM");
  });

  it('formats start + end different day', () => {
    const result = formatTimeInfo({
      startTime: '2025-04-12T19:00:00-07:00',
      endTime: '2025-04-13T02:00:00-07:00',
    }, TZ);
    expect(result).toBe("Saturday, Apr 12 at 7:00 PM – Apr 13 at 2:00 AM");
  });

  it('formats morning period', () => {
    const result = formatTimeInfo({
      periodGranularity: 'morning',
      periodStart: '2025-04-12T09:00:00-07:00',
    }, TZ);
    expect(result).toBe('Saturday, Apr 12 morning');
  });

  it('formats afternoon period', () => {
    const result = formatTimeInfo({
      periodGranularity: 'afternoon',
      periodStart: '2025-04-12T12:00:00-07:00',
    }, TZ);
    expect(result).toBe('Saturday, Apr 12 afternoon');
  });

  it('formats evening period', () => {
    const result = formatTimeInfo({
      periodGranularity: 'evening',
      periodStart: '2025-04-12T17:00:00-07:00',
    }, TZ);
    expect(result).toBe('Saturday, Apr 12 evening');
  });

  it('formats night period', () => {
    const result = formatTimeInfo({
      periodGranularity: 'night',
      periodStart: '2025-04-12T20:00:00-07:00',
    }, TZ);
    expect(result).toBe('Saturday, Apr 12 night');
  });

  it('formats day granularity', () => {
    const result = formatTimeInfo({
      periodGranularity: 'day',
      periodStart: '2025-04-12T00:00:00-07:00',
    }, TZ);
    expect(result).toBe('Saturday, Apr 12');
  });

  it('formats weekend granularity', () => {
    const result = formatTimeInfo({
      periodGranularity: 'weekend',
      periodStart: '2025-04-12T00:00:00-07:00',
    }, TZ);
    expect(result).toBe('Weekend of Apr 12');
  });

  it('returns null for null input', () => {
    expect(formatTimeInfo(null, TZ)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(formatTimeInfo(undefined, TZ)).toBeNull();
  });

  it('returns null for empty object', () => {
    expect(formatTimeInfo({}, TZ)).toBeNull();
  });

  it('returns null for invalid ISO string', () => {
    expect(formatTimeInfo({ startTime: 'not-a-date' }, TZ)).toBeNull();
  });
});

describe('formatAddress', () => {
  it('formats full address', () => {
    const addr = buildAddress({ name: 'The Venue', streetAddress: '123 Main', city: 'Portland', state: 'OR' });
    expect(formatAddress(addr)).toBe('The Venue, 123 Main, Portland, OR');
  });

  it('formats name only', () => {
    expect(formatAddress({ name: 'My Place' })).toBe('My Place');
  });

  it('formats street + city without name', () => {
    expect(formatAddress({ streetAddress: '456 Oak', city: 'Seattle' })).toBe('456 Oak, Seattle');
  });

  it('returns null for null', () => {
    expect(formatAddress(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(formatAddress(undefined)).toBeNull();
  });

  it('returns null for empty object', () => {
    expect(formatAddress({})).toBeNull();
  });
});

describe('computeAttendance', () => {
  it('counts each status', () => {
    const levels = [
      buildInterestLevel({ status: 'GOING' }),
      buildInterestLevel({ status: 'GOING' }),
      buildInterestLevel({ status: 'INTERESTED' }),
      buildInterestLevel({ status: 'NOT_GOING' }),
    ];
    expect(computeAttendance(levels)).toEqual({ going: 2, interested: 1, notGoing: 1 });
  });

  it('returns zeros for empty array', () => {
    expect(computeAttendance([])).toEqual({ going: 0, interested: 0, notGoing: 0 });
  });
});

describe('findUserRsvp', () => {
  const levels = [
    buildInterestLevel({ userId: 'user-001', status: 'GOING' }),
    buildInterestLevel({ userId: 'user-002', status: 'INTERESTED' }),
  ];

  it('finds matching user', () => {
    expect(findUserRsvp(levels, 'user-001')).toBe('GOING');
  });

  it('returns null for non-existent user', () => {
    expect(findUserRsvp(levels, 'user-999')).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(findUserRsvp([], 'user-001')).toBeNull();
  });
});

describe('formatFeedHangout', () => {
  it('formats a basic hangout', () => {
    const hangout = buildHangout({
      hangoutId: 'h-1',
      title: 'Game Night',
      interestLevels: [
        buildInterestLevel({ userId: 'user-001', status: 'GOING' }),
        buildInterestLevel({ status: 'INTERESTED' }),
      ],
      polls: [{ pollId: 'p1' } as unknown],
      carpoolEnabled: true,
    });

    const result = formatFeedHangout(hangout, 'user-001', TZ);

    expect(result.type).toBe('hangout');
    expect(result.hangoutId).toBe('h-1');
    expect(result.title).toBe('Game Night');
    expect(result.going).toBe(1);
    expect(result.interested).toBe(1);
    expect(result.notGoing).toBe(0);
    expect(result.yourRsvpStatus).toBe('GOING');
    expect(result.hasPolls).toBe(true);
    expect(result.hasCarpooling).toBe(true);
    expect(result.when).toBeTruthy();
    expect(result.location).toBeTruthy();
  });

  it('includes ticket summary when tickets required', () => {
    const hangout = buildHangout({
      ticketsRequired: true,
      participationSummary: {
        usersWithTickets: [{ userId: 'u1', displayName: 'A' }],
        usersNeedingTickets: [{ userId: 'u2', displayName: 'B' }, { userId: 'u3', displayName: 'C' }],
        usersWithClaimedSpots: [],
        extraTicketCount: 1,
        reservationOffers: [],
      },
    });

    const result = formatFeedHangout(hangout, 'user-001', TZ);
    expect(result.hasTickets).toBe(true);
    expect(result.ticketSummary).toEqual({
      haveTickets: 1,
      needTickets: 2,
      extraTickets: 1,
    });
  });

  it('handles hangout with no interestLevels', () => {
    const hangout = buildHangout({ interestLevels: [] });
    const result = formatFeedHangout(hangout, 'user-001', TZ);
    expect(result.going).toBe(0);
    expect(result.yourRsvpStatus).toBeNull();
  });

  it('handles null location and timeInfo', () => {
    const hangout = buildHangout({ location: null, timeInfo: null });
    const result = formatFeedHangout(hangout, 'user-001', TZ);
    expect(result.when).toBeNull();
    expect(result.location).toBeNull();
  });
});

describe('formatGroupFeed', () => {
  it('separates scheduled and timeless items', () => {
    const hangoutWithDay = buildHangout({ hangoutId: 'h-scheduled' });
    const hangoutNoDay = buildHangout({ hangoutId: 'h-timeless', timeInfo: null });
    const feed = buildFeedResponse({
      groupId: 'g-1',
      withDay: [hangoutWithDay],
      needsDay: [hangoutNoDay],
    });

    const result = formatGroupFeed(feed, 'My Group', 'user-001', TZ);

    expect(result.groupId).toBe('g-1');
    expect(result.groupName).toBe('My Group');
    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0]!.type).toBe('hangout');
    expect(result.timeless).toHaveLength(1);
    expect(result.timeless[0]!.hangoutId).toBe('h-timeless');
  });

  it('includes series in scheduled', () => {
    const series = buildSeries({ seriesId: 's-1' });
    const feed = buildFeedResponse({ withDay: [series] });

    const result = formatGroupFeed(feed, 'Group', 'user-001', TZ);
    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0]!.type).toBe('series');
  });

  it('handles empty feed', () => {
    const feed = buildFeedResponse();
    const result = formatGroupFeed(feed, 'Empty Group', 'user-001', TZ);
    expect(result.scheduled).toEqual([]);
    expect(result.timeless).toEqual([]);
  });
});

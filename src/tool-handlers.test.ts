/**
 * Tests for ToolHandlers — stubs HttpClient methods, tests each tool's behavioral contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolHandlers } from './tool-handlers.js';
import { HttpClient } from './http-client.js';
import { fakeSessionContext } from './__helpers__/index.js';
import {
  buildGroup,
  buildHangout,
  buildHangoutDetail,
  buildFeedResponse,
  buildInterestLevel,
  resetSeq,
} from './__fixtures__/index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function stubRequest(impl: (...args: unknown[]) => unknown) {
  return vi.spyOn(HttpClient.prototype, 'request').mockImplementation(impl as never);
}

function stubGetWithEtag(impl: (...args: unknown[]) => unknown) {
  return vi.spyOn(HttpClient.prototype, 'getWithEtag').mockImplementation(impl as never);
}

function stubRequestNoAuth(impl: (...args: unknown[]) => unknown) {
  return vi.spyOn(HttpClient.prototype, 'requestNoAuth').mockImplementation(impl as never);
}

describe('ToolHandlers', () => {
  let handlers: ToolHandlers;
  const ctx = fakeSessionContext();

  beforeEach(() => {
    resetSeq();
    handlers = new ToolHandlers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── createHangout — invalidates cache ─────────────────────────────────

  describe('createHangout', () => {
    it('creates a hangout and invalidates feed cache', async () => {
      const requestSpy = stubRequest(async (path: string, opts?: { method?: string }) => {
        if (path === '/hangouts' && opts?.method === 'POST') {
          return {
            hangoutId: 'h-new',
            title: 'Board Games',
            momentumCategory: 'BUILDING',
            confirmedBy: null,
          };
        }
        // listGroups call for resolveGroupName
        if (path === '/groups') {
          return [buildGroup({ groupId: 'g-1', groupName: 'Fun Group' })];
        }
        return {};
      });

      const result = await handlers.createHangout({
        groupId: 'g-1',
        title: 'Board Games',
      });

      expect(result.hangoutId).toBe('h-new');
      expect(result.title).toBe('Board Games');
      expect(result.groupName).toBe('Fun Group');
      expect(result.yourRsvpStatus).toBe('INTERESTED');

      // Verify POST was called
      const postCall = requestSpy.mock.calls.find(
        ([p, o]) => p === '/hangouts' && (o as Record<string, unknown>)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
    });

    it('returns GOING rsvp when confirmed', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (path === '/hangouts' && opts?.method === 'POST') {
          return {
            hangoutId: 'h-confirmed',
            title: 'Dinner',
            momentumCategory: 'CONFIRMED',
            confirmedBy: 'user-001',
          };
        }
        if (path === '/groups') {
          return [buildGroup({ groupId: 'g-1', groupName: 'Friends' })];
        }
        return {};
      });

      const result = await handlers.createHangout({
        groupId: 'g-1',
        title: 'Dinner',
        confirmed: true,
      });

      expect(result.yourRsvpStatus).toBe('GOING');
      expect(result.momentum).toBe('CONFIRMED');
    });

    it('throws on missing groupId', async () => {
      await expect(
        handlers.createHangout({ groupId: '', title: 'Test' }),
      ).rejects.toThrow('groupId is required');
    });

    it('throws on missing title', async () => {
      await expect(
        handlers.createHangout({ groupId: 'g-1', title: '' }),
      ).rejects.toThrow('title is required');
    });
  });

  // ─── setRsvp — re-fetches for counts ──────────────────────────────────

  describe('setRsvp', () => {
    it('sets RSVP and re-fetches hangout for updated counts', async () => {
      const detail = buildHangoutDetail({
        hangout: {
          ...buildHangoutDetail().hangout,
          hangoutId: 'h-1',
          title: 'Park Day',
          associatedGroups: ['g-1'],
        },
        attendance: [
          buildInterestLevel({ userId: 'user-001', userName: 'Test User', status: 'GOING' }),
          buildInterestLevel({ userId: 'user-002', userName: 'Alice', status: 'GOING' }),
          buildInterestLevel({ userId: 'user-003', userName: 'Bob', status: 'INTERESTED' }),
        ],
      });

      const requestSpy = stubRequest(async (path: string, opts?: { method?: string }) => {
        if (path === '/hangouts/h-1/interest' && opts?.method === 'PUT') {
          return undefined; // 204
        }
        if (path === '/hangouts/h-1') {
          return detail;
        }
        return {};
      });

      const result = await handlers.setRsvp({
        hangoutId: 'h-1',
        status: 'GOING',
      });

      expect(result.hangoutId).toBe('h-1');
      expect(result.title).toBe('Park Day');
      expect(result.yourRsvpStatus).toBe('GOING');
      expect(result.going).toBe(2);
      expect(result.interested).toBe(1);

      // Verify it fetched the detail for counts
      const detailCall = requestSpy.mock.calls.find(
        ([p, o]) => p === '/hangouts/h-1' && !(o as Record<string, unknown>)?.method,
      );
      expect(detailCall).toBeDefined();
    });

    it('throws on missing hangoutId', async () => {
      await expect(
        handlers.setRsvp({ hangoutId: '', status: 'GOING' }),
      ).rejects.toThrow('hangoutId is required');
    });

    it('throws on invalid status', async () => {
      await expect(
        handlers.setRsvp({ hangoutId: 'h-1', status: 'MAYBE' as never }),
      ).rejects.toThrow('status must be GOING, INTERESTED, or NOT_GOING');
    });
  });

  // ─── getGroupFeed — serves cached on 304 ──────────────────────────────

  describe('getGroupFeed', () => {
    it('returns fresh data on 200 and caches it', async () => {
      const feed = buildFeedResponse({
        groupId: 'g-1',
        withDay: [buildHangout({ hangoutId: 'h-10', title: 'Hike' })],
      });

      // First call: listGroups to resolve name
      stubRequest(async (path: string) => {
        if (path === '/groups') {
          return [buildGroup({ groupId: 'g-1', groupName: 'Hikers' })];
        }
        return {};
      });

      stubGetWithEtag(async () => ({
        data: feed,
        etag: '"etag-1"',
        notModified: false,
      }));

      const result = await handlers.getGroupFeed({ groupId: 'g-1' });
      expect(result.groupId).toBe('g-1');
      expect(result.groupName).toBe('Hikers');
      expect(result.scheduled.length).toBe(1);
    });

    it('serves cached response on 304 Not Modified', async () => {
      const feed = buildFeedResponse({
        groupId: 'g-1',
        withDay: [buildHangout({ hangoutId: 'h-10', title: 'Cached Hike' })],
      });

      // Resolve group name
      stubRequest(async (path: string) => {
        if (path === '/groups') {
          return [buildGroup({ groupId: 'g-1', groupName: 'Hikers' })];
        }
        return {};
      });

      // First fetch — populate cache
      const etagSpy = stubGetWithEtag(async () => ({
        data: feed,
        etag: '"etag-1"',
        notModified: false,
      }));

      await handlers.getGroupFeed({ groupId: 'g-1' });

      // Second fetch — 304 not modified
      etagSpy.mockImplementation(async () => ({
        data: null,
        etag: '"etag-1"',
        notModified: true,
      }));

      const result = await handlers.getGroupFeed({ groupId: 'g-1' });
      expect(result.groupName).toBe('Hikers');
      expect(result.scheduled.length).toBe(1);
      expect((result.scheduled[0] as { title: string }).title).toBe('Cached Hike');
    });

    it('does not serve stale cache for filtered requests', async () => {
      const fullFeed = buildFeedResponse({
        groupId: 'g-1',
        withDay: [
          buildHangout({ hangoutId: 'h-confirmed', title: 'Confirmed Event' }),
          buildHangout({ hangoutId: 'h-building', title: 'Building Event' }),
        ],
      });
      const filteredFeed = buildFeedResponse({
        groupId: 'g-1',
        withDay: [buildHangout({ hangoutId: 'h-confirmed', title: 'Confirmed Event' })],
      });

      stubRequest(async (path: string) => {
        if (path === '/groups') {
          return [buildGroup({ groupId: 'g-1', groupName: 'Group' })];
        }
        return {};
      });

      // First call — cache the full feed
      const etagSpy = stubGetWithEtag(async () => ({
        data: fullFeed,
        etag: '"etag-full"',
        notModified: false,
      }));

      await handlers.getGroupFeed({ groupId: 'g-1' });

      // Filtered call — should NOT use cached full feed, even if server returns 304
      // The code skips ETag for filtered requests, so it always gets fresh data
      etagSpy.mockImplementation(async () => ({
        data: filteredFeed,
        etag: '"etag-filtered"',
        notModified: false,
      }));

      const result = await handlers.getGroupFeed({ groupId: 'g-1', filter: 'CONFIRMED' });
      expect(result.scheduled).toHaveLength(1);
      expect((result.scheduled[0] as { title: string }).title).toBe('Confirmed Event');
    });

    it('throws on missing groupId', async () => {
      await expect(
        handlers.getGroupFeed({ groupId: '' }),
      ).rejects.toThrow('groupId is required');
    });
  });

  // ─── updateTicketStatus — upsert pattern ──────────────────────────────

  describe('updateTicketStatus', () => {
    it('creates new participation when none exists', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (path === '/hangouts/h-1/participations' && !opts?.method) {
          return []; // no existing participations
        }
        if (path === '/hangouts/h-1/participations' && opts?.method === 'POST') {
          return {
            participationId: 'p-new',
            userId: 'user-001',
            displayName: 'Test User',
            type: 'TICKET_PURCHASED',
            section: 'A',
            seat: null,
            createdAt: '2025-01-01',
            updatedAt: '2025-01-01',
          };
        }
        return {};
      });

      const result = await handlers.updateTicketStatus({
        hangoutId: 'h-1',
        type: 'TICKET_PURCHASED',
        section: 'A',
      });

      expect(result.participationId).toBe('p-new');
      expect(result.type).toBe('TICKET_PURCHASED');
      expect(result.section).toBe('A');
    });

    it('updates existing participation for same user', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (path === '/hangouts/h-1/participations' && (!opts?.method || opts?.method === 'GET')) {
          return [{
            participationId: 'p-existing',
            userId: 'user-001',
            displayName: 'Test User',
            type: 'TICKET_NEEDED',
            section: null,
            seat: null,
            createdAt: '2025-01-01',
            updatedAt: '2025-01-01',
          }];
        }
        if (path === '/hangouts/h-1/participations/p-existing' && opts?.method === 'PUT') {
          return {
            participationId: 'p-existing',
            userId: 'user-001',
            displayName: 'Test User',
            type: 'TICKET_PURCHASED',
            section: 'B',
            seat: '12',
            createdAt: '2025-01-01',
            updatedAt: '2025-01-02',
          };
        }
        return {};
      });

      const result = await handlers.updateTicketStatus({
        hangoutId: 'h-1',
        type: 'TICKET_PURCHASED',
        section: 'B',
        seat: '12',
      });

      expect(result.participationId).toBe('p-existing');
      expect(result.type).toBe('TICKET_PURCHASED');
    });

    it('throws on missing hangoutId', async () => {
      await expect(
        handlers.updateTicketStatus({ hangoutId: '', type: 'TICKET_PURCHASED' }),
      ).rejects.toThrow('hangoutId is required');
    });

    it('throws on missing type', async () => {
      await expect(
        handlers.updateTicketStatus({ hangoutId: 'h-1', type: '' as never }),
      ).rejects.toThrow('type is required');
    });
  });

  // ─── offerRide — validates capacity 2–8 ────────────────────────────────

  describe('offerRide', () => {
    it('creates a ride offer with valid capacity', async () => {
      stubRequest(async () => ({
        totalCapacity: 4,
        availableSeats: 3,
        notes: 'Red car',
      }));

      const result = await handlers.offerRide({
        hangoutId: 'h-1',
        capacity: 4,
        notes: 'Red car',
      });

      expect(result.capacity).toBe(4);
      expect(result.seatsOpen).toBe(3);
      expect(result.notes).toBe('Red car');
    });

    it('throws when capacity < 2', async () => {
      await expect(
        handlers.offerRide({ hangoutId: 'h-1', capacity: 1 }),
      ).rejects.toThrow('capacity must be between 2 and 8');
    });

    it('throws when capacity > 8', async () => {
      await expect(
        handlers.offerRide({ hangoutId: 'h-1', capacity: 9 }),
      ).rejects.toThrow('capacity must be between 2 and 8');
    });

    it('accepts boundary capacity of 2', async () => {
      stubRequest(async () => ({
        totalCapacity: 2,
        availableSeats: 1,
        notes: null,
      }));

      const result = await handlers.offerRide({ hangoutId: 'h-1', capacity: 2 });
      expect(result.capacity).toBe(2);
    });

    it('accepts boundary capacity of 8', async () => {
      stubRequest(async () => ({
        totalCapacity: 8,
        availableSeats: 7,
        notes: null,
      }));

      const result = await handlers.offerRide({ hangoutId: 'h-1', capacity: 8 });
      expect(result.capacity).toBe(8);
    });

    it('throws on missing hangoutId', async () => {
      await expect(
        handlers.offerRide({ hangoutId: '', capacity: 4 }),
      ).rejects.toThrow('hangoutId is required');
    });
  });

  // ─── getWatchParty — computes next episode and aired count ─────────────

  describe('getWatchParty', () => {
    it('computes next episode and aired count from hangout timestamps', async () => {
      const now = Date.now();
      const past1 = Math.floor((now - 7 * 86400_000) / 1000); // 7 days ago (seconds)
      const past2 = Math.floor((now - 14 * 86400_000) / 1000); // 14 days ago
      const future1 = Math.floor((now + 7 * 86400_000) / 1000); // 7 days from now

      stubRequest(async () => ({
        seriesId: 's-1',
        title: 'Breaking Bad Watch',
        schedule: 'Fridays at 8:00 PM',
        totalParts: 3,
        interestLevels: [
          { userId: 'user-001', level: 'GOING', userName: 'Test User' },
          { userId: 'user-002', level: 'INTERESTED', userName: 'Alice' },
        ],
        hangouts: [
          { hangoutId: 'h-ep1', title: 'S1E1', startTimestamp: past2, endTimestamp: null },
          { hangoutId: 'h-ep2', title: 'S1E2', startTimestamp: past1, endTimestamp: null },
          { hangoutId: 'h-ep3', title: 'S1E3', startTimestamp: future1, endTimestamp: null },
        ],
      }));

      const result = await handlers.getWatchParty({ groupId: 'g-1', seriesId: 's-1' });

      expect(result.seriesId).toBe('s-1');
      expect(result.title).toBe('Breaking Bad Watch');
      expect(result.episodesAired).toBe(2);
      expect(result.totalEpisodes).toBe(3);
      expect(result.nextEpisode).not.toBeNull();
      expect(result.nextEpisode!.hangoutId).toBe('h-ep3');
      expect(result.nextEpisode!.title).toBe('S1E3');
      expect(result.going).toEqual([{ name: 'Test User' }]);
      expect(result.interested).toEqual([{ name: 'Alice' }]);
      expect(result.yourStatus).toBe('GOING');
    });

    it('throws on missing groupId', async () => {
      await expect(
        handlers.getWatchParty({ groupId: '', seriesId: 's-1' }),
      ).rejects.toThrow('groupId is required');
    });

    it('throws on missing seriesId', async () => {
      await expect(
        handlers.getWatchParty({ groupId: 'g-1', seriesId: '' }),
      ).rejects.toThrow('seriesId is required');
    });
  });

  // ─── getHangoutDetail ──────────────────────────────────────────────────

  describe('getHangoutDetail', () => {
    it('formats detailed hangout response with attendance', async () => {
      const detail = buildHangoutDetail({
        attendance: [
          buildInterestLevel({ userId: 'user-001', userName: 'Test User', status: 'GOING' }),
          buildInterestLevel({ userId: 'user-002', userName: 'Alice', status: 'INTERESTED' }),
          buildInterestLevel({ userId: 'user-003', userName: 'Bob', status: 'NOT_GOING' }),
        ],
      });
      stubRequest(async () => detail);

      const result = await handlers.getHangoutDetail({ hangoutId: 'hangout-detail-001' });

      expect(result.hangoutId).toBe('hangout-detail-001');
      expect(result.title).toBe('Detail Hangout');
      expect(result.attendance.going).toHaveLength(1);
      expect(result.attendance.going[0]!.name).toBe('Test User');
      expect(result.attendance.interested).toHaveLength(1);
      expect(result.attendance.interested[0]!.name).toBe('Alice');
      expect(result.attendance.notGoing).toHaveLength(1);
      expect(result.attendance.notGoing[0]!.name).toBe('Bob');
      expect(result.yourRsvpStatus).toBe('GOING');
    });

    it('formats polls with voter names and vote counts', async () => {
      const detail = buildHangoutDetail({
        polls: [{
          pollId: 'poll-1',
          title: 'Where to eat?',
          description: null,
          multipleChoice: false,
          options: [
            {
              optionId: 'opt-1', text: 'Pizza', voteCount: 2, userVoted: true,
              createdBy: 'user-001', structuredValue: null,
              votes: [
                { displayName: 'Test User' },
                { displayName: 'Alice' },
              ],
            } as never,
            {
              optionId: 'opt-2', text: 'Sushi', voteCount: 1, userVoted: false,
              createdBy: 'user-002', structuredValue: null,
              votes: [{ displayName: 'Bob' }],
            } as never,
          ],
          totalVotes: 3,
          attributeType: null,
          isActive: true,
          promotedAt: null,
          createdAtMillis: 1700000000000,
        }],
      });
      stubRequest(async () => detail);

      const result = await handlers.getHangoutDetail({ hangoutId: 'hangout-detail-001' });

      expect(result.polls).toHaveLength(1);
      expect(result.polls[0]!.title).toBe('Where to eat?');
      expect(result.polls[0]!.totalVotes).toBe(3);
      expect(result.polls[0]!.options).toHaveLength(2);
      expect(result.polls[0]!.options[0]!.text).toBe('Pizza');
      expect(result.polls[0]!.options[0]!.votes).toBe(2);
      expect(result.polls[0]!.options[0]!.youVoted).toBe(true);
      expect(result.polls[0]!.options[0]!.voterNames).toEqual(['Test User', 'Alice']);
      expect(result.polls[0]!.options[1]!.voterNames).toEqual(['Bob']);
    });

    it('formats carpool with riders joined to drivers', async () => {
      const detail = buildHangoutDetail({
        hangout: {
          ...buildHangoutDetail().hangout,
          carpoolEnabled: true,
        },
        cars: [
          { driverId: 'user-002', driverName: 'Alice', totalCapacity: 4, availableSeats: 2, notes: 'Red car' } as never,
        ],
        carRiders: [
          { driverId: 'user-002', riderName: 'Bob' } as never,
          { driverId: 'user-002', riderName: 'Carol' } as never,
        ],
        needsRide: [
          { userId: 'user-005', displayName: 'Dave', mainImagePath: null, notes: 'From downtown' },
        ],
      });
      stubRequest(async () => detail);

      const result = await handlers.getHangoutDetail({ hangoutId: 'hangout-detail-001' });

      expect(result.carpool.cars).toHaveLength(1);
      expect(result.carpool.cars[0]!.driverName).toBe('Alice');
      expect(result.carpool.cars[0]!.capacity).toBe(4);
      expect(result.carpool.cars[0]!.seatsOpen).toBe(2);
      expect(result.carpool.cars[0]!.riders).toEqual(['Bob', 'Carol']);
      expect(result.carpool.cars[0]!.notes).toBe('Red car');
      expect(result.carpool.rideRequests).toHaveLength(1);
      expect(result.carpool.rideRequests[0]!.name).toBe('Dave');
      expect(result.carpool.rideRequests[0]!.notes).toBe('From downtown');
    });

    it('formats tickets with three participation types', async () => {
      const detail = buildHangoutDetail({
        hangout: {
          ...buildHangoutDetail().hangout,
          ticketsRequired: true,
          ticketLink: 'https://tickets.example.com',
          discountCode: 'SAVE20',
        },
        participations: [
          { participationId: 'p-1', userId: 'user-001', displayName: 'Test User', mainImagePath: null, type: 'TICKET_PURCHASED', section: 'A', seat: '12', reservationOfferId: null, createdAt: '', updatedAt: '' },
          { participationId: 'p-2', userId: 'user-002', displayName: 'Alice', mainImagePath: null, type: 'TICKET_NEEDED', section: null, seat: null, reservationOfferId: null, createdAt: '', updatedAt: '' },
          { participationId: 'p-3', userId: 'user-003', displayName: 'Bob', mainImagePath: null, type: 'TICKET_EXTRA', section: null, seat: null, reservationOfferId: null, createdAt: '', updatedAt: '' },
        ],
      });
      stubRequest(async () => detail);

      const result = await handlers.getHangoutDetail({ hangoutId: 'hangout-detail-001' });

      expect(result.tickets).not.toBeNull();
      expect(result.tickets!.required).toBe(true);
      expect(result.tickets!.ticketLink).toBe('https://tickets.example.com');
      expect(result.tickets!.discountCode).toBe('SAVE20');
      expect(result.tickets!.haveTickets).toHaveLength(1);
      expect(result.tickets!.haveTickets[0]).toEqual({ name: 'Test User', section: 'A', seat: '12' });
      expect(result.tickets!.needTickets).toEqual([{ name: 'Alice' }]);
      expect(result.tickets!.extraTickets).toEqual([{ name: 'Bob' }]);
    });

    it('returns null tickets when ticketsRequired is false', async () => {
      const detail = buildHangoutDetail();
      stubRequest(async () => detail);

      const result = await handlers.getHangoutDetail({ hangoutId: 'hangout-detail-001' });
      expect(result.tickets).toBeNull();
    });

    it('derives time suggestions from active TIME polls and formats from timeInput', async () => {
      const detail = buildHangoutDetail({
        attendance: [
          buildInterestLevel({ userId: 'user-002', userName: 'Alice', status: 'GOING' }),
        ],
        polls: [{
          pollId: 'poll-time-1',
          title: 'Vote on a time',
          description: null,
          multipleChoice: true,
          attributeType: 'TIME',
          isActive: true,
          promotedAt: null,
          viewable: true,
          canAddOptions: true,
          createdAtMillis: 1700000000000,
          totalVotes: 1,
          options: [{
            optionId: 'opt-time-1',
            text: 'Sat afternoon',
            voteCount: 1,
            userVoted: false,
            createdBy: 'user-002',
            structuredValue: null,
            timeInput: {
              periodGranularity: 'afternoon',
              periodStart: '2026-05-02T12:00:00-07:00',
            },
            votes: [{ userId: 'user-002', voteType: 'YES', displayName: 'Alice' }],
          }],
        }],
      });
      stubRequest(async () => detail);

      const result = await handlers.getHangoutDetail({ hangoutId: 'hangout-detail-001' });

      expect(result.timeSuggestions).toHaveLength(1);
      const suggestion = result.timeSuggestions[0]!;
      expect(suggestion.pollId).toBe('poll-time-1');
      expect(suggestion.optionId).toBe('opt-time-1');
      expect(suggestion.supportCount).toBe(1);
      expect(suggestion.supporterNames).toEqual(['Alice']);
      expect(suggestion.youSupported).toBe(false);
      expect(suggestion.when).toBeTruthy();
      expect(suggestion.when).not.toBe('Sat afternoon'); // formatted from timeInput, not server text
      // TIME polls should not appear in the generic polls list
      expect(result.polls).toHaveLength(0);
    });

    it('skips non-viewable polls and inactive TIME polls in suggestions', async () => {
      const detail = buildHangoutDetail({
        polls: [
          {
            pollId: 'poll-hidden',
            title: 'Hidden',
            description: null,
            multipleChoice: false,
            attributeType: null,
            isActive: true,
            promotedAt: null,
            viewable: false,
            canAddOptions: true,
            createdAtMillis: 1700000000000,
            totalVotes: 0,
            options: [],
          },
          {
            pollId: 'poll-time-adopted',
            title: 'Vote on a time',
            description: null,
            multipleChoice: true,
            attributeType: 'TIME',
            isActive: false,
            promotedAt: 1700000099999,
            viewable: true,
            canAddOptions: false,
            createdAtMillis: 1700000000000,
            totalVotes: 2,
            options: [{
              optionId: 'opt-x',
              text: 'Adopted',
              voteCount: 2,
              userVoted: true,
              createdBy: 'user-002',
              structuredValue: null,
              timeInput: { startTime: '2026-05-02T19:00:00-07:00' },
              votes: [],
            }],
          },
        ],
      });
      stubRequest(async () => detail);

      const result = await handlers.getHangoutDetail({ hangoutId: 'hangout-detail-001' });
      expect(result.polls).toHaveLength(0);
      expect(result.timeSuggestions).toHaveLength(0);
    });

    it('formats nudges as type strings', async () => {
      const detail = buildHangoutDetail({
        nudges: [
          { type: 'NEEDS_TIME', message: 'Add a time', actionUrl: null },
          { type: 'NEEDS_LOCATION', message: 'Add a place', actionUrl: null },
        ],
      });
      stubRequest(async () => detail);

      const result = await handlers.getHangoutDetail({ hangoutId: 'hangout-detail-001' });
      expect(result.nudges).toEqual(['NEEDS_TIME', 'NEEDS_LOCATION']);
    });

    it('throws on missing hangoutId', async () => {
      await expect(
        handlers.getHangoutDetail({ hangoutId: '' }),
      ).rejects.toThrow('hangoutId is required');
    });
  });

  // ─── listGroups ────────────────────────────────────────────────────────

  describe('listGroups', () => {
    it('returns simplified group list', async () => {
      stubRequest(async () => [
        buildGroup({ groupId: 'g-1', groupName: 'Group A' }),
        buildGroup({ groupId: 'g-2', groupName: 'Group B' }),
      ]);

      const result = await handlers.listGroups();
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0]).toEqual({ groupId: 'g-1', groupName: 'Group A' });
    });
  });

  // ─── parseEventUrl — uses requestNoAuth ────────────────────────────────

  describe('parseEventUrl', () => {
    it('parses an event URL without auth headers', async () => {
      const spy = stubRequestNoAuth(async () => ({
        title: 'Concert',
        description: 'Live music',
        startTime: '2025-04-12T19:00:00-07:00',
        endTime: '2025-04-12T22:00:00-07:00',
        location: { name: 'Venue', city: 'Portland' },
        ticketOffers: [{ price: 50 }],
        url: 'https://tickets.example.com',
      }));

      const result = await handlers.parseEventUrl({ url: 'https://example.com/event' });

      expect(result.title).toBe('Concert');
      expect(result.hasTickets).toBe(true);
      expect(result.ticketLink).toBe('https://tickets.example.com');
      expect(result.when).not.toBeNull();

      // Verify requestNoAuth was used, not request
      expect(spy).toHaveBeenCalledOnce();
    });

    it('throws on empty URL', async () => {
      await expect(
        handlers.parseEventUrl({ url: '' }),
      ).rejects.toThrow('url is required');
    });
  });

  // ─── Happy-path tests for remaining tools ──────────────────────────────

  describe('removeRsvp', () => {
    it('removes RSVP and returns hangout title', async () => {
      const detail = buildHangoutDetail({
        hangout: { ...buildHangoutDetail().hangout, hangoutId: 'h-1', title: 'Park Day' },
      });
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (path === '/hangouts/h-1' && !opts?.method) return detail;
        if (path === '/hangouts/h-1/interest' && opts?.method === 'DELETE') return undefined;
        return {};
      });

      const result = await handlers.removeRsvp({ hangoutId: 'h-1' });
      expect(result.hangoutId).toBe('h-1');
      expect(result.title).toBe('Park Day');
      expect(result.removed).toBe(true);
    });
  });

  describe('updateHangout', () => {
    it('patches and returns success', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (opts?.method === 'PATCH') return undefined;
        // resolveGroupIdForHangout fallback
        if (path === '/hangouts/h-1') {
          return buildHangoutDetail({ hangout: { ...buildHangoutDetail().hangout, associatedGroups: ['g-1'] } });
        }
        return {};
      });

      const result = await handlers.updateHangout({ hangoutId: 'h-1', title: 'Updated Title' });
      expect(result.hangoutId).toBe('h-1');
      expect(result.success).toBe(true);
    });
  });

  describe('createGroup', () => {
    it('creates group and returns id + name', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (path === '/groups' && opts?.method === 'POST') {
          return buildGroup({ groupId: 'g-new', groupName: 'Camping Crew' });
        }
        return {};
      });

      const result = await handlers.createGroup({ groupName: 'Camping Crew' });
      expect(result.groupId).toBe('g-new');
      expect(result.groupName).toBe('Camping Crew');
    });
  });

  describe('createPoll', () => {
    it('creates poll and returns options with IDs', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return { eventId: 'h-1', pollId: 'poll-new', title: 'What trail?' };
        }
        // Re-fetch polls for option IDs
        if (path === '/hangouts/h-1/polls' && !opts?.method) {
          return [{
            pollId: 'poll-new', title: 'What trail?', description: null,
            multipleChoice: false, totalVotes: 0, attributeType: null,
            isActive: true, promotedAt: null, createdAtMillis: 0,
            options: [
              { optionId: 'opt-1', text: 'Bear Peak', voteCount: 0, userVoted: false, createdBy: 'user-001', structuredValue: null, timeInput: null, votes: [] },
              { optionId: 'opt-2', text: 'Sanitas', voteCount: 0, userVoted: false, createdBy: 'user-001', structuredValue: null, timeInput: null, votes: [] },
            ],
          }];
        }
        return {};
      });

      const result = await handlers.createPoll({
        hangoutId: 'h-1', title: 'What trail?',
        options: [{ text: 'Bear Peak' }, { text: 'Sanitas' }],
      });
      expect(result.pollId).toBe('poll-new');
      expect(result.title).toBe('What trail?');
      expect(result.options).toHaveLength(2);
      expect(result.options[0]!.text).toBe('Bear Peak');
      expect(result.options[0]!.optionId).toBe('opt-1');
    });
  });

  describe('voteOnPoll', () => {
    it('votes and returns updated counts', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') return undefined;
        // Re-fetch polls
        if (path === '/hangouts/h-1/polls') {
          return [{
            pollId: 'poll-1', title: 'Trail?', description: null,
            multipleChoice: false, totalVotes: 3, attributeType: null,
            isActive: true, promotedAt: null, createdAtMillis: 0,
            options: [
              { optionId: 'opt-1', text: 'Bear Peak', voteCount: 2, userVoted: true, createdBy: 'u', structuredValue: null, timeInput: null, votes: [] },
              { optionId: 'opt-2', text: 'Sanitas', voteCount: 1, userVoted: false, createdBy: 'u', structuredValue: null, timeInput: null, votes: [] },
            ],
          }];
        }
        return {};
      });

      const result = await handlers.voteOnPoll({ hangoutId: 'h-1', pollId: 'poll-1', optionId: 'opt-1' });
      expect(result.pollId).toBe('poll-1');
      expect(result.optionText).toBe('Bear Peak');
      expect(result.totalVotesForOption).toBe(2);
      expect(result.pollTotalVotes).toBe(3);
    });
  });

  describe('addPollOption', () => {
    it('adds option and returns id + text', async () => {
      stubRequest(async () => ({
        eventId: 'h-1', pollId: 'poll-1', optionId: 'opt-new', text: 'Flagstaff',
      }));

      const result = await handlers.addPollOption({ hangoutId: 'h-1', pollId: 'poll-1', text: 'Flagstaff' });
      expect(result.optionId).toBe('opt-new');
      expect(result.text).toBe('Flagstaff');
      expect(result.pollId).toBe('poll-1');
    });
  });

  describe('addMember', () => {
    it('adds member by phone and returns group name', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') return undefined;
        if (path === '/groups') return [buildGroup({ groupId: 'g-1', groupName: 'Weekend Warriors' })];
        return {};
      });

      const result = await handlers.addMember({ groupId: 'g-1', phoneNumber: '+15551234567' });
      expect(result.groupName).toBe('Weekend Warriors');
      expect(result.added).toBe(true);
      expect(result.message).toBeTruthy();
    });
  });

  describe('generateInviteLink', () => {
    it('returns invite code and share URL', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') return { inviteCode: 'ABC123', shareUrl: 'https://hango.app/join/ABC123' };
        if (path === '/groups') return [buildGroup({ groupId: 'g-1', groupName: 'Fun Group' })];
        return {};
      });

      const result = await handlers.generateInviteLink({ groupId: 'g-1' });
      expect(result.inviteCode).toBe('ABC123');
      expect(result.shareUrl).toBe('https://hango.app/join/ABC123');
      expect(result.groupName).toBe('Fun Group');
    });
  });

  describe('createIdeaList', () => {
    it('creates list and returns name + category', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return { ideaListId: 'list-new', name: 'Restaurants', category: 'PLACE', note: null, groupId: 'g-1' };
        }
        if (path === '/groups') return [buildGroup({ groupId: 'g-1', groupName: 'Foodies' })];
        return {};
      });

      const result = await handlers.createIdeaList({ groupId: 'g-1', name: 'Restaurants', category: 'PLACE' });
      expect(result.listId).toBe('list-new');
      expect(result.name).toBe('Restaurants');
      expect(result.category).toBe('PLACE');
      expect(result.groupName).toBe('Foodies');
    });
  });

  describe('addIdea', () => {
    it('adds idea and returns name + list name', async () => {
      stubRequest(async (path: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return { ideaId: 'idea-new', name: 'Sushi Nakazawa', note: null, interestCount: 0 };
        }
        // Fallback fetch for list name
        if (path.includes('/idea-lists/list-1') && !path.includes('/ideas')) {
          return { ideaListId: 'list-1', name: 'Restaurant Ideas', category: 'PLACE', note: null, groupId: 'g-1' };
        }
        return {};
      });

      const result = await handlers.addIdea({ groupId: 'g-1', listId: 'list-1', name: 'Sushi Nakazawa' });
      expect(result.ideaId).toBe('idea-new');
      expect(result.name).toBe('Sushi Nakazawa');
      expect(result.listName).toBe('Restaurant Ideas');
    });
  });

  describe('toggleIdeaInterest', () => {
    it('toggles interest and returns updated count', async () => {
      stubRequest(async () => ({
        ideaId: 'idea-1', name: 'Bear Peak', note: null, interestCount: 3,
        interestedUsers: [],
      }));

      const result = await handlers.toggleIdeaInterest({
        groupId: 'g-1', listId: 'list-1', ideaId: 'idea-1', interested: true,
      });
      expect(result.ideaId).toBe('idea-1');
      expect(result.youInterested).toBe(true);
      expect(result.interestCount).toBe(3);
    });
  });

  describe('requestRide', () => {
    it('creates ride request', async () => {
      stubRequest(async () => undefined);

      const result = await handlers.requestRide({ hangoutId: 'h-1', notes: 'From downtown' });
      expect(result.hangoutId).toBe('h-1');
      expect(result.requested).toBe(true);
    });
  });

  describe('getIdeaLists', () => {
    it('returns all lists for a group', async () => {
      stubRequest(async (path: string) => {
        if (path.includes('/idea-lists')) {
          return [
            { ideaListId: 'l-1', name: 'Restaurants', category: 'PLACE', note: null, groupId: 'g-1', ideas: [{}, {}, {}] },
            { ideaListId: 'l-2', name: 'Shows', category: 'SHOW', note: null, groupId: 'g-1', ideas: [] },
          ];
        }
        if (path === '/groups') return [buildGroup({ groupId: 'g-1', groupName: 'Fun Group' })];
        return {};
      });

      const result = await handlers.getIdeaLists({ groupId: 'g-1' });
      // All-lists response shape
      expect('lists' in result).toBe(true);
      const allLists = result as { groupName: string; lists: Array<{ listId: string; name: string; ideaCount: number }> };
      expect(allLists.groupName).toBe('Fun Group');
      expect(allLists.lists).toHaveLength(2);
      expect(allLists.lists[0]!.name).toBe('Restaurants');
      expect(allLists.lists[0]!.ideaCount).toBe(3);
      expect(allLists.lists[1]!.ideaCount).toBe(0);
    });

    it('returns single list with ideas when listId provided', async () => {
      stubRequest(async () => ({
        ideaListId: 'l-1', name: 'Restaurants', category: 'PLACE', note: null, groupId: 'g-1',
        ideas: [
          { ideaId: 'i-1', name: 'Sushi Place', note: 'Great omakase', address: '123 Main', rating: 4.8, priceLevel: 3, interestCount: 2, interestedUsers: [{ userId: 'user-001', displayName: 'Test User' }, { userId: 'user-002', displayName: 'Alice' }] },
        ],
      }));

      const result = await handlers.getIdeaLists({ groupId: 'g-1', listId: 'l-1' });
      expect('ideas' in result).toBe(true);
      const detail = result as { listId: string; ideas: Array<{ ideaId: string; name: string; youInterested: boolean; interestedNames: string[] }> };
      expect(detail.listId).toBe('l-1');
      expect(detail.ideas).toHaveLength(1);
      expect(detail.ideas[0]!.name).toBe('Sushi Place');
      expect(detail.ideas[0]!.youInterested).toBe(true); // user-001 is in interestedUsers
      expect(detail.ideas[0]!.interestedNames).toEqual(['Test User', 'Alice']);
    });
  });

  // ─── Additional tools — missing required inputs ────────────────────────

  describe('missing required inputs', () => {
    it('buildTime throws on empty text', async () => {
      await expect(
        handlers.buildTime({ text: '' }),
      ).rejects.toThrow('Please provide a time expression');
    });

    it('createGroup throws on empty groupName', async () => {
      await expect(
        handlers.createGroup({ groupName: '' }),
      ).rejects.toThrow('groupName is required');
    });

    it('createPoll throws on empty title', async () => {
      await expect(
        handlers.createPoll({ hangoutId: 'h-1', title: '' }),
      ).rejects.toThrow('title is required');
    });

    it('createPoll throws on missing hangoutId', async () => {
      await expect(
        handlers.createPoll({ hangoutId: '', title: 'Where?' }),
      ).rejects.toThrow('hangoutId is required');
    });

    it('voteOnPoll throws on missing pollId', async () => {
      await expect(
        handlers.voteOnPoll({ hangoutId: 'h-1', pollId: '', optionId: 'o-1' }),
      ).rejects.toThrow('pollId is required');
    });

    it('addPollOption throws when neither text nor timeInput is provided', async () => {
      await expect(
        handlers.addPollOption({ hangoutId: 'h-1', pollId: 'p-1', text: '' }),
      ).rejects.toThrow(/text.*timeInput|timeInput.*text/);
    });

    it('addMember throws when neither phone nor userId', async () => {
      await expect(
        handlers.addMember({ groupId: 'g-1' }),
      ).rejects.toThrow('Either phoneNumber or userId is required');
    });

    it('generateInviteLink throws on missing groupId', async () => {
      await expect(
        handlers.generateInviteLink({ groupId: '' }),
      ).rejects.toThrow('groupId is required');
    });

    it('requestRide throws on missing hangoutId', async () => {
      await expect(
        handlers.requestRide({ hangoutId: '' }),
      ).rejects.toThrow('hangoutId is required');
    });

    it('removeRsvp throws on missing hangoutId', async () => {
      await expect(
        handlers.removeRsvp({ hangoutId: '' }),
      ).rejects.toThrow('hangoutId is required');
    });

    it('updateHangout throws on missing hangoutId', async () => {
      await expect(
        handlers.updateHangout({ hangoutId: '' }),
      ).rejects.toThrow('hangoutId is required');
    });

    it('toggleIdeaInterest throws on missing ideaId', async () => {
      await expect(
        handlers.toggleIdeaInterest({ groupId: 'g-1', listId: 'l-1', ideaId: '', interested: true }),
      ).rejects.toThrow('ideaId is required');
    });

    it('addIdea throws on missing name', async () => {
      await expect(
        handlers.addIdea({ groupId: 'g-1', listId: 'l-1', name: '' }),
      ).rejects.toThrow('name is required');
    });

    it('createIdeaList throws on missing name', async () => {
      await expect(
        handlers.createIdeaList({ groupId: 'g-1', name: '' }),
      ).rejects.toThrow('name is required');
    });

    it('getIdeaLists throws on missing groupId', async () => {
      await expect(
        handlers.getIdeaLists({ groupId: '' }),
      ).rejects.toThrow('groupId is required');
    });
  });

  // ─── dispatch wraps errors ─────────────────────────────────────────────

  describe('dispatch', () => {
    it('returns error object for unknown tool', async () => {
      const result = await handlers.dispatch('nonexistent_tool', {});
      expect(result).toEqual({
        error: true,
        message: 'Unknown tool: nonexistent_tool. This tool is not yet implemented.',
      });
    });

    it('catches HangoApiError and returns conversational error', async () => {
      const { HangoApiError } = await import('./http-client.js');
      stubRequest(async () => {
        throw new HangoApiError(401, 'UNAUTHORIZED', 'Your session has expired. Please log in via the app.');
      });

      const result = await handlers.dispatch('list_groups', {}) as { error: boolean; message: string };
      expect(result.error).toBe(true);
      expect(result.message).toBe('Your session has expired. Please log in via the app.');
    });

    it('catches validation errors and returns error object', async () => {
      const result = await handlers.dispatch('create_hangout', { groupId: '', title: '' }) as { error: boolean; message: string };
      expect(result.error).toBe(true);
      expect(result.message).toContain('groupId is required');
    });
  });
});

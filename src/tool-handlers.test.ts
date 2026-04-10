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
    it('formats detailed hangout response', async () => {
      const detail = buildHangoutDetail();
      stubRequest(async () => detail);

      const result = await handlers.getHangoutDetail({ hangoutId: 'hangout-detail-001' });

      expect(result.hangoutId).toBe('hangout-detail-001');
      expect(result.title).toBe('Detail Hangout');
      expect(result.attendance.going.length).toBe(1);
      expect(result.attendance.going[0]!.name).toBe('Test User');
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

    it('addPollOption throws on empty text', async () => {
      await expect(
        handlers.addPollOption({ hangoutId: 'h-1', pollId: 'p-1', text: '' }),
      ).rejects.toThrow('text is required');
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

    it('createTimeSuggestion throws on missing hangoutId', async () => {
      await expect(
        handlers.createTimeSuggestion({ hangoutId: '', fuzzyTime: 'Friday' }),
      ).rejects.toThrow('hangoutId is required');
    });

    it('createTimeSuggestion throws on missing fuzzyTime', async () => {
      await expect(
        handlers.createTimeSuggestion({ hangoutId: 'h-1', fuzzyTime: '' }),
      ).rejects.toThrow('fuzzyTime is required');
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
  });
});

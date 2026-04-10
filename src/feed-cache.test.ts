import { describe, it, expect, beforeEach } from 'vitest';
import { FeedCache } from './feed-cache.js';
import { buildFeedResponse, buildHangout, buildSeries } from './__fixtures__/index.js';

describe('FeedCache', () => {
  let cache: FeedCache;

  beforeEach(() => {
    cache = new FeedCache();
  });

  describe('set / get / invalidate', () => {
    it('stores and retrieves a feed entry', () => {
      const feed = buildFeedResponse({ groupId: 'g-1' });
      cache.set('g-1', 'Test Group', feed, 'etag-abc');

      const entry = cache.get('g-1');
      expect(entry).toBeDefined();
      expect(entry!.response.groupId).toBe('g-1');
      expect(entry!.etag).toBe('etag-abc');
      expect(entry!.groupName).toBe('Test Group');
    });

    it('returns undefined for unknown group', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('getEtag returns the stored ETag', () => {
      const feed = buildFeedResponse({ groupId: 'g-1' });
      cache.set('g-1', 'Group', feed, 'etag-123');
      expect(cache.getEtag('g-1')).toBe('etag-123');
    });

    it('getEtag returns undefined for unknown group', () => {
      expect(cache.getEtag('nonexistent')).toBeUndefined();
    });

    it('invalidate removes the entry', () => {
      const feed = buildFeedResponse({ groupId: 'g-1' });
      cache.set('g-1', 'Group', feed, 'etag-1');

      cache.invalidate('g-1');
      expect(cache.get('g-1')).toBeUndefined();
    });

    it('invalidate on nonexistent key is a no-op', () => {
      expect(() => cache.invalidate('nonexistent')).not.toThrow();
    });

    it('overwrites existing entry on re-set', () => {
      const feed1 = buildFeedResponse({ groupId: 'g-1' });
      cache.set('g-1', 'Old Name', feed1, 'etag-old');

      const feed2 = buildFeedResponse({ groupId: 'g-1' });
      cache.set('g-1', 'New Name', feed2, 'etag-new');

      expect(cache.getEtag('g-1')).toBe('etag-new');
      expect(cache.getGroupName('g-1')).toBe('New Name');
    });
  });

  describe('hangoutId-to-groupId mapping', () => {
    it('maps hangouts from withDay', () => {
      const hangout = buildHangout({ hangoutId: 'h-100' });
      const feed = buildFeedResponse({
        groupId: 'g-1',
        withDay: [hangout],
      });
      cache.set('g-1', 'Group', feed, 'etag');

      expect(cache.getGroupIdForHangout('h-100')).toBe('g-1');
    });

    it('maps hangouts from needsDay', () => {
      const hangout = buildHangout({ hangoutId: 'h-200' });
      const feed = buildFeedResponse({
        groupId: 'g-2',
        needsDay: [hangout],
      });
      cache.set('g-2', 'Group 2', feed, 'etag');

      expect(cache.getGroupIdForHangout('h-200')).toBe('g-2');
    });

    it('returns undefined for unmapped hangout', () => {
      expect(cache.getGroupIdForHangout('unknown')).toBeUndefined();
    });

    it('setHangoutGroupMapping manually sets a mapping', () => {
      cache.setHangoutGroupMapping('h-manual', 'g-manual');
      expect(cache.getGroupIdForHangout('h-manual')).toBe('g-manual');
    });
  });

  describe('series part indexing', () => {
    it('indexes hangoutIds within series parts', () => {
      const part1 = buildHangout({ hangoutId: 'h-ep1' });
      const part2 = buildHangout({ hangoutId: 'h-ep2' });
      const series = buildSeries({
        parts: [part1, part2],
      });
      const feed = buildFeedResponse({
        groupId: 'g-series',
        withDay: [series],
      });
      cache.set('g-series', 'Series Group', feed, 'etag');

      expect(cache.getGroupIdForHangout('h-ep1')).toBe('g-series');
      expect(cache.getGroupIdForHangout('h-ep2')).toBe('g-series');
    });

    it('handles series with empty parts', () => {
      const series = buildSeries({ parts: [] });
      const feed = buildFeedResponse({
        groupId: 'g-empty-series',
        withDay: [series],
      });
      // Should not throw
      expect(() => cache.set('g-empty-series', 'Group', feed, 'etag')).not.toThrow();
    });
  });

  describe('getGroupName', () => {
    it('returns cached group name', () => {
      const feed = buildFeedResponse({ groupId: 'g-1' });
      cache.set('g-1', 'My Group', feed, 'etag');
      expect(cache.getGroupName('g-1')).toBe('My Group');
    });

    it('returns undefined for unknown group', () => {
      expect(cache.getGroupName('nonexistent')).toBeUndefined();
    });
  });
});

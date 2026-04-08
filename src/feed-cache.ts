/**
 * Feed cache with ETag support and hangoutId-to-groupId mapping.
 *
 * - Cache keyed by groupId, stores full response + ETag + groupName
 * - hangoutId-to-groupId map populated from feed responses
 * - Session-scoped (no persistence across restarts)
 */

import type { ApiGroupFeedResponse, ApiHangoutSummary, FeedCacheEntry } from './types.js';

export class FeedCache {
  private cache = new Map<string, FeedCacheEntry>();
  private hangoutToGroup = new Map<string, string>();

  /** Store feed response and populate hangoutId map. */
  set(groupId: string, groupName: string, response: ApiGroupFeedResponse, etag: string): void {
    this.cache.set(groupId, { response, etag, groupName });
    this.indexHangouts(groupId, response);
  }

  /** Get cached entry for a group. */
  get(groupId: string): FeedCacheEntry | undefined {
    return this.cache.get(groupId);
  }

  /** Get the ETag for a group's cached feed. */
  getEtag(groupId: string): string | undefined {
    return this.cache.get(groupId)?.etag;
  }

  /** Invalidate cache for a group. */
  invalidate(groupId: string): void {
    this.cache.delete(groupId);
  }

  /** Look up groupId for a hangoutId. */
  getGroupIdForHangout(hangoutId: string): string | undefined {
    return this.hangoutToGroup.get(hangoutId);
  }

  /** Manually set a hangoutId-to-groupId mapping. */
  setHangoutGroupMapping(hangoutId: string, groupId: string): void {
    this.hangoutToGroup.set(hangoutId, groupId);
  }

  /** Get cached group name. */
  getGroupName(groupId: string): string | undefined {
    return this.cache.get(groupId)?.groupName;
  }

  private indexHangouts(groupId: string, response: ApiGroupFeedResponse): void {
    const indexItems = (items: Array<{ type: string } & Record<string, unknown>>) => {
      for (const item of items) {
        if (item.type === 'hangout') {
          const hangout = item as unknown as ApiHangoutSummary;
          this.hangoutToGroup.set(hangout.hangoutId, groupId);
        } else if (item.type === 'series') {
          // Index parts within series
          const parts = (item as Record<string, unknown>).parts as ApiHangoutSummary[] | undefined;
          if (parts) {
            for (const part of parts) {
              if (part.hangoutId) {
                this.hangoutToGroup.set(part.hangoutId, groupId);
              }
            }
          }
        }
      }
    };

    indexItems(response.withDay as Array<{ type: string } & Record<string, unknown>>);
    indexItems(response.needsDay as Array<{ type: string } & Record<string, unknown>>);
  }
}

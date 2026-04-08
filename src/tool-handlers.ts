/**
 * Tool handler implementations for chunk 1:
 * build_time, list_groups, get_group_feed, create_hangout, set_rsvp
 *
 * Patterns established here:
 * 1. Tool handler pattern — validate input, call API, format response, handle errors
 * 2. Read + cache pattern — feed read populates cache and hangoutId map
 * 3. Write + invalidate pattern — write succeeds, invalidate feed cache, re-fetch
 * 4. Response formatting — raw API → simplified JSON with computed fields
 */

import { FeedCache } from './feed-cache.js';
import { formatGroupFeed, computeAttendance, findUserRsvp } from './formatters.js';
import { HangoApiError, HttpClient } from './http-client.js';
import { parseNaturalTime } from './time-parser.js';
import type {
  ApiCreateHangoutResponse,
  ApiGroupDTO,
  ApiGroupFeedResponse,
  ApiHangoutDetail,
  BuildTimeInput,
  BuildTimeOutput,
  CreateHangoutInput,
  CreateHangoutOutput,
  GetGroupFeedInput,
  GetGroupFeedOutput,
  ListGroupsOutput,
  SessionContext,
  SetRsvpInput,
  SetRsvpOutput,
} from './types.js';

export class ToolHandlers {
  private readonly http: HttpClient;
  private readonly feedCache: FeedCache;
  private readonly ctx: SessionContext;
  /** Cache group list for name lookups. */
  private groupCache: Array<{ groupId: string; groupName: string }> | null = null;

  constructor(ctx: SessionContext) {
    this.ctx = ctx;
    this.http = new HttpClient(ctx);
    this.feedCache = new FeedCache();
  }

  // ─── build_time (#0) ─────────────────────────────────────────────────────

  async buildTime(input: BuildTimeInput): Promise<BuildTimeOutput> {
    if (!input.text || input.text.trim().length === 0) {
      throw new Error('Please provide a time expression (e.g., "Saturday afternoon", "7pm Friday").');
    }
    return parseNaturalTime(input.text, this.ctx.timezone);
  }

  // ─── list_groups (#1) ─────────────────────────────────────────────────────

  async listGroups(): Promise<ListGroupsOutput> {
    const groups = await this.http.request<ApiGroupDTO[]>('/groups');
    const simplified = groups.map(g => ({
      groupId: g.groupId,
      groupName: g.groupName,
    }));
    this.groupCache = simplified;
    return { groups: simplified };
  }

  // ─── get_group_feed (#2) — Read + cache pattern ──────────────────────────

  async getGroupFeed(input: GetGroupFeedInput): Promise<GetGroupFeedOutput> {
    if (!input.groupId) {
      throw new Error('groupId is required. Use list_groups first to find the group ID.');
    }

    // Resolve group name — check cache first, then group list
    let groupName = this.feedCache.getGroupName(input.groupId);
    if (!groupName) {
      groupName = await this.resolveGroupName(input.groupId);
    }

    // Build query string
    const params = new URLSearchParams();
    if (input.filter) params.set('filter', input.filter);
    const qs = params.toString();
    const path = `/groups/${input.groupId}/feed${qs ? `?${qs}` : ''}`;

    // Only use ETag cache for default filter (ALL/none) to avoid
    // returning filtered data for a different filter request
    const useCache = !input.filter || input.filter === 'ALL';
    const cachedEtag = useCache ? this.feedCache.getEtag(input.groupId) : undefined;
    const { data, etag, notModified } = await this.http.getWithEtag<ApiGroupFeedResponse>(
      path,
      cachedEtag,
    );

    if (notModified && useCache) {
      const cached = this.feedCache.get(input.groupId);
      if (cached) {
        return formatGroupFeed(cached.response, cached.groupName, this.ctx.userId, this.ctx.timezone);
      }
    }

    if (data) {
      // Always index hangoutIds from any feed response, but only cache default filter
      if (useCache) {
        this.feedCache.set(input.groupId, groupName, data, etag ?? '');
      } else {
        // Still index hangoutId-to-groupId mappings from filtered results
        this.feedCache.set(input.groupId, groupName, data, '');
      }
      return formatGroupFeed(data, groupName, this.ctx.userId, this.ctx.timezone);
    }

    throw new Error('Failed to fetch group feed.');
  }

  // ─── create_hangout (#6) — Write + invalidate pattern ────────────────────

  async createHangout(input: CreateHangoutInput): Promise<CreateHangoutOutput> {
    if (!input.groupId) {
      throw new Error('groupId is required.');
    }
    if (!input.title || input.title.trim().length === 0) {
      throw new Error('title is required.');
    }

    // Build API request body
    const body: Record<string, unknown> = {
      title: input.title,
      associatedGroups: [input.groupId],
      confirmed: input.confirmed ?? false,
    };

    if (input.description) body.description = input.description;
    if (input.timeInfo) body.timeInfo = input.timeInfo;
    if (input.location) body.location = input.location;
    if (input.carpoolEnabled !== undefined) body.carpoolEnabled = input.carpoolEnabled;
    if (input.ticketLink) body.ticketLink = input.ticketLink;
    if (input.ticketsRequired !== undefined) body.ticketsRequired = input.ticketsRequired;
    if (input.discountCode) body.discountCode = input.discountCode;
    if (input.polls) body.polls = input.polls;
    if (input.sourceIdeaId) body.sourceIdeaId = input.sourceIdeaId;
    if (input.sourceIdeaListId) body.sourceIdeaListId = input.sourceIdeaListId;

    const result = await this.http.request<ApiCreateHangoutResponse>('/hangouts', {
      method: 'POST',
      body,
    });

    // Invalidate feed cache for this group
    this.feedCache.invalidate(input.groupId);

    // Map new hangout to its group
    this.feedCache.setHangoutGroupMapping(result.hangoutId, input.groupId);

    // Resolve group name for response
    const groupName = await this.resolveGroupName(input.groupId);

    return {
      hangoutId: result.hangoutId,
      title: result.title,
      momentum: result.momentumCategory ?? 'BUILDING',
      yourRsvpStatus: result.confirmedBy ? 'GOING' : 'INTERESTED',
      groupName,
    };
  }

  // ─── set_rsvp (#8) — Write + invalidate + re-fetch pattern ───────────────

  async setRsvp(input: SetRsvpInput): Promise<SetRsvpOutput> {
    if (!input.hangoutId) {
      throw new Error('hangoutId is required.');
    }
    if (!input.status || !['GOING', 'INTERESTED', 'NOT_GOING'].includes(input.status)) {
      throw new Error('status must be GOING, INTERESTED, or NOT_GOING.');
    }

    // Set the RSVP
    const rsvpBody: Record<string, unknown> = { status: input.status };
    if (input.notes) rsvpBody.notes = input.notes;

    await this.http.request(`/hangouts/${input.hangoutId}/interest`, {
      method: 'PUT',
      body: rsvpBody,
    });

    // Fetch hangout detail for updated counts, title, and groupId resolution
    const detail = await this.http.request<ApiHangoutDetail>(
      `/hangouts/${input.hangoutId}`,
    );

    // Invalidate feed cache — use detail to resolve groupId (avoids double fetch)
    const groupId = this.feedCache.getGroupIdForHangout(input.hangoutId)
      ?? detail.hangout.associatedGroups?.[0]
      ?? null;
    if (groupId) {
      this.feedCache.setHangoutGroupMapping(input.hangoutId, groupId);
      this.feedCache.invalidate(groupId);
    }

    const attendance = computeAttendance(detail.attendance ?? []);

    return {
      hangoutId: input.hangoutId,
      title: detail.hangout.title,
      yourRsvpStatus: input.status,
      going: attendance.going,
      interested: attendance.interested,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Resolve a groupId to its name. Caches group list on first call. */
  private async resolveGroupName(groupId: string): Promise<string> {
    // Check feed cache first
    const cached = this.feedCache.getGroupName(groupId);
    if (cached) return cached;

    // Check group list cache
    if (!this.groupCache) {
      const result = await this.listGroups();
      this.groupCache = result.groups;
    }

    const group = this.groupCache.find(g => g.groupId === groupId);
    return group?.groupName ?? 'Unknown Group';
  }

  /**
   * Resolve groupId for a hangoutId.
   * Uses in-memory map from feed responses.
   * Fallback: fetch hangout detail and read associatedGroups[0].
   */
  private async resolveGroupIdForHangout(hangoutId: string): Promise<string | null> {
    const cached = this.feedCache.getGroupIdForHangout(hangoutId);
    if (cached) return cached;

    // Fallback: fetch hangout detail
    try {
      const detail = await this.http.request<ApiHangoutDetail>(`/hangouts/${hangoutId}`);
      const groupId = detail.hangout.associatedGroups?.[0] ?? null;
      if (groupId) {
        this.feedCache.setHangoutGroupMapping(hangoutId, groupId);
      }
      return groupId;
    } catch {
      return null;
    }
  }

  /** Dispatch a tool call by name. Returns the result object. */
  async dispatch(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      switch (toolName) {
        case 'build_time':
          return await this.buildTime(args as unknown as BuildTimeInput);
        case 'list_groups':
          return await this.listGroups();
        case 'get_group_feed':
          return await this.getGroupFeed(args as unknown as GetGroupFeedInput);
        case 'create_hangout':
          return await this.createHangout(args as unknown as CreateHangoutInput);
        case 'set_rsvp':
          return await this.setRsvp(args as unknown as SetRsvpInput);
        default:
          throw new Error(`Unknown tool: ${toolName}. This tool is not yet implemented.`);
      }
    } catch (err) {
      if (err instanceof HangoApiError) {
        // Return conversational error as text content
        return { error: true, message: err.message };
      }
      if (err instanceof Error) {
        return { error: true, message: err.message };
      }
      return { error: true, message: 'An unexpected error occurred.' };
    }
  }
}

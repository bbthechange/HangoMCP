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

import { DateTime } from 'luxon';
import { FeedCache } from './feed-cache.js';
import { formatGroupFeed, formatTimeInfo, computeAttendance, findUserRsvp } from './formatters.js';
import { HangoApiError, HttpClient } from './http-client.js';
import { parseNaturalTime } from './time-parser.js';
import type {
  AddIdeaInput,
  AddIdeaOutput,
  AddMemberInput,
  AddMemberOutput,
  AddPollOptionInput,
  AddPollOptionOutput,
  ApiCarDTO,
  ApiCarRiderDTO,
  ApiCreateHangoutResponse,
  ApiGroupDTO,
  ApiGroupFeedResponse,
  ApiHangoutDetail,
  ApiIdeaDTO,
  ApiIdeaListDTO,
  ApiParticipationDTO,
  ApiPollDTO,
  ApiWatchPartySeriesDTO,
  BuildTimeInput,
  BuildTimeOutput,
  CreateGroupInput,
  CreateGroupOutput,
  CreateHangoutInput,
  CreateHangoutOutput,
  CreateIdeaListInput,
  CreateIdeaListOutput,
  CreatePollInput,
  CreatePollOutput,
  GenerateInviteLinkInput,
  GenerateInviteLinkOutput,
  GetGroupFeedInput,
  GetGroupFeedOutput,
  GetHangoutDetailInput,
  GetHangoutDetailOutput,
  GetIdeaListDetailOutput,
  GetIdeaListsAllOutput,
  GetIdeaListsInput,
  GetWatchPartyInput,
  GetWatchPartyOutput,
  ListGroupsOutput,
  OfferRideInput,
  OfferRideOutput,
  ParseEventUrlInput,
  ParseEventUrlOutput,
  RemoveRsvpInput,
  RemoveRsvpOutput,
  RequestRideInput,
  RequestRideOutput,
  SessionContext,
  SetRsvpInput,
  SetRsvpOutput,
  TimeInfo,
  ToggleIdeaInterestInput,
  ToggleIdeaInterestOutput,
  UpdateHangoutInput,
  UpdateHangoutOutput,
  UpdateTicketStatusInput,
  UpdateTicketStatusOutput,
  VoteOnPollInput,
  VoteOnPollOutput,
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

  // ─── get_idea_lists (#4) ──────────────────────────────────────────────────

  async getIdeaLists(input: GetIdeaListsInput): Promise<GetIdeaListsAllOutput | GetIdeaListDetailOutput> {
    if (!input.groupId) {
      throw new Error('groupId is required. Use list_groups first to find the group ID.');
    }

    if (input.listId) {
      // Single list with ideas
      const path = `/groups/${input.groupId}/idea-lists/${input.listId}`;
      const list = await this.http.request<ApiIdeaListDTO & { ideas?: ApiIdeaDTO[] }>(path);
      return {
        listId: list.ideaListId ?? input.listId,
        name: list.name,
        category: list.category,
        ideas: (list.ideas ?? []).map(idea => ({
          ideaId: idea.ideaId ?? (idea as Record<string, unknown>).id as string,
          name: idea.name,
          note: idea.note,
          address: idea.address,
          rating: idea.rating ?? (idea as Record<string, unknown>).cachedRating as number | null,
          priceLevel: idea.priceLevel ?? (idea as Record<string, unknown>).cachedPriceLevel as number | null,
          interestCount: idea.interestCount ?? 0,
          interestedNames: (idea.interestedUsers ?? []).map(u => u.displayName),
          youInterested: idea.interestedUsers?.some(u => u.userId === this.ctx.userId) ?? false,
        })),
      };
    }

    // All lists for the group
    const lists = await this.http.request<Array<ApiIdeaListDTO & { ideas?: ApiIdeaDTO[] }>>(
      `/groups/${input.groupId}/idea-lists`,
    );
    const groupName = await this.resolveGroupName(input.groupId);
    return {
      groupName,
      lists: lists.map(l => ({
        listId: l.ideaListId ?? (l as Record<string, unknown>).id as string,
        name: l.name,
        category: l.category,
        ideaCount: l.ideas?.length ?? 0,
      })),
    };
  }

  // ─── get_watch_party (#5) ────────────────────────────────────────────────

  async getWatchParty(input: GetWatchPartyInput): Promise<GetWatchPartyOutput> {
    if (!input.groupId) throw new Error('groupId is required.');
    if (!input.seriesId) throw new Error('seriesId is required.');

    const path = `/groups/${input.groupId}/watch-parties/${input.seriesId}`;
    const wp = await this.http.request<ApiWatchPartySeriesDTO & {
      defaultTime?: string;
      dayOverride?: number;
      timezone?: string;
      interestLevels?: Array<{ userId: string; level: string; userName: string }>;
      hangouts?: Array<{ hangoutId: string; title: string; startTimestamp: number | null; endTimestamp: number | null }>;
    }>(path);

    // Build schedule string from defaultTime + dayOverride
    let schedule: string | null = wp.schedule ?? null;
    if (!schedule && wp.defaultTime) {
      const dayNames = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
      const dayStr = wp.dayOverride != null ? dayNames[wp.dayOverride] : null;
      // Parse time like "20:00" into "8:00 PM"
      const [h, m] = wp.defaultTime.split(':').map(Number);
      const period = h! >= 12 ? 'PM' : 'AM';
      const h12 = h! % 12 || 12;
      const timeStr = m ? `${h12}:${String(m).padStart(2, '0')} ${period}` : `${h12}:00 ${period}`;
      schedule = dayStr ? `${dayStr} at ${timeStr}` : `at ${timeStr}`;
    }

    // Categorize interest levels
    const interestLevels = wp.interestLevels ?? [];
    const going = interestLevels
      .filter(il => il.level === 'GOING')
      .map(il => ({ name: il.userName }));
    const interested = interestLevels
      .filter(il => il.level === 'INTERESTED')
      .map(il => ({ name: il.userName }));
    const yourEntry = interestLevels.find(il => il.userId === this.ctx.userId);
    const yourStatus = yourEntry
      ? (yourEntry.level as 'GOING' | 'INTERESTED' | 'NOT_GOING')
      : null;

    // Find next episode and count aired episodes
    const hangouts = wp.hangouts ?? wp.parts?.map(p => ({
      hangoutId: p.hangoutId,
      title: p.title,
      startTimestamp: p.startTimestamp,
      endTimestamp: p.endTimestamp,
    })) ?? [];

    const now = Date.now();
    let nextEpisode: GetWatchPartyOutput['nextEpisode'] = null;
    let episodesAired = 0;

    const sorted = [...hangouts].sort(
      (a, b) => (a.startTimestamp ?? 0) - (b.startTimestamp ?? 0),
    );

    for (const ep of sorted) {
      const ts = ep.startTimestamp ? ep.startTimestamp * (ep.startTimestamp < 1e12 ? 1000 : 1) : null;
      if (ts && ts < now) {
        episodesAired++;
      } else if (ts && ts >= now && !nextEpisode) {
        const dt = DateTime.fromMillis(ts).setZone(this.ctx.timezone);
        nextEpisode = {
          hangoutId: ep.hangoutId,
          title: ep.title,
          when: dt.isValid ? dt.toFormat("EEEE, LLL d 'at' h:mm a") : null,
        };
      }
    }

    return {
      seriesId: wp.seriesId,
      title: wp.title ?? (wp as Record<string, unknown>).seriesTitle as string,
      schedule,
      going,
      interested,
      yourStatus,
      nextEpisode,
      totalEpisodes: wp.totalParts ?? hangouts.length,
      episodesAired,
    };
  }

  // ─── create_idea_list (#14) ──────────────────────────────────────────────

  async createIdeaList(input: CreateIdeaListInput): Promise<CreateIdeaListOutput> {
    if (!input.groupId) throw new Error('groupId is required.');
    if (!input.name || input.name.trim().length === 0) throw new Error('name is required.');

    const body: Record<string, unknown> = { name: input.name };
    if (input.category) body.category = input.category;
    if (input.note) body.note = input.note;

    const result = await this.http.request<ApiIdeaListDTO>(
      `/groups/${input.groupId}/idea-lists`,
      { method: 'POST', body },
    );

    const groupName = await this.resolveGroupName(input.groupId);

    return {
      listId: result.ideaListId ?? (result as Record<string, unknown>).id as string,
      name: result.name,
      category: result.category,
      groupName,
    };
  }

  // ─── add_idea (#15) ──────────────────────────────────────────────────────

  async addIdea(input: AddIdeaInput): Promise<AddIdeaOutput> {
    if (!input.groupId) throw new Error('groupId is required.');
    if (!input.listId) throw new Error('listId is required.');
    if (!input.name || input.name.trim().length === 0) throw new Error('name is required.');

    const body: Record<string, unknown> = { name: input.name };
    if (input.note) body.note = input.note;
    if (input.url) body.url = input.url;
    if (input.address) body.address = input.address;

    const result = await this.http.request<ApiIdeaDTO & { listName?: string }>(
      `/groups/${input.groupId}/idea-lists/${input.listId}/ideas`,
      { method: 'POST', body },
    );

    // Try to get list name from a fetch if not in response
    let listName = result.listName ?? '';
    if (!listName) {
      try {
        const list = await this.http.request<ApiIdeaListDTO>(
          `/groups/${input.groupId}/idea-lists/${input.listId}`,
        );
        listName = list.name;
      } catch {
        listName = 'Idea List';
      }
    }

    return {
      ideaId: result.ideaId ?? (result as Record<string, unknown>).id as string,
      name: result.name,
      listName,
    };
  }

  // ─── toggle_idea_interest (#16) ──────────────────────────────────────────

  async toggleIdeaInterest(input: ToggleIdeaInterestInput): Promise<ToggleIdeaInterestOutput> {
    if (!input.groupId) throw new Error('groupId is required.');
    if (!input.listId) throw new Error('listId is required.');
    if (!input.ideaId) throw new Error('ideaId is required.');

    const basePath = `/groups/${input.groupId}/idea-lists/${input.listId}/ideas/${input.ideaId}/interest`;

    const result = await this.http.request<ApiIdeaDTO>(basePath, {
      method: input.interested ? 'PUT' : 'DELETE',
    });

    return {
      ideaId: input.ideaId,
      name: result.name,
      youInterested: input.interested,
      interestCount: result.interestCount ?? 0,
    };
  }

  // ─── offer_ride (#19) ────────────────────────────────────────────────────

  async offerRide(input: OfferRideInput): Promise<OfferRideOutput> {
    if (!input.hangoutId) throw new Error('hangoutId is required.');
    if (!input.capacity || input.capacity < 2 || input.capacity > 8) {
      throw new Error('capacity must be between 2 and 8 (includes driver).');
    }

    const body: Record<string, unknown> = { totalCapacity: input.capacity };
    if (input.notes) body.notes = input.notes;

    const result = await this.http.request<{
      totalCapacity: number;
      availableSeats: number;
      notes: string | null;
    }>(`/events/${input.hangoutId}/carpool/cars`, { method: 'POST', body });

    return {
      hangoutId: input.hangoutId,
      capacity: result.totalCapacity,
      seatsOpen: result.availableSeats,
      notes: result.notes ?? input.notes ?? null,
    };
  }

  // ─── request_ride (#20) ──────────────────────────────────────────────────

  async requestRide(input: RequestRideInput): Promise<RequestRideOutput> {
    if (!input.hangoutId) throw new Error('hangoutId is required.');

    const body: Record<string, unknown> = {};
    if (input.notes) body.notes = input.notes;

    await this.http.request(`/events/${input.hangoutId}/carpool/riderequests`, {
      method: 'POST',
      body,
    });

    return {
      hangoutId: input.hangoutId,
      requested: true,
    };
  }

  // ─── update_ticket_status (#21) — Upsert pattern ────────────────────────

  async updateTicketStatus(input: UpdateTicketStatusInput): Promise<UpdateTicketStatusOutput> {
    if (!input.hangoutId) throw new Error('hangoutId is required.');
    if (!input.type) throw new Error('type is required (TICKET_PURCHASED, TICKET_EXTRA, or TICKET_NEEDED).');

    // Check for existing participation by this user
    const participations = await this.http.request<ApiParticipationDTO[]>(
      `/hangouts/${input.hangoutId}/participations`,
    );

    const existing = participations.find(p => p.userId === this.ctx.userId);

    const body: Record<string, unknown> = { type: input.type };
    if (input.section !== undefined) body.section = input.section;
    if (input.seat !== undefined) body.seat = input.seat;

    let result: ApiParticipationDTO;

    if (existing) {
      // Update existing participation
      result = await this.http.request<ApiParticipationDTO>(
        `/hangouts/${input.hangoutId}/participations/${existing.participationId}`,
        { method: 'PUT', body },
      );
    } else {
      // Create new participation
      result = await this.http.request<ApiParticipationDTO>(
        `/hangouts/${input.hangoutId}/participations`,
        { method: 'POST', body },
      );
    }

    return {
      hangoutId: input.hangoutId,
      participationId: result.participationId,
      type: result.type,
      section: result.section ?? null,
    };
  }

  // ─── parse_event_url (#22) — No auth required ───────────────────────────

  async parseEventUrl(input: ParseEventUrlInput): Promise<ParseEventUrlOutput> {
    if (!input.url || input.url.trim().length === 0) {
      throw new Error('url is required.');
    }

    const result = await this.http.requestNoAuth<{
      title?: string;
      description?: string;
      startTime?: string;
      endTime?: string;
      location?: {
        name?: string;
        streetAddress?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        country?: string;
      };
      url?: string;
      sourceUrl?: string;
      ticketOffers?: unknown[];
    }>('/external/parse', {
      method: 'POST',
      body: { url: input.url },
    });

    // Build human-readable "when" string from startTime/endTime
    let when: string | null = null;
    if (result.startTime) {
      when = formatTimeInfo(
        { startTime: result.startTime, endTime: result.endTime },
        this.ctx.timezone,
      );
    }

    return {
      title: result.title ?? 'Untitled Event',
      description: result.description ?? null,
      when,
      startTime: result.startTime ?? null,
      endTime: result.endTime ?? null,
      location: result.location ?? null,
      ticketLink: result.url ?? result.sourceUrl ?? input.url,
      hasTickets: (result.ticketOffers?.length ?? 0) > 0,
    };
  }

  // ─── get_hangout_detail (#3) — Biggest response formatter ────────────────

  async getHangoutDetail(input: GetHangoutDetailInput): Promise<GetHangoutDetailOutput> {
    if (!input.hangoutId) {
      throw new Error('hangoutId is required. Use get_group_feed first to find the hangout ID.');
    }

    const detail = await this.http.request<ApiHangoutDetail>(
      `/hangouts/${input.hangoutId}`,
    );

    const hangout = detail.hangout;

    // Cache the groupId mapping
    const groupId = hangout.associatedGroups?.[0] ?? null;
    if (groupId) {
      this.feedCache.setHangoutGroupMapping(input.hangoutId, groupId);
    }

    // Format location
    let location: GetHangoutDetailOutput['location'] = null;
    if (hangout.location) {
      const loc = hangout.location;
      const addressParts: string[] = [];
      if (loc.streetAddress) addressParts.push(loc.streetAddress);
      if (loc.city) addressParts.push(loc.city);
      if (loc.state) addressParts.push(loc.state);
      if (loc.postalCode) addressParts.push(loc.postalCode);
      location = {
        name: loc.name ?? '',
        address: addressParts.join(', '),
      };
    }

    // Format attendance by status
    const attendance: GetHangoutDetailOutput['attendance'] = {
      going: [],
      interested: [],
      notGoing: [],
    };
    for (const il of detail.attendance ?? []) {
      const entry = { userId: il.userId, name: il.userName, notes: il.notes };
      switch (il.status) {
        case 'GOING': attendance.going.push(entry); break;
        case 'INTERESTED': attendance.interested.push(entry); break;
        case 'NOT_GOING': attendance.notGoing.push(entry); break;
      }
    }

    // Filter out non-viewable polls; split TIME polls into a derived
    // "proposed times" list, leave the rest as generic polls.
    const visiblePolls = (detail.polls ?? []).filter(
      (p: ApiPollDTO) => p.viewable !== false,
    );
    const polls = visiblePolls
      .filter(p => p.attributeType !== 'TIME')
      .map((poll: ApiPollDTO) => ({
        pollId: poll.pollId,
        title: poll.title,
        options: poll.options.map(opt => ({
          optionId: opt.optionId,
          text: opt.text,
          votes: opt.voteCount,
          voterNames: (opt.votes ?? [])
            .filter(v => v.displayName)
            .map(v => v.displayName!),
          youVoted: opt.userVoted,
        })),
        totalVotes: poll.totalVotes,
      }));

    // Format carpool — detail response has flat cars + carRiders joined by driverId
    const ridersByDriver = new Map<string, string[]>();
    for (const rider of detail.carRiders ?? []) {
      const list = ridersByDriver.get(rider.driverId) ?? [];
      list.push(rider.riderName);
      ridersByDriver.set(rider.driverId, list);
    }
    const carpool = {
      cars: (detail.cars ?? []).map(car => {
        const riders = ridersByDriver.get(car.driverId) ?? [];
        return {
          driverName: car.driverName,
          driverId: car.driverId,
          capacity: car.totalCapacity,
          seatsOpen: car.availableSeats,
          riders,
          notes: car.notes,
        };
      }),
      rideRequests: (detail.needsRide ?? []).map(r => ({
        name: r.displayName,
        notes: r.notes,
      })),
    };

    // Format tickets
    let tickets: GetHangoutDetailOutput['tickets'] = null;
    if (hangout.ticketsRequired) {
      const haveTickets: Array<{ name: string; section: string | null; seat: string | null }> = [];
      const needTickets: Array<{ name: string }> = [];
      const extraTickets: Array<{ name: string }> = [];
      for (const p of detail.participations ?? []) {
        switch (p.type) {
          case 'TICKET_PURCHASED':
            haveTickets.push({ name: p.displayName, section: p.section, seat: p.seat });
            break;
          case 'TICKET_NEEDED':
            needTickets.push({ name: p.displayName });
            break;
          case 'TICKET_EXTRA':
            extraTickets.push({ name: p.displayName });
            break;
        }
      }
      tickets = {
        required: true,
        ticketLink: hangout.ticketLink ?? null,
        discountCode: hangout.discountCode ?? null,
        haveTickets,
        needTickets,
        extraTickets,
      };
    }

    // Derive proposed times from active TIME polls. Each option becomes
    // one suggestion, with the time formatted from its timeInput. supporterIds
    // are reflected via voteCount + userVoted; voter display names come from
    // the option's votes array when populated.
    const timeSuggestions = visiblePolls
      .filter(p => p.attributeType === 'TIME' && p.isActive)
      .flatMap(poll =>
        poll.options.map(opt => ({
          pollId: poll.pollId,
          optionId: opt.optionId,
          when: opt.timeInput
            ? formatTimeInfo(opt.timeInput, this.ctx.timezone) ?? opt.text
            : opt.text,
          supportCount: opt.voteCount,
          supporterNames: (opt.votes ?? [])
            .filter(v => v.displayName)
            .map(v => v.displayName!),
          youSupported: opt.userVoted,
        })),
      );

    // Format nudges as string array of types
    const nudges = (detail.nudges ?? []).map(n => n.type);

    return {
      hangoutId: hangout.hangoutId,
      title: hangout.title,
      description: hangout.description,
      momentum: hangout.momentumCategory ?? detail.momentum?.category ?? 'BUILDING',
      when: formatTimeInfo(hangout.timeInfo, this.ctx.timezone),
      location,
      attendance,
      yourRsvpStatus: findUserRsvp(detail.attendance ?? [], this.ctx.userId),
      polls,
      carpool,
      tickets,
      timeSuggestions,
      nudges,
    };
  }

  // ─── update_hangout (#7) — Partial update + cache invalidation ──────────

  async updateHangout(input: UpdateHangoutInput): Promise<UpdateHangoutOutput> {
    if (!input.hangoutId) {
      throw new Error('hangoutId is required.');
    }

    // Build request body with only provided fields
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.description !== undefined) body.description = input.description;
    if (input.confirmed !== undefined) body.confirmed = input.confirmed;
    if (input.timeInfo !== undefined) body.timeInfo = input.timeInfo;
    if (input.location !== undefined) body.location = input.location;
    if (input.carpoolEnabled !== undefined) body.carpoolEnabled = input.carpoolEnabled;
    if (input.ticketLink !== undefined) body.ticketLink = input.ticketLink;
    if (input.ticketsRequired !== undefined) body.ticketsRequired = input.ticketsRequired;
    if (input.discountCode !== undefined) body.discountCode = input.discountCode;

    await this.http.request(`/hangouts/${input.hangoutId}`, {
      method: 'PATCH',
      body,
    });

    // Invalidate feed cache for the affected group
    const groupId = await this.resolveGroupIdForHangout(input.hangoutId);
    if (groupId) {
      this.feedCache.invalidate(groupId);
    }

    return {
      hangoutId: input.hangoutId,
      success: true,
    };
  }

  // ─── remove_rsvp (#9) — Delete RSVP ────────────────────────────────────

  async removeRsvp(input: RemoveRsvpInput): Promise<RemoveRsvpOutput> {
    if (!input.hangoutId) {
      throw new Error('hangoutId is required.');
    }

    // Fetch detail first to get the title before deleting
    const detail = await this.http.request<ApiHangoutDetail>(
      `/hangouts/${input.hangoutId}`,
    );

    await this.http.request(`/hangouts/${input.hangoutId}/interest`, {
      method: 'DELETE',
    });

    // Invalidate feed cache
    const groupId = this.feedCache.getGroupIdForHangout(input.hangoutId)
      ?? detail.hangout.associatedGroups?.[0]
      ?? null;
    if (groupId) {
      this.feedCache.setHangoutGroupMapping(input.hangoutId, groupId);
      this.feedCache.invalidate(groupId);
    }

    return {
      hangoutId: input.hangoutId,
      title: detail.hangout.title,
      removed: true,
    };
  }

  // ─── create_group (#10) ─────────────────────────────────────────────────

  async createGroup(input: CreateGroupInput): Promise<CreateGroupOutput> {
    if (!input.groupName || input.groupName.trim().length === 0) {
      throw new Error('groupName is required.');
    }

    const body: Record<string, unknown> = {
      groupName: input.groupName,
      isPublic: input.isPublic ?? false,
    };

    const result = await this.http.request<ApiGroupDTO>('/groups', {
      method: 'POST',
      body,
    });

    // Invalidate group cache so next list_groups picks up the new group
    this.groupCache = null;

    return {
      groupId: result.groupId,
      groupName: result.groupName,
    };
  }

  // ─── create_poll (#11) ──────────────────────────────────────────────────

  async createPoll(input: CreatePollInput): Promise<CreatePollOutput> {
    if (!input.hangoutId) throw new Error('hangoutId is required.');
    if (!input.title || input.title.trim().length === 0) throw new Error('title is required.');

    const isTimePoll = input.attributeType === 'TIME';
    if (isTimePoll) {
      if (!input.options || input.options.length === 0) {
        throw new Error('TIME polls require at least one option with a timeInput.');
      }
      for (const opt of input.options) {
        if (!opt.timeInput) {
          throw new Error('Every TIME poll option must include a timeInput. Use build_time first.');
        }
      }
    } else if (input.options) {
      for (const opt of input.options) {
        if (!opt.text || opt.text.trim().length === 0) {
          throw new Error('Every poll option must include non-empty text (or set attributeType=TIME and provide timeInput).');
        }
      }
    }

    const body: Record<string, unknown> = {
      title: input.title,
      multipleChoice: isTimePoll ? true : input.multipleChoice ?? false,
    };
    if (input.attributeType) body.attributeType = input.attributeType;
    if (input.options) {
      body.options = isTimePoll
        ? input.options.map(o => ({ timeInput: o.timeInput }))
        : input.options.map(o => o.text ?? '').filter(t => t.length > 0);
    }

    const result = await this.http.request<{
      eventId: string;
      pollId: string;
      title: string;
    }>(`/hangouts/${input.hangoutId}/polls`, { method: 'POST', body });

    // Fetch the poll to get options with their IDs
    const polls = await this.http.request<ApiPollDTO[]>(
      `/hangouts/${input.hangoutId}/polls`,
    );
    const createdPoll = polls.find(p => p.pollId === result.pollId);

    return {
      pollId: result.pollId,
      hangoutId: input.hangoutId,
      title: result.title,
      attributeType: (createdPoll?.attributeType as CreatePollOutput['attributeType']) ?? input.attributeType ?? null,
      options: (createdPoll?.options ?? []).map(o => ({
        optionId: o.optionId,
        text: o.timeInput
          ? formatTimeInfo(o.timeInput, this.ctx.timezone) ?? o.text
          : o.text,
      })),
    };
  }

  // ─── vote_on_poll (#12) ─────────────────────────────────────────────────

  async voteOnPoll(input: VoteOnPollInput): Promise<VoteOnPollOutput> {
    if (!input.hangoutId) throw new Error('hangoutId is required.');
    if (!input.pollId) throw new Error('pollId is required.');
    if (!input.optionId) throw new Error('optionId is required.');

    await this.http.request(
      `/hangouts/${input.hangoutId}/polls/${input.pollId}/vote`,
      { method: 'POST', body: { optionId: input.optionId, voteType: 'YES' } },
    );

    // Re-fetch the poll to get updated counts and option text
    const polls = await this.http.request<ApiPollDTO[]>(
      `/hangouts/${input.hangoutId}/polls`,
    );
    const poll = polls.find(p => p.pollId === input.pollId);
    const option = poll?.options.find(o => o.optionId === input.optionId);

    return {
      pollId: input.pollId,
      optionText: option?.text ?? 'Unknown option',
      totalVotesForOption: option?.voteCount ?? 1,
      pollTotalVotes: poll?.totalVotes ?? 1,
    };
  }

  // ─── add_poll_option (#13) ──────────────────────────────────────────────

  async addPollOption(input: AddPollOptionInput): Promise<AddPollOptionOutput> {
    if (!input.hangoutId) throw new Error('hangoutId is required.');
    if (!input.pollId) throw new Error('pollId is required.');
    const hasText = input.text && input.text.trim().length > 0;
    const hasTimeInput = !!input.timeInput;
    if (!hasText && !hasTimeInput) {
      throw new Error(
        'Provide either text (for a regular poll) or timeInput (for a time-suggestion poll). Use build_time first to construct timeInput.',
      );
    }

    const body: Record<string, unknown> = hasTimeInput
      ? { timeInput: input.timeInput }
      : { text: input.text };

    const result = await this.http.request<{
      eventId: string;
      pollId: string;
      optionId: string;
      text: string;
      timeInput?: TimeInfo | null;
    }>(`/hangouts/${input.hangoutId}/polls/${input.pollId}/options`, {
      method: 'POST',
      body,
    });

    const displayText = result.timeInput
      ? formatTimeInfo(result.timeInput, this.ctx.timezone) ?? result.text
      : result.text;

    return {
      optionId: result.optionId,
      text: displayText,
      pollId: result.pollId,
    };
  }

  // ─── add_member (#17) ──────────────────────────────────────────────────

  async addMember(input: AddMemberInput): Promise<AddMemberOutput> {
    if (!input.groupId) throw new Error('groupId is required.');
    if (!input.phoneNumber && !input.userId) {
      throw new Error('Either phoneNumber or userId is required.');
    }

    const body: Record<string, unknown> = {};
    if (input.phoneNumber) body.phoneNumber = input.phoneNumber;
    if (input.userId) body.userId = input.userId;

    await this.http.request(`/groups/${input.groupId}/members`, {
      method: 'POST',
      body,
    });

    const groupName = await this.resolveGroupName(input.groupId);

    return {
      groupName,
      added: true,
      message: "Added to the group. If they don't have the app yet, they'll be in the group when they sign up.",
    };
  }

  // ─── generate_invite_link (#18) ─────────────────────────────────────────

  async generateInviteLink(input: GenerateInviteLinkInput): Promise<GenerateInviteLinkOutput> {
    if (!input.groupId) throw new Error('groupId is required.');

    const result = await this.http.request<{
      inviteCode: string;
      shareUrl: string;
    }>(`/groups/${input.groupId}/invite-code`, { method: 'POST' });

    const groupName = await this.resolveGroupName(input.groupId);

    return {
      groupName,
      inviteCode: result.inviteCode,
      shareUrl: result.shareUrl,
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
        case 'get_idea_lists':
          return await this.getIdeaLists(args as unknown as GetIdeaListsInput);
        case 'get_watch_party':
          return await this.getWatchParty(args as unknown as GetWatchPartyInput);
        case 'create_idea_list':
          return await this.createIdeaList(args as unknown as CreateIdeaListInput);
        case 'add_idea':
          return await this.addIdea(args as unknown as AddIdeaInput);
        case 'toggle_idea_interest':
          return await this.toggleIdeaInterest(args as unknown as ToggleIdeaInterestInput);
        case 'offer_ride':
          return await this.offerRide(args as unknown as OfferRideInput);
        case 'request_ride':
          return await this.requestRide(args as unknown as RequestRideInput);
        case 'update_ticket_status':
          return await this.updateTicketStatus(args as unknown as UpdateTicketStatusInput);
        case 'parse_event_url':
          return await this.parseEventUrl(args as unknown as ParseEventUrlInput);
        case 'get_hangout_detail':
          return await this.getHangoutDetail(args as unknown as GetHangoutDetailInput);
        case 'update_hangout':
          return await this.updateHangout(args as unknown as UpdateHangoutInput);
        case 'remove_rsvp':
          return await this.removeRsvp(args as unknown as RemoveRsvpInput);
        case 'create_group':
          return await this.createGroup(args as unknown as CreateGroupInput);
        case 'create_poll':
          return await this.createPoll(args as unknown as CreatePollInput);
        case 'vote_on_poll':
          return await this.voteOnPoll(args as unknown as VoteOnPollInput);
        case 'add_poll_option':
          return await this.addPollOption(args as unknown as AddPollOptionInput);
        case 'add_member':
          return await this.addMember(args as unknown as AddMemberInput);
        case 'generate_invite_link':
          return await this.generateInviteLink(args as unknown as GenerateInviteLinkInput);
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

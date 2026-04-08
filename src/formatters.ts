/**
 * Response formatting utilities.
 * Transforms raw API responses into simplified MCP tool outputs.
 */

import { DateTime } from 'luxon';
import type {
  Address,
  ApiGroupFeedResponse,
  ApiHangoutSummary,
  ApiSeriesSummary,
  FeedHangoutItem,
  FeedItem,
  FeedSeriesItem,
  GetGroupFeedOutput,
  InterestLevel,
  RsvpStatus,
  TimeInfo,
} from './types.js';

/** Format TimeInfo to a human-readable string using the configured timezone. */
export function formatTimeInfo(timeInfo: TimeInfo | null | undefined, timezone: string): string | null {
  if (!timeInfo) return null;

  if (timeInfo.startTime) {
    const dt = DateTime.fromISO(timeInfo.startTime, { zone: timezone });
    if (!dt.isValid) return null;
    let result = dt.toFormat("EEEE, LLL d 'at' h:mm a");
    if (timeInfo.endTime) {
      const end = DateTime.fromISO(timeInfo.endTime, { zone: timezone });
      if (end.isValid) {
        // Same day? Just show end time
        if (dt.hasSame(end, 'day')) {
          result += ` – ${end.toFormat('h:mm a')}`;
        } else {
          result += ` – ${end.toFormat("LLL d 'at' h:mm a")}`;
        }
      }
    }
    return result;
  }

  if (timeInfo.periodStart && timeInfo.periodGranularity) {
    const dt = DateTime.fromISO(timeInfo.periodStart, { zone: timezone });
    if (!dt.isValid) return null;

    switch (timeInfo.periodGranularity) {
      case 'morning':
        return `${dt.toFormat('EEEE, LLL d')} morning`;
      case 'afternoon':
        return `${dt.toFormat('EEEE, LLL d')} afternoon`;
      case 'evening':
        return `${dt.toFormat('EEEE, LLL d')} evening`;
      case 'night':
        return `${dt.toFormat('EEEE, LLL d')} night`;
      case 'day':
        return dt.toFormat('EEEE, LLL d');
      case 'weekend':
        return `Weekend of ${dt.toFormat('LLL d')}`;
      default:
        return dt.toFormat('EEEE, LLL d');
    }
  }

  return null;
}

/** Format an Address to a single string. */
export function formatAddress(location: Address | null | undefined): string | null {
  if (!location) return null;
  const parts: string[] = [];
  if (location.name) parts.push(location.name);
  const addressParts: string[] = [];
  if (location.streetAddress) addressParts.push(location.streetAddress);
  if (location.city) addressParts.push(location.city);
  if (location.state) addressParts.push(location.state);
  if (addressParts.length > 0) parts.push(addressParts.join(', '));
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Compute attendance counts from interestLevels array. */
export function computeAttendance(interestLevels: InterestLevel[]): {
  going: number;
  interested: number;
  notGoing: number;
} {
  let going = 0;
  let interested = 0;
  let notGoing = 0;
  for (const il of interestLevels) {
    switch (il.status) {
      case 'GOING': going++; break;
      case 'INTERESTED': interested++; break;
      case 'NOT_GOING': notGoing++; break;
    }
  }
  return { going, interested, notGoing };
}

/** Find the authenticated user's RSVP status from interestLevels. */
export function findUserRsvp(interestLevels: InterestLevel[], userId: string): RsvpStatus | null {
  const entry = interestLevels.find(il => il.userId === userId);
  return entry?.status ?? null;
}

/** Format a hangout summary from the feed into a FeedHangoutItem. */
export function formatFeedHangout(
  hangout: ApiHangoutSummary,
  userId: string,
  timezone: string,
): FeedHangoutItem {
  const attendance = computeAttendance(hangout.interestLevels ?? []);
  const item: FeedHangoutItem = {
    type: 'hangout',
    hangoutId: hangout.hangoutId,
    title: hangout.title,
    momentum: hangout.momentum?.category ?? 'BUILDING',
    when: formatTimeInfo(hangout.timeInfo, timezone),
    location: formatAddress(hangout.location),
    ...attendance,
    yourRsvpStatus: findUserRsvp(hangout.interestLevels ?? [], userId),
    hasPolls: (hangout.polls?.length ?? 0) > 0,
    hasCarpooling: hangout.carpoolEnabled,
    hasTickets: hangout.ticketsRequired === true,
  };

  if (hangout.ticketsRequired && hangout.participationSummary) {
    item.ticketSummary = {
      haveTickets: hangout.participationSummary.usersWithTickets.length,
      needTickets: hangout.participationSummary.usersNeedingTickets.length,
      extraTickets: hangout.participationSummary.extraTicketCount,
    };
  }

  return item;
}

/** Format a series summary from the feed into a FeedSeriesItem. */
export function formatFeedSeries(
  series: ApiSeriesSummary,
  timezone: string,
): FeedSeriesItem {
  // Find the next upcoming episode
  let nextEpisodeWhen: string | null = null;
  if (series.parts?.length > 0) {
    const now = DateTime.now().setZone(timezone);
    const upcoming = series.parts
      .filter(p => p.startTimestamp && DateTime.fromMillis(p.startTimestamp) > now)
      .sort((a, b) => (a.startTimestamp ?? 0) - (b.startTimestamp ?? 0));
    if (upcoming.length > 0 && upcoming[0]!.timeInfo) {
      nextEpisodeWhen = formatTimeInfo(upcoming[0]!.timeInfo, timezone);
    }
  }

  return {
    type: 'series',
    seriesId: series.seriesId,
    title: series.seriesTitle,
    totalParts: series.totalParts,
    nextEpisodeWhen,
  };
}

/** Format the full group feed response. */
export function formatGroupFeed(
  feed: ApiGroupFeedResponse,
  groupName: string,
  userId: string,
  timezone: string,
): GetGroupFeedOutput {
  const scheduled: FeedItem[] = [];
  for (const item of feed.withDay) {
    if (item.type === 'hangout') {
      scheduled.push(formatFeedHangout(item as ApiHangoutSummary, userId, timezone));
    } else if (item.type === 'series') {
      scheduled.push(formatFeedSeries(item as ApiSeriesSummary, timezone));
    }
  }

  const timeless: FeedHangoutItem[] = feed.needsDay.map(h =>
    formatFeedHangout(h, userId, timezone),
  );

  return {
    groupId: feed.groupId,
    groupName,
    scheduled,
    timeless,
  };
}

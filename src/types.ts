/**
 * Shared TypeScript interfaces for ALL 24 Hango MCP tools.
 * This is the contract that chunks 2 and 3 depend on.
 */

// ─── API Domain Types ────────────────────────────────────────────────────────

export interface TimeInfo {
  periodGranularity?: 'morning' | 'afternoon' | 'evening' | 'night' | 'day' | 'weekend';
  periodStart?: string; // ISO 8601 datetime with timezone offset
  startTime?: string;   // ISO 8601 datetime with timezone offset
  endTime?: string;     // ISO 8601 datetime with timezone offset
}

export interface Address {
  name?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Momentum {
  score: number;
  category: 'BUILDING' | 'GAINING_MOMENTUM' | 'CONFIRMED';
  confirmedAt: number | null;
  confirmedBy: string | null;
  suggestedBy: string | null;
}

export type RsvpStatus = 'GOING' | 'INTERESTED' | 'NOT_GOING';

export interface InterestLevel {
  eventId: string;
  userId: string;
  userName: string;
  status: RsvpStatus;
  notes: string | null;
  mainImagePath: string | null;
}

export interface ParticipationSummary {
  usersNeedingTickets: Array<{ userId: string; displayName: string }>;
  usersWithTickets: Array<{ userId: string; displayName: string }>;
  usersWithClaimedSpots: Array<{ userId: string; displayName: string }>;
  extraTicketCount: number;
  reservationOffers: unknown[];
}

// ─── API Response Types (raw from backend) ───────────────────────────────────

export interface ApiGroupDTO {
  groupId: string;
  groupName: string;
  isPublic: boolean;
  userRole: string;
  joinedAt: string;
  mainImagePath: string | null;
  backgroundImagePath: string | null;
  userMainImagePath: string | null;
}

export interface ApiHangoutSummary {
  type: 'hangout';
  hangoutId: string;
  title: string;
  status: string | null;
  timeInfo: TimeInfo | null;
  location: Address | null;
  participantCount: number;
  mainImagePath: string | null;
  description: string | null;
  visibility: string;
  carpoolEnabled: boolean;
  startTimestamp: number | null;
  endTimestamp: number | null;
  seriesId: string | null;
  seriesTitle: string | null;
  seriesImagePath: string | null;
  eventSeriesType: string | null;
  polls: unknown[];
  cars: unknown[];
  needsRide: unknown[];
  attributes: unknown[];
  interestLevels: InterestLevel[];
  participationSummary: ParticipationSummary | null;
  ticketLink: string | null;
  ticketsRequired: boolean | null;
  discountCode: string | null;
  externalId: string | null;
  externalSource: string | null;
  isGeneratedTitle: boolean;
  hostAtPlaceUserId: string | null;
  hostAtPlaceDisplayName: string | null;
  hostAtPlaceImagePath: string | null;
  momentum: Momentum | null;
  suggestedAttributes: Record<string, unknown>;
  nudges: unknown[];
}

export interface ApiSeriesSummary {
  type: 'series';
  seriesId: string;
  seriesTitle: string;
  seriesDescription: string | null;
  primaryEventId: string;
  startTimestamp: number | null;
  endTimestamp: number | null;
  mainImagePath: string | null;
  parts: ApiHangoutSummary[];
  totalParts: number;
  eventSeriesType: string;
  externalId: string | null;
  externalSource: string | null;
  isGeneratedTitle: boolean;
}

export type ApiFeedItem = ApiHangoutSummary | ApiSeriesSummary;

export interface ApiGroupFeedResponse {
  groupId: string;
  withDay: ApiFeedItem[];
  needsDay: ApiHangoutSummary[];
  nextPageToken: string | null;
  previousPageToken: string | null;
}

export interface ApiHangoutDetail {
  hangout: {
    hangoutId: string;
    title: string;
    description: string | null;
    location: Address | null;
    visibility: string;
    mainImagePath: string | null;
    timeInfo: TimeInfo | null;
    startTimestamp: number | null;
    endTimestamp: number | null;
    associatedGroups: string[];
    carpoolEnabled: boolean;
    version: number;
    createdBy: string;
    momentumCategory: string;
    momentumScore: number;
    confirmedAt: number | null;
    confirmedBy: string | null;
    suggestedBy: string | null;
    sourceIdeaId: string | null;
    sourceIdeaListId: string | null;
    externalId: string | null;
    externalSource: string | null;
    isGeneratedTitle: boolean;
    hostAtPlaceUserId: string | null;
    placeCategory: string | null;
    ticketLink: string | null;
    ticketsRequired: boolean | null;
    discountCode: string | null;
    seriesId: string | null;
  };
  attributes: Array<{ attributeId: string; attributeName: string; stringValue: string }>;
  polls: ApiPollDTO[];
  attendance: InterestLevel[];
  cars: ApiCarDTO[];
  carRiders: ApiCarRiderDTO[];
  needsRide: Array<{ userId: string; displayName: string; mainImagePath: string | null; notes: string | null }>;
  participations: ApiParticipationDTO[];
  reservationOffers: unknown[];
  votes: unknown[];
  hostAtPlaceDisplayName: string | null;
  hostAtPlaceImagePath: string | null;
  momentum: Momentum | null;
  suggestedAttributes: Record<string, unknown>;
  nudges: Array<{ type: string; message: string; actionUrl: string | null }>;
}

export interface ApiPollDTO {
  pollId: string;
  title: string;
  description: string | null;
  multipleChoice: boolean;
  options: Array<{
    optionId: string;
    text: string;
    voteCount: number;
    userVoted: boolean;
    createdBy: string;
    structuredValue: string | null;
    timeInput: TimeInfo | null;
    votes: Array<{ userId: string; voteType: string; displayName: string | null }>;
  }>;
  totalVotes: number;
  attributeType: string | null;
  isActive: boolean;
  promotedAt: number | null;
  viewable?: boolean;
  canAddOptions?: boolean;
  createdAtMillis: number;
}

export interface ApiCarDTO {
  eventId: string;
  driverId: string;
  driverName: string;
  totalCapacity: number;
  availableSeats: number;
  notes: string | null;
  driverImagePath: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiCarRiderDTO {
  eventId: string;
  driverId: string;
  riderId: string;
  riderName: string;
  plusOneCount: number;
  notes: string | null;
  riderImagePath: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiParticipationDTO {
  participationId: string;
  userId: string;
  displayName: string;
  mainImagePath: string | null;
  type: 'TICKET_PURCHASED' | 'TICKET_EXTRA' | 'TICKET_NEEDED';
  section: string | null;
  seat: string | null;
  reservationOfferId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCreateHangoutResponse {
  hangoutId: string;
  title: string;
  description: string | null;
  location: Address | null;
  visibility: string;
  mainImagePath: string | null;
  timeInfo: TimeInfo | null;
  startTimestamp: number | null;
  endTimestamp: number | null;
  associatedGroups: string[];
  carpoolEnabled: boolean;
  version: number;
  createdBy: string;
  momentumCategory: string;
  momentumScore: number;
  confirmedAt: number | null;
  confirmedBy: string | null;
  suggestedBy: string | null;
  sourceIdeaId: string | null;
  sourceIdeaListId: string | null;
  externalId: string | null;
  externalSource: string | null;
  isGeneratedTitle: boolean;
  hostAtPlaceUserId: string | null;
  placeCategory: string | null;
  ticketLink: string | null;
  ticketsRequired: boolean | null;
  discountCode: string | null;
  seriesId: string | null;
}

export interface ApiProfileResponse {
  id: string;
  username: string;
  displayName: string;
  phoneNumber?: string;
  mainImagePath?: string | null;
}

export interface ApiIdeaListDTO {
  ideaListId: string;
  name: string;
  category: string;
  note: string | null;
  groupId: string;
}

export interface ApiIdeaDTO {
  ideaId: string;
  name: string;
  note: string | null;
  url: string | null;
  address: string | null;
  rating: number | null;
  priceLevel: number | null;
  interestCount: number;
  userInterested: boolean;
  interestedUsers: Array<{ userId: string; displayName: string }>;
}

export interface ApiWatchPartySeriesDTO {
  seriesId: string;
  title: string;
  description: string | null;
  schedule: string | null;
  groupId: string;
  totalParts: number;
  eventSeriesType: string;
  parts: ApiHangoutSummary[];
}

// ─── Tool Input Types ────────────────────────────────────────────────────────

// #0 build_time
export interface BuildTimeInput {
  text: string;
}

// #1 list_groups
export type ListGroupsInput = Record<string, never>;

// #2 get_group_feed
export interface GetGroupFeedInput {
  groupId: string;
  filter?: 'ALL' | 'CONFIRMED' | 'EVERYTHING';
}

// #3 get_hangout_detail
export interface GetHangoutDetailInput {
  hangoutId: string;
}

// #4 get_idea_lists
export interface GetIdeaListsInput {
  groupId: string;
  listId?: string;
}

// #5 get_watch_party
export interface GetWatchPartyInput {
  groupId: string;
  seriesId: string;
}

// #6 create_hangout
export interface CreateHangoutInput {
  groupId: string;
  title: string;
  description?: string;
  confirmed?: boolean;
  timeInfo?: TimeInfo;
  location?: Address;
  carpoolEnabled?: boolean;
  ticketLink?: string;
  ticketsRequired?: boolean;
  discountCode?: string;
  polls?: Array<{ title: string; options?: string[] }>;
  sourceIdeaId?: string;
  sourceIdeaListId?: string;
}

// #7 update_hangout
export interface UpdateHangoutInput {
  hangoutId: string;
  title?: string;
  description?: string;
  confirmed?: boolean;
  timeInfo?: TimeInfo;
  location?: Address;
  carpoolEnabled?: boolean;
  ticketLink?: string;
  ticketsRequired?: boolean;
  discountCode?: string;
}

// #8 set_rsvp
export interface SetRsvpInput {
  hangoutId: string;
  status: RsvpStatus;
  notes?: string;
}

// #9 remove_rsvp
export interface RemoveRsvpInput {
  hangoutId: string;
}

// #10 create_group
export interface CreateGroupInput {
  groupName: string;
  isPublic?: boolean;
}

// #11 create_poll
export type PollAttributeType = 'TIME' | 'LOCATION' | 'DESCRIPTION';
export interface PollOptionInput {
  text?: string;
  timeInput?: TimeInfo;
}
export interface CreatePollInput {
  hangoutId: string;
  title: string;
  attributeType?: PollAttributeType;
  options?: PollOptionInput[];
  multipleChoice?: boolean;
}

// #12 vote_on_poll
export interface VoteOnPollInput {
  hangoutId: string;
  pollId: string;
  optionId: string;
}

// #13 add_poll_option
export interface AddPollOptionInput {
  hangoutId: string;
  pollId: string;
  text?: string;
  timeInput?: TimeInfo;
}

// #14 create_idea_list
export interface CreateIdeaListInput {
  groupId: string;
  name: string;
  category?: string;
  note?: string;
}

// #15 add_idea
export interface AddIdeaInput {
  groupId: string;
  listId: string;
  name: string;
  note?: string;
  url?: string;
  address?: string;
}

// #16 toggle_idea_interest
export interface ToggleIdeaInterestInput {
  groupId: string;
  listId: string;
  ideaId: string;
  interested: boolean;
}

// #17 add_member
export interface AddMemberInput {
  groupId: string;
  phoneNumber?: string;
  userId?: string;
}

// #18 generate_invite_link
export interface GenerateInviteLinkInput {
  groupId: string;
}

// #19 offer_ride
export interface OfferRideInput {
  hangoutId: string;
  capacity: number;
  notes?: string;
}

// #20 request_ride
export interface RequestRideInput {
  hangoutId: string;
  notes?: string;
}

// #21 update_ticket_status
export interface UpdateTicketStatusInput {
  hangoutId: string;
  type: 'TICKET_PURCHASED' | 'TICKET_EXTRA' | 'TICKET_NEEDED';
  section?: string;
  seat?: string;
}

// #22 parse_event_url
export interface ParseEventUrlInput {
  url: string;
}

// ─── Tool Output Types ───────────────────────────────────────────────────────

// #0 build_time
export interface BuildTimeOutput {
  timeInfo: TimeInfo;
  humanReadable: string;
  mode: 'fuzzy' | 'exact';
}

// #1 list_groups
export interface ListGroupsOutput {
  groups: Array<{ groupId: string; groupName: string }>;
}

// #2 get_group_feed — scheduled item (hangout)
export interface FeedHangoutItem {
  type: 'hangout';
  hangoutId: string;
  title: string;
  momentum: string;
  when: string | null;
  location: string | null;
  going: number;
  interested: number;
  notGoing: number;
  yourRsvpStatus: RsvpStatus | null;
  hasPolls: boolean;
  hasCarpooling: boolean;
  hasTickets: boolean;
  ticketSummary?: { haveTickets: number; needTickets: number; extraTickets: number };
}

// #2 get_group_feed — scheduled item (series)
export interface FeedSeriesItem {
  type: 'series';
  seriesId: string;
  title: string;
  totalParts: number;
  nextEpisodeWhen: string | null;
}

export type FeedItem = FeedHangoutItem | FeedSeriesItem;

// #2 get_group_feed
export interface GetGroupFeedOutput {
  groupId: string;
  groupName: string;
  scheduled: FeedItem[];
  timeless: FeedHangoutItem[];
}

// #3 get_hangout_detail
export interface GetHangoutDetailOutput {
  hangoutId: string;
  title: string;
  description: string | null;
  momentum: string;
  when: string | null;
  location: { name: string; address: string } | null;
  attendance: {
    going: Array<{ userId: string; name: string; notes: string | null }>;
    interested: Array<{ userId: string; name: string; notes: string | null }>;
    notGoing: Array<{ userId: string; name: string; notes: string | null }>;
  };
  yourRsvpStatus: RsvpStatus | null;
  polls: Array<{
    pollId: string;
    title: string;
    options: Array<{
      optionId: string;
      text: string;
      votes: number;
      voterNames: string[];
      youVoted: boolean;
    }>;
    totalVotes: number;
  }>;
  carpool: {
    cars: Array<{
      driverName: string;
      driverId: string;
      capacity: number;
      seatsOpen: number;
      riders: string[];
      notes: string | null;
    }>;
    rideRequests: Array<{ name: string; notes: string | null }>;
  };
  tickets: {
    required: boolean;
    ticketLink: string | null;
    discountCode: string | null;
    haveTickets: Array<{ name: string; section: string | null; seat: string | null }>;
    needTickets: Array<{ name: string }>;
    extraTickets: Array<{ name: string }>;
  } | null;
  timeSuggestions: Array<{
    pollId: string;
    optionId: string;
    when: string;
    supportCount: number;
    supporterNames: string[];
    youSupported: boolean;
  }>;
  nudges: string[];
}

// #4 get_idea_lists (all)
export interface GetIdeaListsAllOutput {
  groupName: string;
  lists: Array<{ listId: string; name: string; category: string; ideaCount: number }>;
}

// #4 get_idea_lists (specific)
export interface GetIdeaListDetailOutput {
  listId: string;
  name: string;
  category: string;
  ideas: Array<{
    ideaId: string;
    name: string;
    note: string | null;
    address: string | null;
    rating: number | null;
    priceLevel: number | null;
    interestCount: number;
    interestedNames: string[];
    youInterested: boolean;
  }>;
}

// #5 get_watch_party
export interface GetWatchPartyOutput {
  seriesId: string;
  title: string;
  schedule: string | null;
  going: Array<{ name: string }>;
  interested: Array<{ name: string }>;
  yourStatus: RsvpStatus | null;
  nextEpisode: { hangoutId: string; title: string; when: string | null } | null;
  totalEpisodes: number;
  episodesAired: number;
}

// #6 create_hangout
export interface CreateHangoutOutput {
  hangoutId: string;
  title: string;
  momentum: string;
  yourRsvpStatus: RsvpStatus;
  groupName: string;
}

// #7 update_hangout
export interface UpdateHangoutOutput {
  hangoutId: string;
  success: true;
}

// #8 set_rsvp
export interface SetRsvpOutput {
  hangoutId: string;
  title: string;
  yourRsvpStatus: RsvpStatus;
  going: number;
  interested: number;
}

// #9 remove_rsvp
export interface RemoveRsvpOutput {
  hangoutId: string;
  title: string;
  removed: true;
}

// #10 create_group
export interface CreateGroupOutput {
  groupId: string;
  groupName: string;
}

// #11 create_poll
export interface CreatePollOutput {
  pollId: string;
  hangoutId: string;
  title: string;
  attributeType: PollAttributeType | null;
  options: Array<{ optionId: string; text: string }>;
}

// #12 vote_on_poll
export interface VoteOnPollOutput {
  pollId: string;
  optionText: string;
  totalVotesForOption: number;
  pollTotalVotes: number;
}

// #13 add_poll_option
export interface AddPollOptionOutput {
  optionId: string;
  text: string;
  pollId: string;
}

// #14 create_idea_list
export interface CreateIdeaListOutput {
  listId: string;
  name: string;
  category: string;
  groupName: string;
}

// #15 add_idea
export interface AddIdeaOutput {
  ideaId: string;
  name: string;
  listName: string;
}

// #16 toggle_idea_interest
export interface ToggleIdeaInterestOutput {
  ideaId: string;
  name: string;
  youInterested: boolean;
  interestCount: number;
}

// #17 add_member
export interface AddMemberOutput {
  groupName: string;
  added: true;
  message: string;
}

// #18 generate_invite_link
export interface GenerateInviteLinkOutput {
  groupName: string;
  inviteCode: string;
  shareUrl: string;
}

// #19 offer_ride
export interface OfferRideOutput {
  hangoutId: string;
  capacity: number;
  seatsOpen: number;
  notes: string | null;
}

// #20 request_ride
export interface RequestRideOutput {
  hangoutId: string;
  requested: true;
}

// #21 update_ticket_status
export interface UpdateTicketStatusOutput {
  hangoutId: string;
  participationId: string;
  type: string;
  section: string | null;
}

// #22 parse_event_url
export interface ParseEventUrlOutput {
  title: string;
  description: string | null;
  when: string | null;
  startTime: string | null;
  endTime: string | null;
  location: Address | null;
  ticketLink: string | null;
  hasTickets: boolean;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

export interface SessionContext {
  jwt: string;
  userId: string;
  displayName: string;
  timezone: string;
  baseUrl: string;
}

export interface FeedCacheEntry {
  response: ApiGroupFeedResponse;
  etag: string;
  groupName: string;
}

export interface NormalizedError {
  status: number;
  code: string;
  message: string;
}

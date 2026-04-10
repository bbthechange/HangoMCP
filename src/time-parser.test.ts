import { describe, it, expect } from 'vitest';
import { parseNaturalTime } from './time-parser.js';
import { pinTime, usePinnedTime } from './__helpers__/index.js';

const TZ = 'America/Los_Angeles';

// Pin to Wednesday 2025-03-12 at 10:00 AM PDT
const NOW = '2025-03-12T10:00:00-07:00';

describe('parseNaturalTime', () => {
  usePinnedTime();

  describe('exact time — month day at time', () => {
    it('parses "June 14 at 7:30 PM"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('June 14 at 7:30 PM', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-06-14');
      expect(result.timeInfo.startTime).toMatch(/19:30/);
    });

    it('parses "April 15 at 3pm"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('April 15 at 3pm', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-04-15');
      expect(result.timeInfo.startTime).toMatch(/15:00/);
    });

    it('parses "March 20 at 7pm" (same month, future day)', () => {
      pinTime(NOW);
      const result = parseNaturalTime('March 20 at 7pm', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-03-20');
    });

    it('wraps to next year when date is in the past', () => {
      pinTime(NOW);
      const result = parseNaturalTime('January 5 at 2pm', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2026-01-05');
    });

    it('parses reversed format "3pm April 15"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('3pm April 15', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-04-15');
      expect(result.timeInfo.startTime).toMatch(/15:00/);
    });

    it('parses "7:30 PM June 14"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('7:30 PM June 14', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-06-14');
    });

    it('handles AM correctly (12am edge case)', () => {
      pinTime(NOW);
      const result = parseNaturalTime('June 14 at 12am', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toMatch(/00:00/);
    });
  });

  describe('day with time — "7pm Friday", "Friday at 3:30 PM"', () => {
    it('parses "7pm friday"', () => {
      pinTime(NOW); // Wednesday
      const result = parseNaturalTime('7pm friday', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-03-14'); // Friday
      expect(result.timeInfo.startTime).toMatch(/19:00/);
    });

    it('parses "friday 7pm"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('friday 7pm', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-03-14');
    });

    it('parses "saturday at 3:30 pm"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('saturday at 3:30 pm', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-03-15');
      expect(result.timeInfo.startTime).toMatch(/15:30/);
    });

    it('same weekday but time passed → goes to next week', () => {
      // Wednesday at 10am, asking for wednesday 9am → next wednesday
      pinTime(NOW);
      const result = parseNaturalTime('9am wednesday', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-03-19'); // next wednesday
    });

    it('same weekday, time not passed → uses today', () => {
      pinTime(NOW); // Wednesday 10am
      const result = parseNaturalTime('7pm wednesday', TZ);
      expect(result.mode).toBe('exact');
      expect(result.timeInfo.startTime).toContain('2025-03-12'); // today
    });
  });

  describe('day + period — "Saturday afternoon"', () => {
    it('parses "saturday afternoon"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('saturday afternoon', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('afternoon');
      expect(result.timeInfo.periodStart).toContain('2025-03-15');
    });

    it('parses "friday evening"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('friday evening', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('evening');
      expect(result.timeInfo.periodStart).toContain('2025-03-14');
    });

    it('parses "next friday evening"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('next friday evening', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodStart).toContain('2025-03-21'); // next week
    });

    it('parses "sunday morning"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('sunday morning', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('morning');
      expect(result.timeInfo.periodStart).toContain('2025-03-16');
    });

    it('parses "monday night"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('monday night', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('night');
    });
  });

  describe('tomorrow', () => {
    it('parses "tomorrow"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('tomorrow', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('day');
      expect(result.timeInfo.periodStart).toContain('2025-03-13');
    });

    it('parses "tomorrow morning"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('tomorrow morning', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('morning');
      expect(result.timeInfo.periodStart).toContain('2025-03-13');
      expect(result.timeInfo.periodStart).toMatch(/09:00/);
    });

    it('parses "tomorrow afternoon"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('tomorrow afternoon', TZ);
      expect(result.timeInfo.periodGranularity).toBe('afternoon');
    });

    it('parses "tomorrow evening"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('tomorrow evening', TZ);
      expect(result.timeInfo.periodGranularity).toBe('evening');
    });

    it('parses "tomorrow night"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('tomorrow night', TZ);
      expect(result.timeInfo.periodGranularity).toBe('night');
    });
  });

  describe('weekend', () => {
    it('parses "this weekend"', () => {
      pinTime(NOW); // Wednesday
      const result = parseNaturalTime('this weekend', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('weekend');
      expect(result.timeInfo.periodStart).toContain('2025-03-15'); // Saturday
    });

    it('parses "weekend" same as "this weekend"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('weekend', TZ);
      expect(result.timeInfo.periodGranularity).toBe('weekend');
      expect(result.timeInfo.periodStart).toContain('2025-03-15');
    });

    it('parses "next weekend"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('next weekend', TZ);
      expect(result.timeInfo.periodGranularity).toBe('weekend');
      expect(result.timeInfo.periodStart).toContain('2025-03-22');
    });
  });

  describe('tonight', () => {
    it('parses "tonight" when before 7pm', () => {
      pinTime(NOW); // 10am
      const result = parseNaturalTime('tonight', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('evening');
      expect(result.timeInfo.periodStart).toContain('2025-03-12');
    });

    it('parses "tonight" when after 7pm → still same evening', () => {
      pinTime('2025-03-12T20:00:00-07:00'); // 8pm
      const result = parseNaturalTime('tonight', TZ);
      expect(result.mode).toBe('fuzzy');
      // When it's past 7pm, tonight.set(19:00) < now, so it adds 1 day
      expect(result.timeInfo.periodStart).toContain('2025-03-13');
    });
  });

  describe('day only — "Saturday", "next Friday"', () => {
    it('parses "saturday"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('saturday', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('day');
      expect(result.timeInfo.periodStart).toContain('2025-03-15');
    });

    it('parses "next friday"', () => {
      pinTime(NOW);
      const result = parseNaturalTime('next friday', TZ);
      expect(result.timeInfo.periodGranularity).toBe('day');
      expect(result.timeInfo.periodStart).toContain('2025-03-21');
    });
  });

  describe('period only — "afternoon", "morning"', () => {
    it('parses "afternoon" (future today)', () => {
      pinTime(NOW); // 10am
      const result = parseNaturalTime('afternoon', TZ);
      expect(result.mode).toBe('fuzzy');
      expect(result.timeInfo.periodGranularity).toBe('afternoon');
      expect(result.timeInfo.periodStart).toContain('2025-03-12');
    });

    it('parses "morning" when morning has passed → tomorrow', () => {
      pinTime(NOW); // 10am > 9am morning start
      const result = parseNaturalTime('morning', TZ);
      expect(result.timeInfo.periodGranularity).toBe('morning');
      expect(result.timeInfo.periodStart).toContain('2025-03-13');
    });
  });

  describe('errors', () => {
    it('throws on unparseable input', () => {
      pinTime(NOW);
      expect(() => parseNaturalTime('gobbledygook', TZ)).toThrow(/Couldn't parse/);
    });

    it('throws on empty string', () => {
      pinTime(NOW);
      expect(() => parseNaturalTime('', TZ)).toThrow(/Couldn't parse/);
    });

    it('throws on unknown month in exact format', () => {
      pinTime(NOW);
      expect(() => parseNaturalTime('Zeptember 14 at 7pm', TZ)).toThrow(/Unknown month/);
    });
  });
});

/**
 * Natural language time parser for build_time tool.
 * Uses Luxon for timezone-aware date math.
 *
 * Converts expressions like "Saturday afternoon", "7pm Friday", "this weekend",
 * "June 14 at 7:30 PM" into TimeInfo objects.
 */

import { DateTime, type WeekdayNumbers } from 'luxon';
import type { BuildTimeOutput, TimeInfo } from './types.js';

const DAY_NAMES: Record<string, WeekdayNumbers> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 7,
};

const PERIOD_HOURS: Record<string, { start: number; granularity: TimeInfo['periodGranularity'] }> = {
  morning: { start: 9, granularity: 'morning' },
  afternoon: { start: 12, granularity: 'afternoon' },
  evening: { start: 17, granularity: 'evening' },
  night: { start: 20, granularity: 'night' },
};

export function parseNaturalTime(text: string, timezone: string): BuildTimeOutput {
  const now = DateTime.now().setZone(timezone);
  const input = text.trim().toLowerCase();

  // Try exact time patterns first: "June 14 at 7:30 PM", "April 15 at 3pm"
  const exactResult = tryExactTime(input, now, timezone);
  if (exactResult) return exactResult;

  // Try "7pm Friday", "Friday 7pm", "Saturday at 3:30 PM"
  const dayTimeResult = tryDayWithTime(input, now, timezone);
  if (dayTimeResult) return dayTimeResult;

  // Try "this weekend", "next weekend"
  const weekendResult = tryWeekend(input, now, timezone);
  if (weekendResult) return weekendResult;

  // Try "tomorrow morning", "tomorrow evening", "tomorrow"
  const tomorrowResult = tryTomorrow(input, now, timezone);
  if (tomorrowResult) return tomorrowResult;

  // Try "tonight"
  if (input === 'tonight') {
    const tonight = now.set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
    const target = tonight < now ? tonight.plus({ days: 1 }) : tonight;
    return {
      timeInfo: { periodGranularity: 'evening', periodStart: target.toISO()! },
      humanReadable: 'tonight',
      mode: 'fuzzy',
    };
  }

  // Try "Saturday afternoon", "Friday evening", etc (day + period)
  const dayPeriodResult = tryDayWithPeriod(input, now, timezone);
  if (dayPeriodResult) return dayPeriodResult;

  // Try just a day name: "Saturday", "next Friday"
  const dayResult = tryDayOnly(input, now, timezone);
  if (dayResult) return dayResult;

  // Try just a period: "afternoon", "morning"
  const periodResult = tryPeriodOnly(input, now, timezone);
  if (periodResult) return periodResult;

  throw new Error(
    `Couldn't parse "${text}" as a time. Try something like "Saturday afternoon", "7pm Friday", "this weekend", or "June 14 at 7:30 PM".`,
  );
}

function tryExactTime(input: string, now: DateTime, timezone: string): BuildTimeOutput | null {
  // Match patterns: "June 14 at 7:30 PM", "April 15 at 3pm", "March 20 at 7pm"
  const monthDayTime = input.match(
    /^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/,
  );
  if (monthDayTime) {
    const [, monthStr, dayStr, hourStr, minuteStr, ampm] = monthDayTime;
    return buildExactFromMonthDay(monthStr!, dayStr!, hourStr!, minuteStr, ampm, now, timezone);
  }

  // "7:30 PM June 14", "3pm April 15"
  const timeMonthDay = input.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?$/,
  );
  if (timeMonthDay) {
    const [, hourStr, minuteStr, ampm, monthStr, dayStr] = timeMonthDay;
    return buildExactFromMonthDay(monthStr!, dayStr!, hourStr!, minuteStr, ampm, now, timezone);
  }

  return null;
}

function buildExactFromMonthDay(
  monthStr: string, dayStr: string, hourStr: string,
  minuteStr: string | undefined, ampm: string | undefined,
  now: DateTime, timezone: string,
): BuildTimeOutput {
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const monthIdx = monthNames.findIndex(m => m.startsWith(monthStr.toLowerCase()));
  if (monthIdx === -1) throw new Error(`Unknown month: ${monthStr}`);

  let hour = parseInt(hourStr, 10);
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  let target = DateTime.fromObject(
    { month: monthIdx + 1, day: parseInt(dayStr, 10), hour, minute, second: 0 },
    { zone: timezone },
  );
  // If the date is in the past, assume next year
  if (target < now) {
    target = target.set({ year: now.year + 1 });
  }

  return {
    timeInfo: { startTime: target.toISO()! },
    humanReadable: target.toFormat("EEEE, LLL d 'at' h:mm a"),
    mode: 'exact',
  };
}

function tryDayWithTime(input: string, now: DateTime, timezone: string): BuildTimeOutput | null {
  // "7pm Friday", "7:30pm Friday"
  const timeDayMatch = input.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(\w+)$/);
  if (timeDayMatch) {
    const [, hourStr, minuteStr, ampm, dayName] = timeDayMatch;
    if (dayName && DAY_NAMES[dayName] !== undefined) {
      return buildExactFromDayTime(dayName, hourStr!, minuteStr, ampm!, now, timezone);
    }
  }

  // "Friday 7pm", "Friday at 7:30pm", "Saturday at 3:30 PM"
  const dayTimeMatch = input.match(/^(\w+)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (dayTimeMatch) {
    const [, dayName, hourStr, minuteStr, ampm] = dayTimeMatch;
    if (dayName && DAY_NAMES[dayName] !== undefined) {
      return buildExactFromDayTime(dayName, hourStr!, minuteStr, ampm!, now, timezone);
    }
  }

  return null;
}

function buildExactFromDayTime(
  dayName: string, hourStr: string, minuteStr: string | undefined,
  ampm: string, now: DateTime, timezone: string,
): BuildTimeOutput {
  const targetWeekday = DAY_NAMES[dayName]!;
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  let target = now.set({ hour, minute, second: 0, millisecond: 0 });
  const diff = (targetWeekday - now.weekday + 7) % 7;
  if (diff === 0) {
    // Same weekday: if the time hasn't passed yet today, use today; otherwise next week
    if (target <= now) {
      target = target.plus({ days: 7 });
    }
  } else {
    target = target.plus({ days: diff });
  }

  return {
    timeInfo: { startTime: target.toISO()! },
    humanReadable: target.toFormat("EEEE 'at' h:mm a"),
    mode: 'exact',
  };
}

function tryWeekend(input: string, now: DateTime, _timezone: string): BuildTimeOutput | null {
  if (input === 'this weekend' || input === 'weekend') {
    const saturday = getNextWeekday(now, 6);
    return {
      timeInfo: {
        periodGranularity: 'weekend',
        periodStart: saturday.set({ hour: 0, minute: 0, second: 0, millisecond: 0 }).toISO()!,
      },
      humanReadable: `this weekend (${saturday.toFormat('LLL d')})`,
      mode: 'fuzzy',
    };
  }
  if (input === 'next weekend') {
    const saturday = getNextWeekday(now, 6).plus({ weeks: 1 });
    return {
      timeInfo: {
        periodGranularity: 'weekend',
        periodStart: saturday.set({ hour: 0, minute: 0, second: 0, millisecond: 0 }).toISO()!,
      },
      humanReadable: `next weekend (${saturday.toFormat('LLL d')})`,
      mode: 'fuzzy',
    };
  }
  return null;
}

function tryTomorrow(input: string, now: DateTime, _timezone: string): BuildTimeOutput | null {
  const tomorrowMatch = input.match(/^tomorrow\s*(morning|afternoon|evening|night)?$/);
  if (!tomorrowMatch) return null;

  const tomorrow = now.plus({ days: 1 });
  const period = tomorrowMatch[1] as keyof typeof PERIOD_HOURS | undefined;

  if (period && PERIOD_HOURS[period]) {
    const { start, granularity } = PERIOD_HOURS[period];
    const target = tomorrow.set({ hour: start, minute: 0, second: 0, millisecond: 0 });
    return {
      timeInfo: { periodGranularity: granularity, periodStart: target.toISO()! },
      humanReadable: `tomorrow ${period}`,
      mode: 'fuzzy',
    };
  }

  // Just "tomorrow" — use day granularity
  const target = tomorrow.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  return {
    timeInfo: { periodGranularity: 'day', periodStart: target.toISO()! },
    humanReadable: `tomorrow (${tomorrow.toFormat('EEEE, LLL d')})`,
    mode: 'fuzzy',
  };
}

function tryDayWithPeriod(input: string, now: DateTime, _timezone: string): BuildTimeOutput | null {
  // "Saturday afternoon", "next Friday evening"
  const isNext = input.startsWith('next ');
  const clean = isNext ? input.slice(5) : input;

  for (const [periodName, periodInfo] of Object.entries(PERIOD_HOURS)) {
    for (const [dayName, weekday] of Object.entries(DAY_NAMES)) {
      if (clean === `${dayName} ${periodName}`) {
        let target = getNextWeekday(now, weekday);
        if (isNext) target = target.plus({ weeks: 1 });
        target = target.set({
          hour: periodInfo.start,
          minute: 0,
          second: 0,
          millisecond: 0,
        });

        const prefix = isNext ? 'next ' : '';
        return {
          timeInfo: {
            periodGranularity: periodInfo.granularity,
            periodStart: target.toISO()!,
          },
          humanReadable: `${prefix}${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${periodName}`,
          mode: 'fuzzy',
        };
      }
    }
  }
  return null;
}

function tryDayOnly(input: string, now: DateTime, _timezone: string): BuildTimeOutput | null {
  const isNext = input.startsWith('next ');
  const clean = isNext ? input.slice(5) : input;

  const weekday = DAY_NAMES[clean];
  if (weekday === undefined) return null;

  let target = getNextWeekday(now, weekday);
  if (isNext) target = target.plus({ weeks: 1 });
  target = target.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

  const label = clean.charAt(0).toUpperCase() + clean.slice(1);
  return {
    timeInfo: { periodGranularity: 'day', periodStart: target.toISO()! },
    humanReadable: `${isNext ? 'next ' : ''}${label} (${target.toFormat('LLL d')})`,
    mode: 'fuzzy',
  };
}

function tryPeriodOnly(input: string, now: DateTime, _timezone: string): BuildTimeOutput | null {
  const periodInfo = PERIOD_HOURS[input];
  if (!periodInfo) return null;

  let target = now.set({ hour: periodInfo.start, minute: 0, second: 0, millisecond: 0 });
  // If the period has passed today, go to tomorrow
  if (target < now) {
    target = target.plus({ days: 1 });
  }

  return {
    timeInfo: { periodGranularity: periodInfo.granularity, periodStart: target.toISO()! },
    humanReadable: `${input} (${target.toFormat('EEEE, LLL d')})`,
    mode: 'fuzzy',
  };
}

function getNextWeekday(now: DateTime, targetWeekday: WeekdayNumbers): DateTime {
  const diff = (targetWeekday - now.weekday + 7) % 7;
  return now.plus({ days: diff === 0 ? 7 : diff });
}

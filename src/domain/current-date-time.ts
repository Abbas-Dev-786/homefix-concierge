export const DEFAULT_TIME_ZONE = "UTC";

export type CurrentDateTime = {
  date: string;
  time: string;
  dateTime: string;
  timeZone: string;
  utcOffset: string;
  unixMilliseconds: number;
  source: "system_clock";
};

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((entry) => entry.type === type)?.value ?? "";
}

function normalizeOffset(offset: string) {
  if (offset === "GMT" || offset === "UTC") return "Z";
  const value = offset.replace(/^GMT/, "");
  const sign = value.startsWith("-") ? "-" : "+";
  const digits = value.replace(/^[+-]/, "");
  const [hours = "00", minutes = "00"] = digits.split(":");
  return `${sign}${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

export function getCurrentDateTime(now = new Date(), requestedTimeZone = DEFAULT_TIME_ZONE): CurrentDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: requestedTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const parts = formatter.formatToParts(now);
  const date = `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
  const time = `${part(parts, "hour")}:${part(parts, "minute")}:${part(parts, "second")}`;
  const utcOffset = normalizeOffset(part(parts, "timeZoneName"));

  return {
    date,
    time,
    dateTime: `${date}T${time}${utcOffset}`,
    timeZone: new Intl.DateTimeFormat("en-US", { timeZone: requestedTimeZone }).resolvedOptions().timeZone,
    utcOffset,
    unixMilliseconds: now.getTime(),
    source: "system_clock",
  };
}

const KOREA_TIME_ZONE = "Asia/Seoul";

const KOREAN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: KOREA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatKoreanDateTime(value: string): string {
  const parts = KOREAN_DATE_TIME_FORMATTER.formatToParts(new Date(value));
  const readPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = readPart("hour") === "24" ? "00" : readPart("hour");

  return `${readPart("year")}-${readPart("month")}-${readPart("day")} ${hour}:${readPart("minute")}:${readPart("second")}`;
}

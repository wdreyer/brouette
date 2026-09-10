import { Timestamp } from "firebase/firestore";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function formatDateForInput(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

export function formatDateTimeForInput(value: Date) {
  return `${formatDateForInput(value)}T${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

export function timestampFromDateInput(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  return Timestamp.fromDate(new Date(year, month - 1, day, 12, 0, 0, 0));
}

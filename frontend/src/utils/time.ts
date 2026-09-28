const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "now", "5m", "3h", "2d", or a date for anything older than a week. Empty for a missing timestamp. */
export function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < MIN) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "in 12 days", "tomorrow", "3 days overdue". */
export function timeUntil(iso: string | undefined): { label: string; overdue: boolean } {
  if (!iso) return { label: '', overdue: false };
  const days = Math.round((new Date(iso).getTime() - Date.now()) / DAY);
  if (days < 0) return { label: `${-days}d overdue`, overdue: true };
  if (days === 0) return { label: 'today', overdue: false };
  if (days === 1) return { label: 'tomorrow', overdue: false };
  return { label: `in ${days} days`, overdue: false };
}

export function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

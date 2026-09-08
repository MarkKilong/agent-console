const UNITS: Array<[limit: number, seconds: number, suffix: string]> = [
  [60, 1, 's'],
  [3600, 60, 'm'],
  [86_400, 3600, 'h'],
  [Infinity, 86_400, 'd'],
];

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return 'now';

  const unit = UNITS.find(([limit]) => seconds < limit)!;
  return `${Math.floor(seconds / unit[1])}${unit[2]}`;
}

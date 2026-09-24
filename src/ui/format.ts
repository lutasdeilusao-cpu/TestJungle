export const formatClock = (totalSeconds: number): string => {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const formatEndReason = (reason: 'time_up' | 'defeated'): string => (reason === 'time_up' ? 'Time up' : 'Defeated');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "08 SEP · 19:36" in the viewer's local time. */
export function formatPlayedAt(iso: string): { day: string; time: string; full: string } {
  const d = new Date(iso);
  const day = `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { day, time, full: d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) };
}

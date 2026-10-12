import type { Round } from './model';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const day = (iso: string | Date) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

export const clock = (iso: string | Date) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const clockSec = (iso: string | Date) => {
  const d = new Date(iso);
  return `${clock(d)}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/** A clock time in the contest's own zone: "10:35 PT". */
export function clockIn(iso: string | Date, timeZone: string) {
  const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
  const zone = timeZone === 'America/Los_Angeles' ? 'PT' : timeZone.split('/').pop()!.replace('_', ' ');
  return `${t} ${zone}`;
}

export const stamp = (iso: string | Date) => `${day(iso)} ${clock(iso)}`;

/** 3725000 → "1:02:05", 65000 → "1:05" */
export function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return day(iso);
}

/** When a fixed-time round ends for everyone: opened + length. */
export function roundEnds(round: Round): number | null {
  if (!round.openedAt) return null;
  return new Date(round.openedAt).getTime() + round.minutes * 60000;
}

/** The round's state right now: an open round whose time is up is closed. */
export function roundState(round: Round, now = Date.now()): 'scheduled' | 'open' | 'closed' {
  if (round.status !== 'open') return round.status;
  const ends = roundEnds(round);
  return ends !== null && now > ends + round.graceSeconds * 1000 ? 'closed' : 'open';
}

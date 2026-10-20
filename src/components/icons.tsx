import type { ComponentType, SVGProps } from 'react';
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Award, Bell, CalendarDays, Check, ChevronDown, ChevronRight,
  CircleAlert, CircleCheck, CircleHelp, ClipboardList, Clock, Cloud, Command, Contact, Copy, CornerDownLeft, Download,
  Ellipsis, ExternalLink, Eye, FileSignature, FileText, Flag, Globe, GraduationCap, House, Inbox, Info, KeyRound,
  LayoutGrid, Link2, ListChecks, Lock, LockOpen, LogOut, Mail, MapPin, Megaphone, Menu, MessageCircle, Monitor, PanelLeft,
  Pencil, PenLine, Plus, Presentation, Printer, Radio, RefreshCw, Search, Send, Settings, Sigma, SlidersHorizontal, Ticket,
  Timer, Trash2, TriangleAlert, Trophy, Undo2, Upload, User, UserPlus, Users, Video, X, Zap, ChartColumn, Table,
} from 'lucide-react';

type Lucide = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string; absoluteStrokeWidth?: boolean }>;

/** Two overlapping rings: in person and online together. Lucide has no such mark. */
const Both: Lucide = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...p} width={p.size ?? 24} height={p.size ?? 24}>
    <circle cx="9" cy="12" r="5.5" />
    <circle cx="15" cy="12" r="5.5" />
  </svg>
);
const Dot: Lucide = (p) => (
  <svg viewBox="0 0 24 24" {...p} width={p.size ?? 24} height={p.size ?? 24}>
    <circle cx="12" cy="12" r="3.5" fill="currentColor" />
  </svg>
);

/**
 * One line-icon set (Lucide), always at the same weight as the text beside it.
 * Screens ask for an icon by what it means here ("roster", "grading"), so the
 * drawing can change without touching a screen.
 */
const ICONS = {
  overview: LayoutGrid,
  setup: SlidersHorizontal,
  settings: Settings,
  roster: Users,
  people: Contact,
  waivers: FileSignature,
  rounds: ClipboardList,
  live: Radio,
  grading: PenLine,
  results: ChartColumn,
  reports: Trophy,
  certificate: Award,
  mail: Mail,
  import: Upload,
  pin: MapPin,
  screen: Monitor,
  video: Video,
  clock: Clock,
  timer: Timer,
  board: Presentation,
  arrow: ArrowRight,
  'arrow-up-right': ArrowUpRight,
  back: ArrowLeft,
  check: Check,
  'check-circle': CircleCheck,
  alert: CircleAlert,
  warning: TriangleAlert,
  info: Info,
  help: CircleHelp,
  plus: Plus,
  upload: Upload,
  download: Download,
  file: FileText,
  table: Table,
  calendar: CalendarDays,
  ticket: Ticket,
  pencil: Pencil,
  globe: Globe,
  link: Link2,
  external: ExternalLink,
  switch: ArrowLeftRight,
  chevron: ChevronDown,
  'chevron-right': ChevronRight,
  dot: Dot,
  both: Both,
  search: Search,
  command: Command,
  enter: CornerDownLeft,
  home: House,
  logout: LogOut,
  user: User,
  'user-plus': UserPlus,
  more: Ellipsis,
  close: X,
  trash: Trash2,
  copy: Copy,
  print: Printer,
  send: Send,
  key: KeyRound,
  bell: Bell,
  menu: Menu,
  sidebar: PanelLeft,
  refresh: RefreshCw,
  eye: Eye,
  lock: Lock,
  unlock: LockOpen,
  undo: Undo2,
  inbox: Inbox,
  flag: Flag,
  chat: MessageCircle,
  announce: Megaphone,
  checklist: ListChecks,
  student: GraduationCap,
  sigma: Sigma,
  zap: Zap,
  cloud: Cloud,
} satisfies Record<string, Lucide>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const Svg: Lucide = ICONS[name] ?? Dot;
  return <Svg className={`icon ${className ?? ''}`} size={size} strokeWidth={1.75} aria-hidden="true" />;
}

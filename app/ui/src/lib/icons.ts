/**
 * One registry of the app's icons. Screens and app components name an
 * icon by what it means (`icons.print`, `icons.sign_out`) instead of
 * importing a glyph from lucide-react each time — the same action gets
 * the same shape everywhere, and the set can be swapped in one place.
 * The `components/ui/*` primitives keep their own lucide imports: those
 * are the generic shadcn-style controls, not app vocabulary.
 */
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  Globe,
  History,
  Library,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Send,
  Settings,
  Trash2,
  TriangleAlert,
  Undo2,
  Redo2,
  UserRound,
  Wifi,
  WifiOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export const icons = {
  // Shell
  brand: Printer,
  chevron_down: ChevronDown,
  back: ArrowLeft,
  collapse: ChevronRight,
  templates: Library,
  jobs: History,
  printers: Printer,
  community: Globe,
  settings: Settings,
  // Account
  avatar: UserRound,
  update: Download,
  sync: RefreshCw,
  sign_in: LogIn,
  sign_out: LogOut,
  // Status and result vocabulary (colour is never the only cue)
  online: Wifi,
  offline: WifiOff,
  queued: Clock,
  running: Loader2,
  cancelled: Ban,
  syncing: Loader2,
  published: Globe,
  confirmed: CheckCircle2,
  sent_unconfirmed: Send,
  partially_printed: TriangleAlert,
  failed: XCircle,
  wrong_mode_suspected: CircleHelp,
  // Actions
  more: Ellipsis,
  add: Plus,
  save: Save,
  print: Printer,
  preview: Eye,
  unpublish: EyeOff,
  edit: Pencil,
  publish: Globe,
  delete: Trash2,
  undo: Undo2,
  redo: Redo2,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;
export type { LucideIcon };

/**
 * The app's marks, drawn from Lucide (https://lucide.dev, ISC licence) through
 * `@lucide/icons`, which ships each icon as data on Lucide's 24-unit grid.
 * Every shape is stroke-only, so it takes its colour from `currentColor` and
 * its weight from Icon.svelte.
 *
 * Names are meanings, not pictures: `delete` is the trash can, `close` the X.
 * One meaning, one icon, everywhere. A meaning that wants the same picture as
 * another still gets its own name, so the two can part later without a hunt
 * through every call site.
 */
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUpFromLine,
  BookDashed,
  BookOpen,
  Bot,
  Braces,
  Bug,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheckBig,
  CircleDashedCheck,
  CircleOff,
  CircleQuestionMark,
  CircleSmall,
  Database,
  Delete,
  Download,
  Eye,
  EyeClosed,
  FileExclamationPoint,
  FileText,
  FileUp,
  Flag,
  FlaskConical,
  GitCompareArrows,
  Globe,
  GraduationCap,
  ImageIcon,
  Info,
  Layers,
  Lightbulb,
  LockKeyhole,
  LockKeyholeOpen,
  LogIn,
  Maximize2,
  MessageSquareQuote,
  MonitorCog,
  OctagonAlert,
  Pause,
  Play,
  Plug,
  Plus,
  Pyramid,
  Radar,
  RotateCcw,
  RotateCcwClock,
  RotateCw,
  Save,
  SavePlus,
  ScrollText,
  Search,
  SendHorizontal,
  Settings,
  Shield,
  ShieldAlert,
  Sprout,
  Square,
  SquarePen,
  Terminal,
  Trash,
  TriangleAlert,
  UserRound,
  UserRoundGroup,
  Wrench,
  X,
  type LucideIconData,
  type LucideIconNode,
} from "@lucide/icons";

/** The side of the square every mark is drawn on. */
export const GRID = 24;

export const ICONS = {
  /* ── Leaving: grey, nothing is lost ───────────────────────────────────── */
  close: X,

  /* ── Changing records ─────────────────────────────────────────────────── */
  /** Remove or delete. Arms into `confirm` where the loss is real. */
  delete: Trash,
  /** The armed second click of a destructive action. */
  confirm: Check,
  save: Save,
  /** Saving something that did not exist before. */
  create: SavePlus,
  /** Add a row, or open a form for something new. */
  plus: Plus,
  edit: SquarePen,
  reset: RotateCcw,
  clear: Delete,

  /* ── Lifecycle ────────────────────────────────────────────────────────── */
  approve: CircleDashedCheck,
  /** Reject an entry, deny a tool call, and the "no" of a yes/no column. */
  reject: CircleOff,
  draft: BookDashed,
  archive: Archive,
  deprecate: FileExclamationPoint,
  newVersion: ArrowUpFromLine,
  history: RotateCcwClock,
  /** The affected → fixed version arrow. */
  versionArrow: ArrowRightToLine,

  /* ── Navigation ───────────────────────────────────────────────────────── */
  back: ArrowLeft,
  next: ArrowRight,
  /** A chart taken out of its tile to the whole window. */
  enlarge: Maximize2,
  login: LogIn,
  moveUp: ChevronUp,
  moveDown: ChevronDown,
  /** Expand and collapse: drawn open, turned a quarter to read as shut. */
  chevron: ChevronDown,
  selected: CircleSmall,
  download: Download,

  /* ── Running things ───────────────────────────────────────────────────── */
  run: Play,
  pause: Pause,
  stop: Square,
  test: FlaskConical,

  /* ── Finding things ───────────────────────────────────────────────────── */
  /** Searching what we already hold. */
  search: Search,
  /** Asking a source what it holds. */
  discover: Radar,
  refresh: RotateCw,
  seed: Sprout,
  index: Database,
  /** Anything that hands work to the model. */
  ai: Bot,

  /* ── Chat ─────────────────────────────────────────────────────────────── */
  send: SendHorizontal,
  attach: FileUp,
  image: ImageIcon,
  file: FileText,
  tool: Wrench,

  /* ── Sections: the nav and subnav tabs ────────────────────────────────── */
  chat: Bot,
  library: BookOpen,
  wiki: Globe,
  admin: Shield,
  settings: Settings,
  system: MonitorCog,
  integrations: Plug,
  structure: Layers,
  users: UserRoundGroup,
  workers: Terminal,
  knowledge: GraduationCap,
  refDoc: ScrollText,
  overview: Pyramid,
  gaps: GitCompareArrows,

  /* ── Reach ────────────────────────────────────────────────────────────── */
  user: UserRound,
  team: UserRoundGroup,
  global: Globe,

  /* ── Marks ────────────────────────────────────────────────────────────── */
  alert: TriangleAlert,
  error: OctagonAlert,
  info: Info,
  question: CircleQuestionMark,
  /** Done, all clear, and the "yes" of a yes/no column. */
  success: CircleCheckBig,
  quote: MessageSquareQuote,
  issues: ShieldAlert,
  json: Braces,
  eye: Eye,
  eyeClosed: EyeClosed,
  lockOn: LockKeyhole,
  lockOff: LockKeyholeOpen,

  /* ── Feedback ─────────────────────────────────────────────────────────── */
  flag: Flag,
  bug: Bug,
  /** The idea side of the report toggle, and the tip callout. */
  lightbulb: Lightbulb,
} satisfies Record<string, LucideIconData>;

export type IconName = keyof typeof ICONS;

/** A shape's attributes, minus the `key` Lucide carries for React. */
export const shapes = (name: IconName) =>
  ICONS[name].node.map(([tag, { key: _, ...attrs }]) => [tag, attrs] as const);

/** The inner markup of a mark, for HTML built as a string. */
export const iconMarkup = (name: IconName) =>
  shapes(name)
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([k, v]) => `${k}="${v}"`)
          .join(" ")}/>`,
    )
    .join("");

/** An ellipse as two arcs, starting from its left edge. */
const ellipseD = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;

const rectD = (x: number, y: number, w: number, h: number, r: number) =>
  r
    ? `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${2 * r - w}a${r} ${r} 0 0 1 ${-r} ${-r}v${2 * r - h}a${r} ${r} 0 0 1 ${r} ${-r}z`
    : `M${x} ${y}h${w}v${h}h${-w}z`;

const pointsD = (points: string, closed: boolean) =>
  `M${points
    .trim()
    .split(/[\s,]+/)
    .join(" ")}${closed ? "z" : ""}`;

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
const LEADING_MOVE = new RegExp(
  String.raw`^\s*m\s*(${NUM})[\s,]*(${NUM})[\s,]*`,
);

/**
 * A path's opening `m` is absolute on its own but relative once it follows
 * another subpath, so it is spelled `M`, and the pairs it implies after it,
 * which are relative line-tos, get their `l` said out loud.
 */
const absolute = (d: string) => {
  const m = LEADING_MOVE.exec(d);
  if (!m) return d;
  const rest = d.slice(m[0].length);
  return `M${m[1]} ${m[2]}${rest && !/^[a-zA-Z]/.test(rest) ? "l" : ""}${rest}`;
};

const shapeD = ([tag, a]: LucideIconNode): string => {
  const n = (attr: string) => Number(a[attr] ?? 0);
  switch (tag) {
    case "path":
      return absolute(String(a.d ?? ""));
    case "circle":
      return ellipseD(n("cx"), n("cy"), n("r"), n("r"));
    case "ellipse":
      return ellipseD(n("cx"), n("cy"), n("rx"), n("ry"));
    case "rect":
      return rectD(n("x"), n("y"), n("width"), n("height"), n("rx"));
    case "line":
      return `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`;
    case "polyline":
    case "polygon":
      return pointsD(String(a.points ?? ""), tag === "polygon");
    default:
      return "";
  }
};

/**
 * Shapes as one compound path, which is the only shape a morph can tween.
 * Every other shape is rewritten as arcs and lines; the stroke draws the same
 * either way.
 */
export const outline = (node: LucideIconNode[]) => node.map(shapeD).join("");

const pathCache = new Map<IconName, string>();

export function iconPath(name: IconName): string {
  const hit = pathCache.get(name);
  if (hit) return hit;
  const d = outline(ICONS[name].node);
  pathCache.set(name, d);
  return d;
}

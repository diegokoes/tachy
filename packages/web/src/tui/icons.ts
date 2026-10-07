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
  Asterisk,
  Ban,
  BookDashed,
  BookOpen,
  BookOpenText,
  BookText,
  Bot,
  Braces,
  Bug,
  CalendarClock,
  CalendarCog,
  CalendarSync,
  Car,
  ChartNoAxesGantt,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsLeftRightEllipsis,
  CircleCheckBig,
  CircleDashedCheck,
  CircleOff,
  CircleX,
  CircleQuestionMark,
  CircleSmall,
  ClipboardList,
  Copy,
  Code,
  Crown,
  Database,
  Delete,
  Diamond,
  Download,
  Equal,
  Eye,
  EyeClosed,
  FileCode,
  FileExclamationPoint,
  FileText,
  FileUp,
  Flag,
  Flame,
  Folder,
  FolderGit2,
  FolderOpen,
  FlaskConical,
  FoldVertical,
  Funnel,
  FunnelPlus,
  FunnelX,
  Ghost,
  Gavel,
  Gift,
  GitBranch,
  GitCompareArrows,
  Globe,
  GraduationCap,
  Hand,
  Hourglass,
  Headphones,
  ImageIcon,
  Info,
  Key,
  Keyboard,
  KeyRound,
  Landmark,
  Layers,
  ListOrdered,
  LoaderCircle,
  Lightbulb,
  ListStart,
  ListTodo,
  LockKeyhole,
  LockKeyholeOpen,
  LogIn,
  LogOut,
  Maximize2,
  Megaphone,
  MessageSquare,
  MessageSquareQuote,
  Minus,
  MonitorCog,
  OctagonAlert,
  Orbit,
  Palette,
  Pause,
  Pickaxe,
  PencilSparkles,
  Pin,
  Plane,
  Play,
  Plug,
  Plus,
  Power,
  Pyramid,
  RadioTower,
  RotateCcw,
  RotateCcwClock,
  RotateCw,
  Save,
  SavePlus,
  Scan,
  ScrollText,
  Search,
  SendHorizontal,
  Settings,
  Shield,
  ShieldAlert,
  Signpost,
  Sprout,
  Square,
  SquareCheck,
  SquareDashed,
  SquarePen,
  SquarePlus,
  Star,
  StickyNote,
  Tally1,
  Terminal,
  TrafficCone,
  TimerOff,
  Trash,
  TriangleAlert,
  Trophy,
  UserRound,
  UserRoundGroup,
  Wallpaper,
  Workflow,
  Wrench,
  X,
  Zap,
  type LucideIconData,
  type LucideIconNode,
} from "@lucide/icons";

/** The side of the square every mark is drawn on. */
export const GRID = 24;

/**
 * The Markdown mark, which Lucide does not carry: an M and a down arrow in a
 * rounded frame, drawn on the same grid and strokes so it morphs like the rest.
 */
const MarkdownMark: LucideIconData = {
  name: "markdown",
  size: 24,
  node: [
    ["rect", { x: "2", y: "5", width: "20", height: "14", rx: "2", key: "f" }],
    ["path", { d: "M6 15V9l3 3 3-3v6", key: "m" }],
    ["path", { d: "M17.5 9v6", key: "s" }],
    ["path", { d: "m15 12.5 2.5 2.5 2.5-2.5", key: "a" }],
  ],
};

export const ICONS = {
  // Leaving: grey, nothing is lost
  close: X,

  // Changing records
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
  /** Put a value on the clipboard. */
  copy: Copy,

  // Lifecycle
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

  // Navigation
  back: ArrowLeft,
  next: ArrowRight,
  /** A chart taken out of its tile to the whole window. */
  enlarge: Maximize2,
  login: LogIn,
  logout: LogOut,
  moveUp: ChevronUp,
  moveDown: ChevronDown,
  /** Expand and collapse: drawn open, turned a quarter to read as shut. */
  chevron: ChevronDown,
  selected: CircleSmall,
  download: Download,

  // Running things
  run: Play,
  pause: Pause,
  /** A flow that is switched on; its off state is `pause`. */
  power: Power,
  stop: Square,
  test: FlaskConical,

  // Finding things
  /** Searching what is already held. */
  search: Search,
  /** The text caret, where the app draws its own. */
  caret: Tally1,
  /** Put another filter on a filter row. */
  filterAdd: FunnelPlus,
  /** Drop every filter on the row. */
  filterReset: FunnelX,
  /** A filter that narrowed its list to nothing. */
  noMatch: Ghost,
  /** Asking a source what it holds. */
  discover: RadioTower,
  refresh: RotateCw,
  seed: Sprout,
  index: Database,
  repo: FolderGit2,
  /** A source project: what tickets and repos are filed under. */
  project: ChartNoAxesGantt,
  /** Where a repo comes from: its project, clone URL and scope. */
  source: ChevronsLeftRightEllipsis,
  branch: GitBranch,
  folder: Folder,
  folderOpen: FolderOpen,
  fileTypes: FileCode,
  /** Linking many repos of one project at once. */
  bulk: Orbit,
  /** Anything that hands work to the model. */
  ai: Bot,

  // Chat
  send: SendHorizontal,
  attach: FileUp,
  image: ImageIcon,
  file: FileText,
  tool: Wrench,

  // Sections: the nav and subnav tabs
  chat: Bot,
  library: BookOpen,
  wiki: Globe,
  admin: Shield,
  settings: Settings,
  system: MonitorCog,
  integrations: Plug,
  /** Admin's home for how people's commands behave. */
  flows: Workflow,
  /** What a team tells tachy to look for when it reviews a draft. */
  guidance: Signpost,
  structure: Layers,
  users: UserRoundGroup,
  workers: Terminal,
  /** One execution of a job, queued, running or finished. */
  runs: ListStart,
  /** The processes that take runs off the queues. */
  workerPool: Pickaxe,
  /** What runs and when: a job's kind, schedule and settings. */
  jobs: CalendarCog,
  /** The waiting lines runs join, one per sort of work. */
  queues: ListOrdered,
  /** A job that is switched on; its off state is `pause`. */
  active: Check,
  /** How a run was started: by a schedule, by a person, by something else. */
  startedBySchedule: CalendarSync,
  startedByPerson: UserRound,
  startedByEvent: Zap,
  /** A run's status, where it is not the shared success or error mark. */
  runQueued: Hourglass,
  runRunning: LoaderCircle,
  runFailed: CircleX,
  runCancelled: Ban,
  runTimedOut: TimerOff,
  knowledge: GraduationCap,
  refDoc: ScrollText,
  overview: Pyramid,
  gaps: GitCompareArrows,
  theme: Wallpaper,
  keybinds: Keyboard,
  agent: KeyRound,
  token: KeyRound,

  // Reach
  user: UserRound,
  team: UserRoundGroup,
  global: Globe,

  // Marks
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

  // Feedback
  flag: Flag,
  bug: Bug,
  /** The idea side of the report toggle, and the tip callout. */
  lightbulb: Lightbulb,

  // Work items
  /** Ask tachy to review a draft someone wrote. */
  review: PencilSparkles,
  /** A field written as markdown; morphs into `eye` for its preview. */
  markdown: MarkdownMark,
  /** ADO's stock type glyphs, by the meaning each carries there. */
  wiTask: ClipboardList,
  wiStory: BookText,
  wiEpic: Crown,
  wiFeature: Trophy,
  wiBacklog: ListTodo,
  wiCheck: SquareCheck,
  wiStar: Star,
  wiDiamond: Diamond,
  wiGift: Gift,
  wiGavel: Gavel,
  wiChat: MessageSquare,
  wiFlame: Flame,
  wiCone: TrafficCone,
  wiCar: Car,
  wiPlane: Plane,
  wiKey: Key,
  wiMegaphone: Megaphone,
  wiPalette: Palette,
  wiLandmark: Landmark,
  wiAsterisk: Asterisk,
  wiHeadphones: Headphones,
  wiNote: StickyNote,
  wiCode: Code,
  wiDatabase: Database,
  wiTest: FlaskConical,
  /** A type whose glyph has no counterpart here. */
  wiGeneric: SquareDashed,
  /** Where a field sits on a team's form, from nothing changed to left out. */
  placeAsSource: Equal,
  placePinned: Pin,
  placeFolded: FoldVertical,
  placeOmitted: EyeClosed,

  // Flows
  /** A synced item starting a flow. */
  triggerSynced: Zap,
  triggerManual: Hand,
  triggerSchedule: CalendarClock,
  flowIf: GitBranch,
  flowFilter: Funnel,
  /** The step menu's groups. */
  flowRead: BookOpenText,
  flowSearch: Search,
  flowAgent: Bot,
  flowUpdate: SquarePen,
  flowCreate: SquarePlus,
  zoomIn: Plus,
  zoomOut: Minus,
  fit: Scan,
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

/**
 * The application's icon set.
 *
 * The app previously used FontAwesome class names - `<i className="fas
 * fa-search" />` - across 19 files, 74 call sites, 32 distinct glyphs. The
 * @fortawesome/fontawesome-free stylesheet was never actually loaded, so
 * every one of those rendered as an empty inline element. There was no
 * visible iconography anywhere in the UI.
 *
 * These are the same glyphs, drawn as inline SVG from react-bootstrap-icons
 * (a direct dependency, tree-shakeable, no webfont request, and it inherits
 * `currentColor` so an icon in a muted context is muted automatically).
 *
 * Usage:
 *   import { Icon } from "../components/Icon";
 *   <Icon name="search" />              // default size
 *   <Icon name="search" size={16} />     // px
 *   <Icon name="search" className="…" />
 *
 * Every icon is aria-hidden by default: in all 74 call sites the icon sits
 * next to a text label, so exposing it would only make screen readers repeat
 * themselves. Pass a `title` when an icon is the *only* content of a control.
 */

import {
  ArchiveFill,
  BarChartFill,
  BookFill,
  Boxes,
  CalendarFill,
  CheckCircleFill,
  CheckLg,
  ChevronDoubleLeft,
  ChevronDoubleRight,
  ChevronLeft,
  ChevronRight,
  ClipboardFill,
  ClockFill,
  Diagram2Fill,
  Download,
  ExclamationCircleFill,
  ExclamationTriangleFill,
  EyeFill,
  EyeSlashFill,
  FileEarmarkTextFill,
  FlagFill,
  Folder2Open,
  FolderFill,
  FolderMinus,
  Globe2,
  HourglassBottom,
  Grid3x3GapFill,
  HouseFill,
  InfoCircleFill,
  KeyFill,
  PeopleFill,
  PersonDashFill,
  PersonGear,
  PersonPlusFill,
  PersonStanding,
  PlusCircleFill,
  PlusLg,
  Wifi,
  QuestionCircleFill,
  Search,
  ShieldLockFill,
  StarFill,
  TagFill,
  TerminalFill,
  TrashFill,
  BoxArrowRight,
} from "react-bootstrap-icons";

/** name -> component. The `fa-*` name is kept as a comment so the origin of
 *  each entry stays traceable during review. */
const ICONS = {
  archive: ArchiveFill, // fa-archive
  "hourglass-half": HourglassBottom,
  wifi: Wifi,
  book: BookFill, // fa-book
  check: CheckLg, // fa-check
  "check-circle": CheckCircleFill, // fa-check-circle
  "chevron-left": ChevronLeft, // fa-chevron-left
  "chevron-right": ChevronRight, // fa-chevron-right
  clock: ClockFill, // fa-clock
  copy: ClipboardFill, // fa-copy
  "exclamation-circle": ExclamationCircleFill, // fa-exclamation-circle
  "exclamation-triangle": ExclamationTriangleFill, // fa-exclamation-triangle
  eye: EyeFill, // fa-eye
  "eye-slash": EyeSlashFill, // fa-eye-slash
  flag: FlagFill, // fa-flag
  folder: FolderFill, // fa-folder
  "folder-open": Folder2Open, // fa-folder-open
  "info-circle": InfoCircleFill, // fa-info-circle
  key: KeyFill, // fa-key
  plus: PlusLg, // fa-plus
  "plus-circle": PlusCircleFill, // fa-plus-circle
  "question-circle": QuestionCircleFill, // fa-question-circle
  search: Search, // fa-search
  "shield-alt": ShieldLockFill, // fa-shield-alt
  "sign-out-alt": BoxArrowRight, // fa-sign-out-alt
  star: StarFill, // fa-star
  "th-large": Grid3x3GapFill, // fa-th-large
  "user-cog": PersonGear, // fa-user-cog
  "user-minus": PersonDashFill, // fa-user-minus
  "user-plus": PersonPlusFill, // fa-user-plus
  users: PeopleFill, // fa-users
  "angle-double-left": ChevronDoubleLeft, // fa-angle-double-left
  "angle-double-right": ChevronDoubleRight, // fa-angle-double-right

  // --- MDBIcon <fas icon="..."> names, also never rendered (mdb.css was
  // never imported either) ---
  // react-bootstrap-icons has no scales-of-justice glyph; the closest
  // available metaphor for a licence field.
  "balance-scale": PersonStanding, // fa-balance-scale
  boxes: Boxes, // fa-boxes
  "calendar-alt": CalendarFill, // fa-calendar-alt
  "chart-bar": BarChartFill, // fa-chart-bar
  "code-branch": Diagram2Fill, // fa-code-branch
  download: Download, // fa-download
  globe: Globe2, // fa-globe
  home: HouseFill, // fa-home
  readme: FileEarmarkTextFill, // fa-readme
  tag: TagFill, // fa-tag
  terminal: TerminalFill, // fa-terminal
  "trash-alt": TrashFill, // fa-trash-alt
  "folder-minus": FolderMinus, // fa-folder-minus
};

const SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  "2x": 32,
  "3x": 48,
};

const Icon = ({ name, size = "md", className = "", title, ...rest }) => {
  const Component = ICONS[name];
  if (!Component) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`<Icon>: unknown icon name "${name}"`);
    }
    return null;
  }
  const pixels = SIZES[size] ?? size;
  return (
    <Component
      className={`icon${className ? ` ${className}` : ""}`}
      size={pixels}
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      focusable="false"
      {...rest}
    />
  );
};

export default Icon;
export { ICONS };

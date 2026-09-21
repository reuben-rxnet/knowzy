// @knowzy/shared-ui — the KNOWZY design system.
//
// One visual language for two independently deployable portals. Boundary rule
// B6 restricts this package to importing `@knowzy/shared-types` only, so no
// component here can reach the database, an adapter, or a domain service:
// every one of them renders what the server already decided.
//
// The tokens live in `./tokens.css`, which each app imports; Tailwind v4 reads
// the `@theme` block there and generates the matching utilities, so there is
// one definition of the brand rather than a variable set and a class set that
// can drift apart.
//
// Inventory and usage: docs/ui/shared-component-inventory.md
// Token reference:     docs/ui/design-tokens.md

export const PACKAGE_NAME = '@knowzy/shared-ui' as const;

// ----------------------------------------------------------------- branding
export {
  EssilorLuxotticaLogo,
  KnowzyMark,
  KnowzyWordmark,
  KNOWZY_TAGLINE,
  type BrandMarkProps,
} from './components/Brand.js';

// ------------------------------------------------------------ design assets
export { KnowzyBackdrop, KnowzyIllustration, KnowzyNavIcon } from './components/Asset.js';
export {
  ASSET_BASE,
  BACKDROPS,
  FAVICON,
  ILLUSTRATIONS,
  NAV_ICONS,
  SERVED_ASSETS,
  assetUrl,
  type BackdropName,
  type IllustrationName,
  type NavIconName,
} from './assets/manifest.js';

// -------------------------------------------------------------------- shell
export { AppHeader, type AppHeaderProps } from './components/AppHeader.js';
export {
  BrandLockup,
  SideNav,
  activeNavLabel,
  isActivePath,
  type CapabilityStatus,
  type NavItem,
  type SideNavProps,
} from './components/SideNav.js';
export {
  KNOWZY_WORKFLOW_STAGES,
  PageHero,
  WorkflowRibbon,
  type WorkflowRibbonProps,
  type WorkflowStage,
} from './components/WorkflowRibbon.js';
export { AUTHORING_NAV, AuthoringShell, LEARNER_NAV, LearnerShell } from './components/Shells.js';

// --------------------------------------------------------------- primitives
export {
  Button,
  ButtonLink,
  TextLink,
  buttonClass,
  type ButtonProps,
  type ButtonSize,
  type ButtonTone,
} from './components/Button.js';
export {
  CellNote,
  DataTable,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  type DataTableProps,
} from './components/DataTable.js';
export {
  CheckboxRow,
  Field,
  FieldLabel,
  Fieldset,
  RadioRow,
  Select,
  TextInput,
  Textarea,
} from './components/Field.js';
export { KeyValue, TabNav, type KeyValueItem, type TabItem } from './components/TabNav.js';
export {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  KpiCard,
  type CardProps,
} from './components/Card.js';
export {
  AiBadge,
  Badge,
  BlockedBadge,
  BusyBadge,
  LockedBadge,
  PlannedBadge,
  RoleBadge,
  StatusBadge,
  StatusIndicator,
  VersionBadge,
  statusTone,
  type BadgeProps,
  type BadgeTone,
} from './components/Badge.js';
export {
  ApprovalGateChecklist,
  ProvenanceTimeline,
  type GateResultLike,
  type ProvenanceStep,
} from './components/Governance.js';
export { TraceabilityChain, TraceabilityBar } from './components/Traceability.js';
export type { TraceStage } from './components/Traceability.js';
export { BandScale, Meter, type MeterProps, type MeterTone } from './components/Meter.js';
export { Drawer, Modal, type DrawerProps, type ModalProps } from './components/Overlay.js';

// -------------------------------------------------------------- page states
export {
  EmptyState,
  ErrorState,
  LoadingState,
  NoResultsState,
  PlannedState,
  RefusalState,
  ServiceUnavailableState,
  SkeletonText,
  StaleDataNotice,
} from './components/States.js';

// The two application shells.
//
// Each composes header + navigation + main + footer and owns the landmark
// structure §7 requires: a skip link as the first focusable element, one
// `banner`, one `navigation`, one `main`, one `contentinfo`. A page renders
// inside `main` and never has to think about any of it.
//
// Both are server components. Nothing here holds state, so adopting the shell
// does not turn a route into a client tree.

import type { ReactNode } from 'react';
import { KnowzyNavIcon } from './Asset.js';
import {
  Building2,
  ClipboardCheck,
  FileStack,
  FileUp,
  GaugeCircle,
  Layers,
  ListChecks,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { AppHeader, type AppHeaderProps } from './AppHeader.js';
import { BrandLockup, SideNav, type NavItem } from './SideNav.js';

/**
 * Authoring navigation — §9's ten destinations, in its order.
 *
 * Each status is the one the capability matrix records, so the sidebar cannot
 * claim more than the platform has. `PARTIALLY_IMPLEMENTED` items point at the
 * route that holds the capability today and say so in a note, which is more
 * useful than either hiding them or pretending they have their own page.
 */
export const AUTHORING_NAV: readonly NavItem[] = [
  {
    label: 'Dashboard',
    href: '/',
    icon: <GaugeCircle className="size-5" />,
    status: 'IMPLEMENTED',
  },
  {
    label: 'Knowledge Sources',
    href: '/sources',
    icon: <Building2 className="size-5" />,
    status: 'IMPLEMENTED',
  },
  {
    label: 'AI Quiz Generation',
    href: '/generate',
    icon: <Sparkles className="size-5" />,
    status: 'IMPLEMENTED',
  },
  {
    label: 'Review Queue',
    href: '/review',
    icon: <ListChecks className="size-5" />,
    status: 'IMPLEMENTED',
  },
  {
    label: 'Approvals',
    href: '/review?queue=approval',
    icon: <ClipboardCheck className="size-5" />,
    status: 'PARTIALLY_IMPLEMENTED',
    note: 'In the review queue',
  },
  {
    label: 'Question Bank',
    href: '/publish',
    icon: <FileStack className="size-5" />,
    status: 'PARTIALLY_IMPLEMENTED',
    note: 'On Publish',
  },
  {
    label: 'Import Questions',
    href: '/import',
    icon: <FileUp className="size-5" />,
    status: 'IMPLEMENTED',
    note: 'From a synchronized file',
  },
  {
    label: 'Assessments',
    href: '/publish',
    icon: <Layers className="size-5" />,
    status: 'PARTIALLY_IMPLEMENTED',
    note: 'On Publish',
  },
  {
    label: 'Publish',
    href: '/publish',
    icon: <Upload className="size-5" />,
    status: 'IMPLEMENTED',
  },
  {
    // The last dead entry in this rail, and no longer dead: Phase 10 R1 put
    // five real reports behind it. PARTIALLY_IMPLEMENTED rather than
    // IMPLEMENTED because reporting.md's catalogue declares thirty-five entries
    // and this is five of them -- the note names which five, so the link is not
    // a promise the section cannot keep.
    label: 'Reports',
    href: '/reports',
    icon: <TrendingUp className="size-5" />,
    status: 'PARTIALLY_IMPLEMENTED',
    note: 'Pipeline · Generation · Assessments · Filing · Sources',
  },
  {
    // PARTIALLY_IMPLEMENTED as of 2026-09-24: AI Usage & Budgets is real and
    // the rest of the governance surface -- the revalidation queue, the audit
    // explorer, reconciliation -- is not. The note names the part that works,
    // so the link is not a promise the screen cannot keep.
    label: 'Governance',
    href: '/governance/ai-usage',
    icon: <ShieldCheck className="size-5" />,
    status: 'PARTIALLY_IMPLEMENTED',
    note: 'AI Usage & Budgets',
  },
  {
    // PARTIALLY_IMPLEMENTED, not IMPLEMENTED: taxonomy administration and AI
    // provider administration are real, and the rest of
    // authoring-portal.md §11 -- profiles, thresholds, field mappings, badge
    // definitions -- is not. The note says which parts work, so the link is
    // not a promise the section cannot keep.
    label: 'Administration',
    href: '/administration/taxonomy',
    icon: <Settings className="size-5" />,
    status: 'PARTIALLY_IMPLEMENTED',
    note: 'Domains · AI Providers',
  },
] as const;

/**
 * Learner navigation — learner §5.2's eight destinations, in its order.
 *
 * Home is real. Assessments is partial: the eligible-assessment list lives on
 * Home until UI-M9 gives it its own route, and the note says exactly that. The
 * remaining six need the catalog, recognition, progress, and help capabilities
 * that LIVE-FULL-M1 onward build — none of them is a link, so none is a dead
 * end.
 */
/*
 * The icons here are the APPROVED pack's, not Lucide's: the pack covers
 * exactly these eight learner destinations, so every one is the approved
 * artwork. AUTHORING_NAV above keeps Lucide, because the pack contains no
 * icon for a knowledge source, a generation job, a review queue, an approval,
 * a question bank, publication, reports, governance or administration — and
 * drawing one would be inventing an asset.
 *
 * That split is deliberate and documented rather than a half-finished
 * migration (integration spec §2: do not replace the icon system globally
 * without a reason).
 */
export const LEARNER_NAV: readonly NavItem[] = [
  { label: 'Home', href: '/', icon: <KnowzyNavIcon name="home" />, status: 'IMPLEMENTED' },
  {
    label: 'My Learnings',
    icon: <KnowzyNavIcon name="myLearnings" />,
    status: 'REQUIRES_BACKEND_EXTENSION',
  },
  {
    label: 'Assessments',
    href: '/',
    icon: <KnowzyNavIcon name="assessments" />,
    status: 'PARTIALLY_IMPLEMENTED',
    note: 'On Home in this release',
  },
  {
    label: 'Discover',
    icon: <KnowzyNavIcon name="discover" />,
    status: 'REQUIRES_BACKEND_EXTENSION',
  },
  { label: 'Badges', icon: <KnowzyNavIcon name="badges" />, status: 'PLANNED' },
  {
    label: 'Knowledge Library',
    icon: <KnowzyNavIcon name="library" />,
    status: 'REQUIRES_BACKEND_EXTENSION',
  },
  {
    // The destination is planned — LIVE-UI-M2 adds it. The capability matrix
    // calls the underlying data partially implemented, and the note says where
    // a learner can see it today, but an unreachable item must not be styled
    // as a link.
    label: 'My Progress',
    icon: <KnowzyNavIcon name="progress" />,
    status: 'PLANNED',
    note: 'Per result, on your results page',
  },
  {
    label: 'Help & Support',
    icon: <KnowzyNavIcon name="help" />,
    status: 'REQUIRES_BACKEND_EXTENSION',
  },
] as const;

interface ShellProps {
  readonly children: ReactNode;
  readonly currentPath: string;
  readonly header: Omit<AppHeaderProps, 'searchPlaceholder'>;
  /** Environment name and any local-only disclosure, rendered in the footer. */
  readonly footerNote: ReactNode;
  /** Optional ribbon, only on workflow pages (§11). */
  readonly ribbon?: ReactNode;
  readonly nav?: readonly NavItem[];
}

export const AuthoringShell = ({
  children,
  currentPath,
  header,
  footerNote,
  ribbon,
  nav = AUTHORING_NAV,
}: ShellProps) => (
  <div className="flex min-h-screen flex-col bg-brand-canvas">
    <a className="knowzy-skip-link" href="#main">
      Skip to content
    </a>
    <AppHeader
      {...header}
      // The placeholder describes only what search would cover if it existed
      // (§8.1); it is disabled, and labelled Planned inside the header.
      searchPlaceholder="Search knowledge, questions, documents..."
    />
    <div className="flex min-h-0 flex-1">
      {/* §30: persistent at desktop widths, hidden below — the routes remain
          reachable, and a narrow-viewport drawer arrives with UI-M2. */}
      <div className="sticky top-header hidden h-[calc(100vh-var(--spacing-header))] lg:block">
        <SideNav
          items={nav}
          currentPath={currentPath}
          ariaLabel="Authoring sections"
          footer={<BrandLockup />}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {ribbon}
        <main id="main" role="main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto flex max-w-[110rem] flex-col gap-5">{children}</div>
        </main>
        <ShellFooter>{footerNote}</ShellFooter>
      </div>
    </div>
  </div>
);

export const LearnerShell = ({
  children,
  currentPath,
  header,
  footerNote,
  nav = LEARNER_NAV,
}: ShellProps) => (
  <div className="flex min-h-screen flex-col bg-brand-canvas">
    <a className="knowzy-skip-link" href="#main">
      Skip to content
    </a>
    <AppHeader
      {...header}
      // Learner §5.3: the placeholder must reflect implemented scope. Until a
      // catalog exists, it claims assessments and topics only.
      searchPlaceholder="Search assessments and topics..."
    />
    <div className="flex min-h-0 flex-1">
      <div className="sticky top-header hidden h-[calc(100vh-var(--spacing-header))] lg:block">
        <SideNav
          items={nav}
          currentPath={currentPath}
          ariaLabel="Learning sections"
          // Learner §4: lower information density than authoring.
          density="comfortable"
          footer={<BrandLockup />}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" role="main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          {/* Narrower than authoring: learner pages are for reading, not for
              dense operational tables. */}
          <div className="mx-auto flex max-w-[96rem] flex-col gap-5">{children}</div>
        </main>
        <ShellFooter>{footerNote}</ShellFooter>
      </div>
    </div>
  </div>
);

const ShellFooter = ({ children }: { readonly children: ReactNode }) => (
  <footer
    role="contentinfo"
    className="border-t border-line bg-brand-surface px-4 py-3 text-xs text-ink-subtle sm:px-6"
  >
    {children}
  </footer>
);

// Administration → Competencies (COMPETENCY-M2).
//
// Specification: docs/competencies/COMPETENCY_ADMINISTRATION.md. The screen
// maintains the REFERENCE catalogue and nothing else: it shows no person, no
// rating, no score, and the boundary card at the top says so in those words.
//
// Six views behind one tab strip (`?view=`), because the catalogue, its
// versions and the role requirements are edited with different rules and one
// long page would hide which rule applies where.
//
// Write controls are offered only when the API says the viewer holds
// competency.manage, and an Approve button the server would refuse is drawn
// DISABLED WITH ITS REASON -- "you edited this", "out of date", "no approved
// version" -- so separation of duties is visible before the click. The server
// decides again on every write.

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  KpiCard,
  PageHero,
  Select,
  StatusBadge,
  TabNav,
  TBody,
  THead,
  Td,
  Th,
  Tr,
} from '@knowzy/shared-ui';
import { BadgeCheck, Layers, ListTree, ShieldCheck, Tags } from 'lucide-react';
import { t, type CopyKey } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import { currentSubject } from '../../../lib/identity';
import { ADMINISTRATION_TABS } from '../tabs';
import {
  ApproveRequirementButton,
  ApproveVersionButton,
  EditAliasButton,
  EditCategoryButton,
  EditCompetencyButton,
  EditRequirementButton,
  NewAliasButton,
  NewCategoryButton,
  NewCompetencyButton,
  NewVersionButton,
  ProposeRequirementButton,
  RetireRequirementButton,
  StatusButton,
} from '../../../components/CompetencyForms';

type DefinitionStatus = 'ACTIVE' | 'RETIRED';

interface Person {
  readonly userId: string;
  readonly displayName: string;
}

interface Framework {
  readonly frameworkId: string;
  readonly code: string;
  readonly name: string;
  readonly hasApprovedVersion: boolean;
  readonly versions: readonly {
    readonly versionId: string;
    readonly versionLabel: string;
    readonly origin: 'IMPORT' | 'ADMINISTRATION';
    readonly status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
    readonly stale: boolean;
    readonly createdAt: string;
    readonly createdBy: string | null;
    readonly editors: readonly Person[];
    readonly approvedAt: string | null;
    readonly approvedBy: string | null;
    readonly approvalReference: string | null;
    readonly effectiveFrom: string | null;
  }[];
  readonly scales: readonly {
    readonly scaleId: string;
    readonly code: string;
    readonly name: string;
  }[];
  readonly categories: readonly {
    readonly categoryId: string;
    readonly code: string;
    readonly name: string;
    readonly kind: string;
    readonly status: DefinitionStatus;
    readonly competencyCount: number;
  }[];
  readonly competencies: readonly {
    readonly competencyId: string;
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
    readonly status: DefinitionStatus;
    readonly categoryId: string;
    readonly categoryCode: string;
    readonly kind: string;
    readonly scaleCode: string;
    readonly aliasCount: number;
    readonly targetCount: number;
  }[];
  readonly aliases: readonly {
    readonly aliasId: string;
    readonly subject: 'CATEGORY' | 'COMPETENCY';
    readonly alias: string;
    readonly targetCode: string;
    readonly targetName: string;
    readonly decision: string;
    readonly note: string | null;
    readonly status: DefinitionStatus;
  }[];
  readonly domains: readonly {
    readonly kind: string;
    readonly categoryCount: number;
    readonly competencyCount: number;
    readonly activeCompetencyCount: number;
  }[];
  readonly recentChanges: readonly {
    readonly subject: string;
    readonly action: string;
    readonly changedFields: readonly string[];
    readonly label: string;
    readonly actor: string;
    readonly at: string;
  }[];
}

interface Catalogue {
  readonly frameworks: readonly Framework[];
  readonly canManage: boolean;
  readonly viewerUserId: string;
}

interface Requirements {
  readonly targets: readonly {
    readonly targetId: string;
    readonly status: 'PROPOSED' | 'APPROVED' | 'RETIRED';
    readonly jobRole: { readonly code: string; readonly name: string };
    readonly competency: { readonly id: string; readonly code: string; readonly name: string };
    readonly targetLevel: { readonly id: string; readonly code: string; readonly label: string };
    readonly source: string;
    readonly rationale: string | null;
    readonly effectiveFrom: string | null;
    readonly proposedBy: string | null;
    readonly editors: readonly Person[];
    readonly approvedBy: string | null;
    readonly approvedAt: string | null;
    readonly approvalReference: string | null;
    readonly frameworkVersionLabel: string | null;
    readonly retiredAt: string | null;
    readonly retiredBy: string | null;
  }[];
  readonly roles: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly competencies: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly frameworkCode: string;
    readonly levels: readonly {
      readonly id: string;
      readonly code: string;
      readonly label: string;
    }[];
  }[];
  readonly frameworks: readonly {
    readonly code: string;
    readonly approvedVersionLabel: string | null;
  }[];
  readonly canManage: boolean;
  readonly viewerUserId: string;
}

const VIEWS = [
  'overview',
  'categories',
  'competencies',
  'aliases',
  'versions',
  'requirements',
] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Readonly<Record<View, CopyKey>> = {
  overview: 'comp.viewOverview',
  categories: 'comp.viewCategories',
  competencies: 'comp.viewCompetencies',
  aliases: 'comp.viewAliases',
  versions: 'comp.viewVersions',
  requirements: 'comp.viewRequirements',
};
const isView = (value: unknown): value is View =>
  typeof value === 'string' && (VIEWS as readonly string[]).includes(value);

const domainLabel = (kind: string): string => t(`comp.domain.${kind}` as CopyKey);
const when = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

const DefinitionStatusBadge = ({ status }: { readonly status: DefinitionStatus }) => (
  <StatusBadge
    status={t(`comp.status.${status}` as CopyKey)}
    tone={status === 'ACTIVE' ? 'success' : 'neutral'}
  />
);

export const dynamic = 'force-dynamic';

export default async function CompetencyAdministrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view: View = isView(params['view']) ? params['view'] : 'overview';
  const subject = await currentSubject();
  const adminTabs = (
    <TabNav
      items={ADMINISTRATION_TABS.map((tab) => ({ href: tab.href, label: t(tab.labelKey) }))}
      activeHref="/administration/competencies"
      ariaLabel={t('prov.tabsLabel')}
    />
  );

  const catalogue = await api<Catalogue>('/api/v1/authoring/competencies/catalogue');
  if (!catalogue.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('comp.heading')} purpose={t('comp.intro')} />
        {adminTabs}
        <Problem problem={catalogue.problem} actingAs={subject.label} />
      </div>
    );
  }

  const { frameworks, canManage, viewerUserId } = catalogue.data;
  const requestedCode = typeof params['framework'] === 'string' ? params['framework'] : '';
  const framework = frameworks.find((row) => row.code === requestedCode) ?? frameworks[0];

  const boundary = (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-ink">{t('comp.boundaryTitle')}</span>
            <span className="max-w-prose text-sm text-ink-muted">{t('comp.boundaryBody')}</span>
            {canManage ? null : (
              <span className="text-sm text-ink-muted">{t('comp.readOnly')}</span>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );

  if (framework === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('comp.heading')} purpose={t('comp.intro')} />
        {adminTabs}
        {boundary}
        <EmptyState title={t('comp.noFramework')} description={t('comp.noFrameworkNote')} />
      </div>
    );
  }

  const base = `/administration/competencies?framework=${encodeURIComponent(framework.code)}`;
  const approved = framework.versions.find((row) => row.status === 'APPROVED');
  const activeCompetencies = framework.competencies.filter((row) => row.status === 'ACTIVE');
  const activeCategories = framework.categories.filter((row) => row.status === 'ACTIVE');

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('comp.heading')} purpose={t('comp.intro')} />
      {adminTabs}
      {boundary}

      {frameworks.length > 1 ? (
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value={view} />
          <Field id="comp-framework" label={t('comp.frameworkLabel')}>
            <Select id="comp-framework" name="framework" defaultValue={framework.code}>
              {frameworks.map((row) => (
                <option key={row.frameworkId} value={row.code}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button tone="secondary" size="sm">
            {t('comp.frameworkShow')}
          </Button>
        </form>
      ) : (
        <p className="text-base text-ink">
          <span className="font-semibold">{t('comp.frameworkLabel')}:</span> {framework.name}{' '}
          <span className="font-mono text-2xs text-ink-muted">{framework.code}</span>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label={t('comp.kpiDomains')}
          value={String(framework.domains.filter((row) => row.categoryCount > 0).length)}
          icon={<Layers aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('comp.kpiCategories')}
          value={String(framework.categories.length)}
          icon={<ListTree aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('comp.kpiCompetencies')}
          value={String(framework.competencies.length)}
          caption={t('comp.kpiCompetenciesCaption', { active: activeCompetencies.length })}
          icon={<BadgeCheck aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('comp.kpiAliases')}
          value={String(framework.aliases.length)}
          icon={<Tags aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('comp.kpiVersion')}
          value={approved?.versionLabel ?? t('comp.kpiVersionNone')}
          {...(approved === undefined ? { caption: t('comp.kpiVersionNoneCaption') } : {})}
          icon={<ShieldCheck aria-hidden="true" className="size-5" />}
        />
      </div>

      <TabNav
        items={VIEWS.map((name) => ({ href: `${base}&view=${name}`, label: t(VIEW_LABEL[name]) }))}
        activeHref={`${base}&view=${view}`}
        ariaLabel={t('comp.viewsLabel')}
      />

      {view === 'overview' ? (
        <>
          <Card>
            <CardHeader title={t('comp.domainsHeading')} description={t('comp.domainsNote')} />
            <CardBody>
              <DataTable caption={t('comp.domainsHeading')} captionHidden>
                <THead>
                  <Tr>
                    <Th scope="col">{t('comp.colDomain')}</Th>
                    <Th scope="col">{t('comp.colMeaning')}</Th>
                    <Th scope="col" align="end">
                      {t('comp.colCategories')}
                    </Th>
                    <Th scope="col" align="end">
                      {t('comp.colCompetencies')}
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {framework.domains.map((domain) => (
                    <Tr key={domain.kind}>
                      <Th scope="row">{domainLabel(domain.kind)}</Th>
                      <Td>
                        <span className="text-sm text-ink-muted">
                          {t(`comp.domainNote.${domain.kind}` as CopyKey)}
                        </span>
                      </Td>
                      <Td numeric>{domain.categoryCount}</Td>
                      <Td numeric>
                        {domain.activeCompetencyCount} / {domain.competencyCount}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('comp.changesHeading')} description={t('comp.changesNote')} />
            <CardBody>
              {framework.recentChanges.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('comp.noChanges')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {framework.recentChanges.map((change, index) => (
                    <li key={`${change.at}-${index}`} className="flex flex-col text-sm">
                      <span className="text-ink">
                        {t('comp.changeLine', {
                          actor: change.actor,
                          action: t(`comp.action.${change.action}` as CopyKey),
                          subject: t(`comp.subject.${change.subject}` as CopyKey),
                          label: change.label,
                        })}
                      </span>
                      <span className="text-2xs text-ink-muted">
                        {when(change.at)}
                        {change.changedFields.length === 0
                          ? ''
                          : ` · ${t('comp.changedFields', { fields: change.changedFields.join(', ') })}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}

      {view === 'categories' ? (
        <Card>
          <CardHeader
            title={t('comp.viewCategories')}
            description={t('comp.categoriesNote')}
            {...(canManage
              ? {
                  actions: (
                    <NewCategoryButton
                      frameworkId={framework.frameworkId}
                      actingAs={subject.label}
                    />
                  ),
                }
              : {})}
          />
          <CardBody>
            <DataTable caption={t('comp.viewCategories')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('comp.colCode')}</Th>
                  <Th scope="col">{t('comp.colName')}</Th>
                  <Th scope="col">{t('comp.colDomain')}</Th>
                  <Th scope="col">{t('comp.colStatus')}</Th>
                  <Th scope="col" align="end">
                    {t('comp.colCompetencies')}
                  </Th>
                  {canManage ? <Th scope="col">{t('comp.colActions')}</Th> : null}
                </Tr>
              </THead>
              <TBody>
                {framework.categories.map((row) => (
                  <Tr key={row.categoryId}>
                    <Th scope="row">
                      <span className="font-mono text-sm">{row.code}</span>
                    </Th>
                    <Td>{row.name}</Td>
                    <Td>{domainLabel(row.kind)}</Td>
                    <Td>
                      <DefinitionStatusBadge status={row.status} />
                    </Td>
                    <Td numeric>{row.competencyCount}</Td>
                    {canManage ? (
                      <Td>
                        <span className="flex flex-wrap items-start gap-2">
                          <EditCategoryButton category={row} actingAs={subject.label} />
                          <StatusButton
                            op="setCategoryStatus"
                            id={row.categoryId}
                            status={row.status}
                            actingAs={subject.label}
                          />
                        </span>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          </CardBody>
        </Card>
      ) : null}

      {view === 'competencies'
        ? (() => {
            const categoryFilter = typeof params['category'] === 'string' ? params['category'] : '';
            const rows = framework.competencies.filter(
              (row) => categoryFilter === '' || row.categoryCode === categoryFilter,
            );
            return (
              <Card>
                <CardHeader
                  title={t('comp.viewCompetencies')}
                  description={t('comp.competenciesNote')}
                  {...(canManage
                    ? {
                        actions: (
                          <NewCompetencyButton
                            categories={activeCategories}
                            scales={framework.scales}
                            {...(categoryFilter === ''
                              ? {}
                              : {
                                  defaultCategoryId: framework.categories.find(
                                    (row) => row.code === categoryFilter,
                                  )?.categoryId,
                                })}
                            actingAs={subject.label}
                          />
                        ),
                      }
                    : {})}
                />
                <CardBody>
                  <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="framework" value={framework.code} />
                    <input type="hidden" name="view" value="competencies" />
                    <Field id="comp-category-filter" label={t('comp.filterCategory')}>
                      <Select
                        id="comp-category-filter"
                        name="category"
                        defaultValue={categoryFilter}
                      >
                        <option value="">{t('comp.filterAll')}</option>
                        {framework.categories.map((row) => (
                          <option key={row.categoryId} value={row.code}>
                            {row.code} — {row.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button tone="secondary" size="sm">
                      {t('comp.frameworkShow')}
                    </Button>
                  </form>
                  {rows.length === 0 ? (
                    <p className="text-sm text-ink-muted">{t('comp.noRows')}</p>
                  ) : (
                    <DataTable caption={t('comp.viewCompetencies')} captionHidden>
                      <THead>
                        <Tr>
                          <Th scope="col">{t('comp.colCode')}</Th>
                          <Th scope="col">{t('comp.colName')}</Th>
                          <Th scope="col">{t('comp.colDomain')}</Th>
                          <Th scope="col">{t('comp.colScale')}</Th>
                          <Th scope="col">{t('comp.colStatus')}</Th>
                          <Th scope="col" align="end">
                            {t('comp.colAliases')}
                          </Th>
                          <Th scope="col" align="end">
                            {t('comp.colTargets')}
                          </Th>
                          {canManage ? <Th scope="col">{t('comp.colActions')}</Th> : null}
                        </Tr>
                      </THead>
                      <TBody>
                        {rows.map((row) => (
                          <Tr key={row.competencyId}>
                            <Th scope="row">
                              <span className="font-mono text-sm">{row.code}</span>
                            </Th>
                            <Td>
                              <span className="flex flex-col gap-0.5">
                                <span>{row.name}</span>
                                {row.description === null ? null : (
                                  <span className="text-2xs text-ink-muted">{row.description}</span>
                                )}
                              </span>
                            </Td>
                            <Td>{domainLabel(row.kind)}</Td>
                            <Td>
                              <span className="font-mono text-2xs">{row.scaleCode}</span>
                            </Td>
                            <Td>
                              <DefinitionStatusBadge status={row.status} />
                            </Td>
                            <Td numeric>{row.aliasCount}</Td>
                            <Td numeric>{row.targetCount}</Td>
                            {canManage ? (
                              <Td>
                                <span className="flex flex-wrap items-start gap-2">
                                  <EditCompetencyButton competency={row} actingAs={subject.label} />
                                  <StatusButton
                                    op="setCompetencyStatus"
                                    id={row.competencyId}
                                    status={row.status}
                                    actingAs={subject.label}
                                  />
                                </span>
                              </Td>
                            ) : null}
                          </Tr>
                        ))}
                      </TBody>
                    </DataTable>
                  )}
                </CardBody>
              </Card>
            );
          })()
        : null}

      {view === 'aliases' ? (
        <Card>
          <CardHeader
            title={t('comp.viewAliases')}
            description={t('comp.aliasesNote')}
            {...(canManage
              ? {
                  actions: (
                    <NewAliasButton
                      categories={activeCategories}
                      competencies={activeCompetencies}
                      actingAs={subject.label}
                    />
                  ),
                }
              : {})}
          />
          <CardBody>
            <DataTable caption={t('comp.viewAliases')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('comp.fieldAlias')}</Th>
                  <Th scope="col">{t('comp.fieldAliasFor')}</Th>
                  <Th scope="col">{t('comp.fieldDecision')}</Th>
                  <Th scope="col">{t('comp.colStatus')}</Th>
                  {canManage ? <Th scope="col">{t('comp.colActions')}</Th> : null}
                </Tr>
              </THead>
              <TBody>
                {framework.aliases.map((row) => (
                  <Tr key={row.aliasId}>
                    <Th scope="row">
                      <span className="flex flex-col gap-0.5">
                        <span>{row.alias}</span>
                        {row.note === null ? null : (
                          <span className="text-2xs text-ink-muted">{row.note}</span>
                        )}
                      </span>
                    </Th>
                    <Td>
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-sm">{row.targetCode}</span>
                        <span className="text-2xs text-ink-muted">
                          {row.subject === 'CATEGORY'
                            ? t('comp.subjectCategory')
                            : t('comp.subjectCompetency')}{' '}
                          · {row.targetName}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <Badge
                        tone={row.decision === 'PROVISIONAL' ? 'warning' : 'neutral'}
                        withIcon={false}
                      >
                        {t(`comp.decision.${row.decision}` as CopyKey)}
                      </Badge>
                    </Td>
                    <Td>
                      <DefinitionStatusBadge status={row.status} />
                    </Td>
                    {canManage ? (
                      <Td>
                        <span className="flex flex-wrap items-start gap-2">
                          <EditAliasButton alias={row} actingAs={subject.label} />
                          <StatusButton
                            op="setAliasStatus"
                            id={row.aliasId}
                            status={row.status}
                            actingAs={subject.label}
                          />
                        </span>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          </CardBody>
        </Card>
      ) : null}

      {view === 'versions' ? (
        <Card>
          <CardHeader
            title={t('comp.viewVersions')}
            description={t('comp.versionsNote')}
            {...(canManage
              ? {
                  actions: (
                    <NewVersionButton
                      frameworkId={framework.frameworkId}
                      actingAs={subject.label}
                    />
                  ),
                }
              : {})}
          />
          <CardBody>
            <DataTable caption={t('comp.viewVersions')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('comp.colVersion')}</Th>
                  <Th scope="col">{t('comp.colStatus')}</Th>
                  <Th scope="col">{t('comp.colEditors')}</Th>
                  <Th scope="col">{t('comp.colApproval')}</Th>
                  {canManage ? <Th scope="col">{t('comp.colActions')}</Th> : null}
                </Tr>
              </THead>
              <TBody>
                {framework.versions.map((row) => {
                  const viewerEdited = row.editors.some((editor) => editor.userId === viewerUserId);
                  const blocked =
                    row.status !== 'DRAFT'
                      ? t('comp.versionApproveBlocked')
                      : row.stale
                        ? t('comp.staleReason')
                        : viewerEdited
                          ? t('comp.youEdited')
                          : null;
                  return (
                    <Tr key={row.versionId}>
                      <Th scope="row">
                        <span className="flex flex-col gap-0.5">
                          <span className="font-semibold">{row.versionLabel}</span>
                          <span className="text-2xs text-ink-muted">
                            {t(`comp.origin.${row.origin}` as CopyKey)} · {when(row.createdAt)}
                          </span>
                        </span>
                      </Th>
                      <Td>
                        <span className="flex flex-col items-start gap-1">
                          <StatusBadge
                            status={t(`comp.versionStatus.${row.status}` as CopyKey)}
                            tone={
                              row.status === 'APPROVED'
                                ? 'success'
                                : row.status === 'DRAFT'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          />
                          {row.stale ? (
                            <span className="flex flex-col gap-0.5">
                              <Badge tone="danger" withIcon={false}>
                                {t('comp.stale')}
                              </Badge>
                              <span className="max-w-56 text-2xs text-ink-muted">
                                {t('comp.staleReason')}
                              </span>
                            </span>
                          ) : null}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-sm">
                          {row.editors.length === 0
                            ? t('comp.noEditorsImport')
                            : row.editors.map((editor) => editor.displayName).join(', ')}
                        </span>
                      </Td>
                      <Td>
                        {row.approvedBy === null || row.approvedAt === null ? (
                          <span className="text-sm text-ink-muted">{t('comp.notApproved')}</span>
                        ) : (
                          <span className="flex flex-col gap-0.5 text-sm">
                            <span>
                              {t('comp.approvedBy', {
                                name: row.approvedBy,
                                at: when(row.approvedAt),
                              })}
                            </span>
                            <span className="text-2xs text-ink-muted">
                              {t('comp.approvalRef', { reference: row.approvalReference ?? '' })}
                            </span>
                            {row.effectiveFrom === null ? null : (
                              <span className="text-2xs text-ink-muted">
                                {t('comp.effective', { date: row.effectiveFrom })}
                              </span>
                            )}
                          </span>
                        )}
                      </Td>
                      {canManage ? (
                        <Td>
                          {row.status === 'DRAFT' ? (
                            <ApproveVersionButton
                              versionId={row.versionId}
                              versionLabel={row.versionLabel}
                              blockedReason={blocked}
                              actingAs={subject.label}
                            />
                          ) : null}
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </TBody>
            </DataTable>
          </CardBody>
        </Card>
      ) : null}

      {view === 'requirements' ? (
        <RequirementsView frameworkCode={framework.code} actingAs={subject.label} />
      ) : null}
    </div>
  );
}

/** Role → Competency Requirements. Its own read, because it spans every framework's roles. */
const RequirementsView = async ({
  frameworkCode,
  actingAs,
}: {
  readonly frameworkCode: string;
  readonly actingAs: string;
}) => {
  const result = await api<Requirements>('/api/v1/authoring/competencies/role-targets');
  if (!result.ok) return <Problem problem={result.problem} actingAs={actingAs} />;
  const { targets, roles, competencies, frameworks, canManage, viewerUserId } = result.data;
  const approvedLabel =
    frameworks.find((row) => row.code === frameworkCode)?.approvedVersionLabel ?? null;
  const options = competencies.filter((row) => row.frameworkCode === frameworkCode);
  const levelsOf = (competencyId: string) =>
    competencies.find((row) => row.id === competencyId)?.levels ?? [];

  return (
    <Card>
      <CardHeader
        title={t('comp.viewRequirements')}
        description={t('comp.requirementsNote')}
        {...(canManage && roles.length > 0
          ? {
              actions: (
                <ProposeRequirementButton
                  roles={roles}
                  competencies={options}
                  actingAs={actingAs}
                />
              ),
            }
          : {})}
      />
      <CardBody>
        <div
          role="status"
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            approvedLabel === null ? 'bg-warning-soft text-ink' : 'bg-success-soft text-ink'
          }`}
        >
          {approvedLabel === null
            ? t('comp.requirementsBlocked')
            : t('comp.requirementsReady', { version: approvedLabel })}
        </div>
        {roles.length === 0 ? (
          <p className="mb-4 text-sm text-ink-muted">{t('comp.noRoles')}</p>
        ) : null}
        {targets.length === 0 ? (
          <EmptyState title={t('comp.noRequirements')} description={t('comp.noRequirementsNote')} />
        ) : (
          <DataTable caption={t('comp.viewRequirements')} captionHidden>
            <THead>
              <Tr>
                <Th scope="col">{t('comp.colRole')}</Th>
                <Th scope="col">{t('comp.fieldCompetency')}</Th>
                <Th scope="col">{t('comp.colLevel')}</Th>
                <Th scope="col">{t('comp.colStatus')}</Th>
                <Th scope="col">{t('comp.colSource')}</Th>
                <Th scope="col">{t('comp.colApproval')}</Th>
                {canManage ? <Th scope="col">{t('comp.colActions')}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {targets.map((row) => {
                const label = `${row.jobRole.code} → ${row.competency.code}`;
                const viewerEdited = row.editors.some((editor) => editor.userId === viewerUserId);
                const blocked =
                  approvedLabel === null
                    ? t('comp.requirementsBlocked')
                    : viewerEdited
                      ? t('comp.youEditedTarget')
                      : null;
                return (
                  <Tr key={row.targetId}>
                    <Th scope="row">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-sm">{row.jobRole.code}</span>
                        <span className="text-2xs text-ink-muted">{row.jobRole.name}</span>
                      </span>
                    </Th>
                    <Td>
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-sm">{row.competency.code}</span>
                        <span className="text-2xs text-ink-muted">{row.competency.name}</span>
                      </span>
                    </Td>
                    <Td>
                      {row.targetLevel.code} — {row.targetLevel.label}
                    </Td>
                    <Td>
                      <StatusBadge
                        status={t(`comp.reqStatus.${row.status}` as CopyKey)}
                        tone={
                          row.status === 'APPROVED'
                            ? 'success'
                            : row.status === 'PROPOSED'
                              ? 'warning'
                              : 'neutral'
                        }
                      />
                    </Td>
                    <Td>
                      <span className="flex flex-col gap-0.5 text-sm">
                        <span>{row.source}</span>
                        <span className="text-2xs text-ink-muted">
                          {t('comp.colProposed')}: {row.proposedBy ?? '—'}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      {row.status === 'RETIRED' && row.retiredAt !== null ? (
                        <span className="text-2xs text-ink-muted">
                          {t('comp.retiredBy', {
                            name: row.retiredBy ?? '—',
                            at: when(row.retiredAt),
                          })}
                        </span>
                      ) : row.approvedBy !== null && row.approvedAt !== null ? (
                        <span className="flex flex-col gap-0.5 text-sm">
                          <span>
                            {t('comp.approvedBy', {
                              name: row.approvedBy,
                              at: when(row.approvedAt),
                            })}
                          </span>
                          <span className="text-2xs text-ink-muted">
                            {t('comp.approvalRef', { reference: row.approvalReference ?? '' })}
                            {row.frameworkVersionLabel === null
                              ? ''
                              : ` · ${row.frameworkVersionLabel}`}
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm text-ink-muted">{t('comp.notApproved')}</span>
                      )}
                    </Td>
                    {canManage ? (
                      <Td>
                        <span className="flex flex-wrap items-start gap-2">
                          {row.status === 'PROPOSED' ? (
                            <>
                              <EditRequirementButton
                                target={{
                                  targetId: row.targetId,
                                  targetLevelId: row.targetLevel.id,
                                  source: row.source,
                                  rationale: row.rationale,
                                  effectiveFrom: row.effectiveFrom,
                                  label,
                                }}
                                levels={levelsOf(row.competency.id)}
                                actingAs={actingAs}
                              />
                              <ApproveRequirementButton
                                targetId={row.targetId}
                                label={label}
                                blockedReason={blocked}
                                actingAs={actingAs}
                              />
                            </>
                          ) : null}
                          {row.status === 'RETIRED' ? null : (
                            <RetireRequirementButton targetId={row.targetId} actingAs={actingAs} />
                          )}
                        </span>
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </TBody>
          </DataTable>
        )}
      </CardBody>
    </Card>
  );
};

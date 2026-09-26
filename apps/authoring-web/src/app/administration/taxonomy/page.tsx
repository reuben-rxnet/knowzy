// Administration → Knowledge Domains.
//
// The first Administration screen with a backend behind it. Everything else
// under authoring-portal.md §11 — generation profiles, thresholds, field
// mapping profiles, badge definitions — is still unbuilt, which is why the
// navigation entry says PARTIALLY_IMPLEMENTED and names this one part.
//
// It exists because the platform shipped with one seeded domain and one seeded
// topic and no way to add a second, so every imported question bank landed
// under whatever the seed happened to contain.
//
// Two tables, not one. A domain and a topic are edited with different fields
// and different rules — a domain has a permanent code, a topic belongs to
// exactly one domain — and merging them into a tree would hide the one fact an
// administrator most needs to see, which is whether a code is still editable.

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
  TBody,
  THead,
  Td,
  Th,
  TextInput,
  Tr,
} from '@knowzy/shared-ui';
import { Building2, FolderTree, Layers, Tags, UserCog } from 'lucide-react';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import {
  ActiveToggle,
  EditDomainButton,
  EditOrgEntryButton,
  EditTopicButton,
  NewDomainButton,
  NewOrgEntryButton,
  NewTopicButton,
  OrgActiveToggle,
} from '../../../components/TaxonomyForms';
import { currentSubject } from '../../../lib/identity';

interface DomainRow {
  readonly domainId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly requireSmeSignoff: boolean;
  readonly topicCount: number;
  readonly activeTopicCount: number;
  readonly questionCount: number;
  readonly publishedQuestionCount: number;
  readonly codeLocked: boolean;
}

interface TopicRow {
  readonly topicId: string;
  readonly domainId: string;
  readonly domainCode: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly questionCount: number;
}

/** A department or a role: the two catalogues share one row shape. */
interface OrgRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly questionCount: number;
  readonly publishedQuestionCount: number;
  readonly generationJobCount: number;
  readonly codeLocked: boolean;
}

interface Catalogue {
  readonly domains: readonly DomainRow[];
  readonly topics: readonly TopicRow[];
  readonly departments: readonly OrgRow[];
  readonly roles: readonly OrgRow[];
  readonly counts: {
    readonly domains: number;
    readonly activeDomains: number;
    readonly topics: number;
    readonly activeTopics: number;
    readonly departments: number;
    readonly activeDepartments: number;
    readonly roles: number;
    readonly activeRoles: number;
  };
}

export const dynamic = 'force-dynamic';

export default async function TaxonomyAdministrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params['query'] === 'string' ? params['query'] : '';
  const active = typeof params['active'] === 'string' ? params['active'] : '';
  const subject = await currentSubject();

  const search = new URLSearchParams();
  if (query.length > 0) search.set('query', query);
  if (active === 'true' || active === 'false') search.set('active', active);
  const suffix = search.size === 0 ? '' : `?${search.toString()}`;

  const catalogue = await api<Catalogue>(`/api/v1/authoring/taxonomy/catalogue${suffix}`);

  if (!catalogue.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('tax.heading')} purpose={t('tax.intro')} />
        <Problem problem={catalogue.problem} actingAs={subject.label} />
      </div>
    );
  }

  const { domains, topics, departments, roles, counts } = catalogue.data;
  const domainOptions = domains
    .filter((domain) => domain.isActive)
    .map((domain) => ({ domainId: domain.domainId, code: domain.code, name: domain.name }));

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('tax.heading')} purpose={t('tax.intro')} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t('tax.domainCount')}
          value={counts.domains}
          icon={<Tags className="size-5" />}
        />
        <KpiCard
          label={t('tax.activeDomainCount')}
          value={counts.activeDomains}
          icon={<Layers className="size-5" />}
        />
        <KpiCard
          label={t('tax.topicCount')}
          value={counts.topics}
          icon={<FolderTree className="size-5" />}
        />
        <KpiCard
          label={t('tax.activeTopicCount')}
          value={counts.activeTopics}
          icon={<FolderTree className="size-5" />}
        />
        <KpiCard
          label={t('tax.departmentCount')}
          value={counts.departments}
          caption={t('tax.activeDepartmentCount')}
          icon={<Building2 className="size-5" />}
        />
        <KpiCard
          label={t('tax.roleCount')}
          value={counts.roles}
          caption={t('tax.activeRoleCount')}
          icon={<UserCog className="size-5" />}
        />
      </div>

      {/* Search and filter as a plain GET form: the result is a URL somebody
          can send to a colleague, and it needs no JavaScript. */}
      <Card>
        <CardBody>
          <form method="GET" className="flex flex-wrap items-end gap-4">
            <div className="min-w-64 flex-1">
              <Field id="tax-query" label={t('tax.search')} hint={t('tax.searchHint')}>
                <TextInput id="tax-query" name="query" defaultValue={query} />
              </Field>
            </div>
            <div className="min-w-56">
              <Field id="tax-active" label={t('tax.filterActive')}>
                <Select id="tax-active" name="active" defaultValue={active}>
                  <option value="">{t('tax.filterAll')}</option>
                  <option value="true">{t('tax.filterActiveOnly')}</option>
                  <option value="false">{t('tax.filterInactiveOnly')}</option>
                </Select>
              </Field>
            </div>
            <Button tone="secondary">{t('tax.apply')}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('tax.domainsHeading')}
          description={t('tax.deactivateNote')}
          actions={<NewDomainButton actingAs={subject.label} />}
        />
        <CardBody>
          {domains.length === 0 ? (
            <EmptyState title={t('tax.noDomains')} />
          ) : (
            <DataTable caption={t('tax.domainsHeading')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('tax.code')}</Th>
                  <Th scope="col">{t('tax.name')}</Th>
                  <Th scope="col">{t('tax.active')}</Th>
                  <Th scope="col" align="end">
                    {t('tax.topicsColumn')}
                  </Th>
                  <Th scope="col" align="end">
                    {t('tax.questionsColumn')}
                  </Th>
                  <Th scope="col">{t('tax.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {domains.map((domain) => (
                  <Tr key={domain.domainId}>
                    <Th scope="row">
                      <span className="flex flex-col gap-1">
                        <span className="font-mono text-base">{domain.code}</span>
                        {/* The one fact this screen exists to show: whether the
                            code can still be corrected. */}
                        {domain.codeLocked ? (
                          <Badge tone="neutral" withIcon={false}>
                            {t('tax.codeLocked')}
                          </Badge>
                        ) : null}
                      </span>
                    </Th>
                    <Td>
                      <span className="flex flex-col gap-1">
                        <span className="font-semibold text-ink">{domain.name}</span>
                        <span className="text-2xs text-ink-muted">
                          {domain.description ?? t('tax.nothingYet')}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge
                        status={domain.isActive ? t('browser.yes') : t('browser.no')}
                        tone={domain.isActive ? 'success' : 'neutral'}
                      />
                    </Td>
                    <Td numeric>
                      {domain.activeTopicCount} / {domain.topicCount}
                    </Td>
                    <Td numeric>
                      <span className="flex flex-col items-end gap-1">
                        <span>{domain.questionCount}</span>
                        <span className="text-2xs text-ink-muted">
                          {t('tax.published', { count: domain.publishedQuestionCount })}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-start gap-2">
                        <EditDomainButton
                          domain={{
                            domainId: domain.domainId,
                            code: domain.code,
                            name: domain.name,
                            description: domain.description,
                            isActive: domain.isActive,
                            requireSmeSignoff: domain.requireSmeSignoff,
                            codeLocked: domain.codeLocked,
                            questionCount: domain.questionCount,
                          }}
                          actingAs={subject.label}
                        />
                        <ActiveToggle
                          kind="domain"
                          id={domain.domainId}
                          isActive={domain.isActive}
                          actingAs={subject.label}
                        />
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('tax.topicsHeading')}
          description={t('tax.deactivateNote')}
          actions={<NewTopicButton domains={domainOptions} actingAs={subject.label} />}
        />
        <CardBody>
          {topics.length === 0 ? (
            <EmptyState title={t('tax.noTopics')} />
          ) : (
            <DataTable caption={t('tax.topicsHeading')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('tax.name')}</Th>
                  <Th scope="col">{t('tax.domainColumn')}</Th>
                  <Th scope="col">{t('tax.active')}</Th>
                  <Th scope="col" align="end">
                    {t('tax.questionsColumn')}
                  </Th>
                  <Th scope="col">{t('tax.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {topics.map((topic) => (
                  <Tr key={topic.topicId}>
                    <Th scope="row">
                      <span className="flex flex-col gap-1">
                        <span className="font-semibold text-ink">{topic.name}</span>
                        <span className="font-mono text-2xs text-ink-muted">{topic.slug}</span>
                        <span className="text-2xs text-ink-muted">
                          {topic.description ?? t('tax.nothingYet')}
                        </span>
                      </span>
                    </Th>
                    <Td>
                      <span className="font-mono">{topic.domainCode}</span>
                    </Td>
                    <Td>
                      <StatusBadge
                        status={topic.isActive ? t('browser.yes') : t('browser.no')}
                        tone={topic.isActive ? 'success' : 'neutral'}
                      />
                    </Td>
                    <Td numeric>{topic.questionCount}</Td>
                    <Td>
                      <span className="flex flex-wrap items-start gap-2">
                        <EditTopicButton
                          topic={{
                            topicId: topic.topicId,
                            domainId: topic.domainId,
                            name: topic.name,
                            description: topic.description,
                            isActive: topic.isActive,
                          }}
                          actingAs={subject.label}
                        />
                        <ActiveToggle
                          kind="topic"
                          id={topic.topicId}
                          isActive={topic.isActive}
                          actingAs={subject.label}
                        />
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      {/* The organizational axes. Two tables rather than one, for the same
          reason domains and topics are two: they are edited with different
          rules and merging them would hide which code is still editable. */}
      {(
        [
          {
            kind: 'department' as const,
            rows: departments,
            heading: t('tax.orgHeading'),
            note: t('tax.orgNote'),
            empty: t('tax.noDepartments'),
            emptyNote: t('tax.noDepartmentsNote'),
          },
          {
            kind: 'role' as const,
            rows: roles,
            heading: t('tax.rolesHeading'),
            note: t('tax.rolesNote'),
            empty: t('tax.noRoles'),
            emptyNote: t('tax.noRolesNote'),
          },
        ] as const
      ).map((table) => (
        <Card key={table.kind}>
          <CardHeader
            title={table.heading}
            description={table.note}
            actions={<NewOrgEntryButton kind={table.kind} actingAs={subject.label} />}
          />
          <CardBody>
            {table.rows.length === 0 ? (
              <EmptyState title={table.empty} description={table.emptyNote} />
            ) : (
              <DataTable caption={table.heading} captionHidden>
                <THead>
                  <Tr>
                    <Th scope="col">{t('tax.code')}</Th>
                    <Th scope="col">{t('tax.name')}</Th>
                    <Th scope="col">{t('tax.active')}</Th>
                    <Th scope="col" align="end">
                      {t('tax.questionsColumn')}
                    </Th>
                    <Th scope="col" align="end">
                      {t('tax.publishedColumn')}
                    </Th>
                    <Th scope="col">{t('tax.actions')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {table.rows.map((row) => (
                    <Tr key={row.id}>
                      <Th scope="row">
                        <span className="flex flex-col gap-1">
                          <span className="font-mono text-base">{row.code}</span>
                          {/* Permanence is shown WITH the counts that caused
                              it, so "why can I not edit this?" is answered
                              where the question is asked. */}
                          {row.codeLocked ? (
                            <Badge tone="neutral">{t('tax.codeLocked')}</Badge>
                          ) : null}
                        </span>
                      </Th>
                      <Td>
                        <span className="flex flex-col gap-0.5">
                          <span className="font-semibold text-ink">{row.name}</span>
                          <span className="text-2xs text-ink-muted">
                            {row.description ?? t('tax.nothingYet')}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <StatusBadge
                          status={row.isActive ? t('browser.yes') : t('browser.no')}
                          tone={row.isActive ? 'success' : 'neutral'}
                        />
                      </Td>
                      <Td numeric>{row.questionCount}</Td>
                      <Td numeric>{row.publishedQuestionCount}</Td>
                      <Td>
                        <span className="flex flex-wrap items-start gap-2">
                          <EditOrgEntryButton
                            kind={table.kind}
                            entry={{
                              id: row.id,
                              code: row.code,
                              name: row.name,
                              description: row.description,
                              isActive: row.isActive,
                              codeLocked: row.codeLocked,
                            }}
                            actingAs={subject.label}
                          />
                          <OrgActiveToggle
                            kind={table.kind}
                            id={row.id}
                            isActive={row.isActive}
                            actingAs={subject.label}
                          />
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

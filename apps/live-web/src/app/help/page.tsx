import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ExampleRegion,
  PageHero,
  PreviewNotice,
} from '@knowzy/shared-ui';
import { Activity, CalendarClock, Clock, Mail, MessageSquare, Ticket } from 'lucide-react';
import type { ReactNode } from 'react';
import { t, type CopyKey } from '../../copy';
import {
  DisabledFilters,
  ExampleGrid,
  FutureTag,
  LiveTag,
  PreviewAction,
} from '../../components/PreviewParts';

/**
 * Help & Support — a PREVIEW (LIVE-PREVIEW-M1), with two real sections.
 *
 * Real: the user guides and the FAQ. They are not placeholder text — each one
 * describes how this release actually behaves, taken from the user guide §5,
 * so they are true today and are rendered outside any frame.
 *
 * Illustrative, inside ExampleRegions: help search, tutorials, support
 * channels, support hours and system status. §16.3: no ticketing, mailbox,
 * chat, scheduling or status action without an approved integration, and no
 * real address or operational commitment in mock content — so every channel
 * reads "Not configured", no address or number appears anywhere, and system
 * status claims nothing.
 */

const GUIDES: readonly { readonly title: CopyKey; readonly steps: readonly CopyKey[] }[] = [
  {
    title: 'help.guideStartTitle',
    steps: ['help.guideStart1', 'help.guideStart2', 'help.guideStart3', 'help.guideStart4'],
  },
  {
    title: 'help.guideResumeTitle',
    steps: ['help.guideResume1', 'help.guideResume2', 'help.guideResume3'],
  },
  {
    title: 'help.guideResultTitle',
    steps: ['help.guideResult1', 'help.guideResult2', 'help.guideResult3'],
  },
];

const FAQ: readonly { readonly q: CopyKey; readonly a: CopyKey }[] = [
  { q: 'help.faqQ1', a: 'help.faqA1' },
  { q: 'help.faqQ2', a: 'help.faqA2' },
  { q: 'help.faqQ3', a: 'help.faqA3' },
  { q: 'help.faqQ4', a: 'help.faqA4' },
  { q: 'help.faqQ5', a: 'help.faqA5' },
  { q: 'help.faqQ6', a: 'help.faqA6' },
  { q: 'help.faqQ7', a: 'help.faqA7' },
];

const TUTORIALS: readonly CopyKey[] = [
  'ex.tutorialFirst',
  'ex.tutorialResume',
  'ex.tutorialResult',
];

const CHANNELS: readonly {
  readonly name: CopyKey;
  readonly body: CopyKey;
  readonly icon: ReactNode;
}[] = [
  {
    name: 'help.channelTicket',
    body: 'help.channelTicketBody',
    icon: <Ticket className="size-5" />,
  },
  { name: 'help.channelEmail', body: 'help.channelEmailBody', icon: <Mail className="size-5" /> },
  {
    name: 'help.channelChat',
    body: 'help.channelChatBody',
    icon: <MessageSquare className="size-5" />,
  },
  {
    name: 'help.channelCall',
    body: 'help.channelCallBody',
    icon: <CalendarClock className="size-5" />,
  },
];

export default function HelpPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('help.heading')} purpose={t('help.intro')} backdrop="wave" />

      <PreviewNotice
        label={t('preview.label')}
        title={t('help.previewTitle')}
        requirement={t('help.previewRequirement')}
      >
        <p>{t('help.previewBody')}</p>
      </PreviewNotice>

      <ExampleRegion
        id="help-search"
        heading={t('preview.searchLabel')}
        tag={t('preview.exampleTag')}
        aside={<FutureTag />}
      >
        <DisabledFilters
          idPrefix="help"
          searchPlaceholder={t('help.searchPlaceholder')}
          filters={[]}
        />
      </ExampleRegion>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card ariaLabelledBy="help-guides">
            <CardHeader
              id="help-guides"
              title={t('help.guidesHeading')}
              description={t('help.guidesIntro')}
              actions={<LiveTag />}
            />
            <CardBody>
              <ul className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {GUIDES.map((guide) => (
                  <li
                    key={guide.title}
                    className="flex flex-col gap-2 rounded-md border border-line bg-surface-sunken p-4"
                  >
                    <h3 className="font-semibold text-brand-navy-text">{t(guide.title)}</h3>
                    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink">
                      {guide.steps.map((step) => (
                        <li key={step}>{t(step)}</li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card ariaLabelledBy="help-faq">
            <CardHeader id="help-faq" title={t('help.faqHeading')} actions={<LiveTag />} />
            <CardBody>
              {/* Native disclosure: keyboard and screen-reader behaviour for
                  free, and no client state to hydrate. */}
              <div className="flex flex-col divide-y divide-line">
                {FAQ.map((item) => (
                  <details key={item.q} className="group py-3">
                    <summary className="cursor-pointer list-inside font-semibold text-brand-navy-text">
                      {t(item.q)}
                    </summary>
                    <p className="mt-2 pl-5 text-sm text-ink">{t(item.a)}</p>
                  </details>
                ))}
              </div>
            </CardBody>
          </Card>

          <ExampleRegion
            id="help-tutorials"
            heading={t('help.tutorialsHeading')}
            tag={t('preview.exampleTag')}
            description={t('help.tutorialsIntro')}
            aside={<FutureTag />}
          >
            <ExampleGrid>
              {TUTORIALS.map((tutorial) => (
                <div
                  key={tutorial}
                  className="flex flex-col gap-2 rounded-md border border-line p-4"
                >
                  <h3 className="font-semibold text-brand-navy-text">{t(tutorial)}</h3>
                  <p className="text-xs text-ink-subtle">
                    {t('ex.typeVideo')} · {t('ex.duration3')}
                  </p>
                  <div>
                    <PreviewAction label={t('help.play')} />
                  </div>
                </div>
              ))}
            </ExampleGrid>
          </ExampleRegion>
        </div>

        <div className="flex flex-col gap-6">
          <ExampleRegion
            id="help-channels"
            heading={t('help.channelsHeading')}
            tag={t('preview.exampleTag')}
            description={t('help.channelsIntro')}
            aside={<FutureTag />}
          >
            <ul className="flex flex-col gap-3">
              {CHANNELS.map((channel) => (
                <li
                  key={channel.name}
                  className="flex items-start gap-3 rounded-md border border-line p-3"
                >
                  <span aria-hidden="true" className="mt-0.5 text-ink-subtle">
                    {channel.icon}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-semibold text-brand-navy-text">{t(channel.name)}</span>
                    <span className="text-sm text-ink-muted">{t(channel.body)}</span>
                    <span>
                      <Badge tone="neutral" withIcon={false}>
                        {t('help.channelNotConfigured')}
                      </Badge>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </ExampleRegion>

          <ExampleRegion
            id="help-hours"
            heading={t('help.hoursHeading')}
            tag={t('preview.exampleTag')}
            aside={<FutureTag />}
          >
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t('help.hoursBody')}
            </p>
          </ExampleRegion>

          <ExampleRegion
            id="help-status"
            heading={t('help.statusHeading')}
            tag={t('preview.exampleTag')}
            aside={<FutureTag />}
          >
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <Activity aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t('help.statusBody')}
            </p>
          </ExampleRegion>
        </div>
      </div>
    </div>
  );
}

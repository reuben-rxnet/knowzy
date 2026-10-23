'use client';

// AI Document Studio, Simple mode (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12).
//
// Two forms and a switch. The drop zone is a real file input inside a label,
// so a keyboard and a screen reader reach it the way a mouse does; dropping a
// file sets that input and submits the form. The settings form offers only
// what the platform can do: single-choice questions in English. Multiple
// choice, Yes/No and other languages are shown DISABLED with "Coming later"
// -- never as working controls with nothing behind them.

import { useActionState, useRef, useState, type DragEvent } from 'react';
import { Button, Field, Select, TextInput } from '@knowzy/shared-ui';
import { CheckCircle2, FileText, Loader2, Sparkles, UploadCloud } from 'lucide-react';
import { t } from '../copy';
import {
  generateQuizAction,
  quickUploadAction,
  setStudioModeAction,
  type QuizNotGenerated,
} from '../app/document-studio/quick-actions';
import { Problem } from './Problem';
import type { WizardDomain } from './GenerateWizard';

const ACCEPT = ['.pdf', '.docx', '.pptx', '.txt', '.md'] as const;

export const QuizDropzone = ({ actingAs }: { readonly actingAs: string }) => {
  const [state, submit, pending] = useActionState(quickUploadAction, null);
  const [dragging, setDragging] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const send = () => form.current?.requestSubmit();
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file === undefined || input.current === null || pending) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.current.files = transfer.files;
    send();
  };

  return (
    <form ref={form} action={submit} className="flex flex-col items-center gap-5">
      <label
        htmlFor="qq-file"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-busy={pending}
        className={`flex min-h-72 w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors focus-within:outline focus-within:outline-3 focus-within:outline-brand-blue ${
          dragging
            ? 'border-brand-blue bg-info-soft'
            : 'border-line-strong bg-brand-surface hover:border-brand-blue hover:bg-surface-hover'
        }`}
        data-quiz-dropzone
      >
        {pending ? (
          <>
            <Loader2 aria-hidden="true" className="size-12 animate-spin text-brand-blue" />
            <span className="text-lg font-semibold text-brand-navy-text">{t('qq.reading')}</span>
            <span className="max-w-md text-sm text-ink-muted">{t('qq.readingHint')}</span>
          </>
        ) : (
          <>
            <span className="flex size-20 items-center justify-center rounded-full bg-info-soft">
              <UploadCloud aria-hidden="true" className="size-10 text-brand-blue" />
            </span>
            <span className="text-xl text-brand-navy-text">
              <span className="font-bold text-brand-blue">{t('qq.uploadStrong')}</span>{' '}
              {t('qq.uploadOr')}{' '}
              <span className="font-bold text-brand-blue">{t('qq.dragStrong')}</span>{' '}
              {t('qq.uploadTail')}
            </span>
          </>
        )}
        <input
          ref={input}
          id="qq-file"
          name="file"
          type="file"
          accept={ACCEPT.join(',')}
          className="knowzy-sr-only"
          disabled={pending}
          onChange={() => {
            if ((input.current?.files?.length ?? 0) > 0) send();
          }}
        />
      </label>
      <ul className="flex flex-wrap justify-center gap-2" aria-label={t('qq.typesLabel')}>
        {ACCEPT.map((extension) => (
          <li
            key={extension}
            className="rounded-pill bg-surface-sunken px-3 py-1 text-sm font-medium text-ink-muted"
          >
            {extension}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted">{t('qq.limit')}</p>
      {state?.ok === false && state.problem !== undefined ? (
        <div className="w-full">
          <Problem problem={state.problem} actingAs={actingAs} />
        </div>
      ) : null}
    </form>
  );
};

const TYPES = [
  { key: 'qq.typeSingle', value: 'SINGLE_CHOICE', available: true },
  { key: 'qq.typeMultiple', value: 'MULTIPLE_CHOICE', available: false },
  { key: 'qq.typeYesNo', value: 'YES_NO', available: false },
] as const;

export const QuizSettingsForm = ({
  documentId,
  sourceId,
  fileName,
  sectionCount,
  domains,
  providerId,
  providerLabel,
  actingAs,
}: {
  readonly documentId: string;
  readonly sourceId: string;
  readonly fileName: string;
  readonly sectionCount: number;
  readonly domains: readonly WizardDomain[];
  readonly providerId: string;
  readonly providerLabel: string;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(generateQuizAction, null);
  const existing = state?.ok === true ? ((state.data ?? null) as QuizNotGenerated | null) : null;
  const topics = domains.flatMap((domain) =>
    domain.topics.map((topic) => ({
      value: `${domain.domainId}|${topic.topicId}`,
      label: domains.length > 1 ? `${domain.name} › ${topic.name}` : topic.name,
    })),
  );

  return (
    <form action={submit} className="flex flex-col gap-8">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="providerId" value={providerId} />

      <div className="grid gap-6 md:grid-cols-3">
        <Field id="qq-count" label={t('qq.countLabel')}>
          <TextInput
            id="qq-count"
            name="questionCount"
            type="number"
            min={1}
            max={50}
            defaultValue={10}
            required
          />
        </Field>
        <Field id="qq-language" label={t('qq.languageLabel')} hint={t('qq.languageHint')}>
          <Select id="qq-language" name="language" defaultValue="en" disabled>
            <option value="en">{t('qq.languageEnglish')}</option>
          </Select>
        </Field>
        <Field id="qq-topic" label={t('qq.topicLabel')} hint={t('qq.topicHint')}>
          <Select id="qq-topic" name="topic" required defaultValue={topics[0]?.value ?? ''}>
            {topics.map((topic) => (
              <option key={topic.value} value={topic.value}>
                {topic.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-base font-semibold text-brand-navy-text">
          {t('qq.typeLabel')}
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {TYPES.map((type) => (
            <label
              key={type.key}
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                type.available
                  ? 'cursor-pointer border-brand-blue bg-info-soft font-semibold text-brand-navy-text'
                  : 'cursor-not-allowed border-line bg-surface-sunken text-ink-muted'
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="questionType"
                  value={type.value}
                  defaultChecked={type.available}
                  disabled={!type.available}
                  className="size-4 accent-brand-blue"
                />
                {t(type.key)}
              </span>
              {type.available ? null : (
                <span className="rounded-pill bg-brand-surface px-2 py-0.5 text-2xs font-semibold">
                  {t('qq.comingLater')}
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col items-center gap-4 rounded-2xl bg-surface-sunken px-6 py-10 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-ai text-white">
          <FileText aria-hidden="true" className="size-8" />
        </span>
        <span className="break-all text-lg font-semibold text-brand-blue">{fileName}</span>
        <span className="text-sm text-ink-muted">{t('qq.sections', { count: sectionCount })}</span>
        <a href="/document-studio" className="text-sm text-brand-blue underline">
          {t('qq.otherFile')}
        </a>
      </div>

      {existing !== null ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-line bg-info-soft px-4 py-3"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-info" />
          <div className="flex flex-col gap-1 text-sm text-ink">
            <span className="font-semibold">{t('qq.existingTitle')}</span>
            <span>{existing.reason}</span>
            <a href="/review" className="font-medium text-brand-blue underline">
              {t('qq.openReview')}
            </a>
          </div>
        </div>
      ) : null}
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}

      <div className="flex flex-col items-center gap-2">
        {pending ? (
          // A progress panel rather than a disabled button: a generation runs
          // for up to a minute, and a greyed button says "unavailable", not
          // "working".
          <div
            role="status"
            className="flex min-w-64 items-center justify-center gap-3 rounded-md bg-info-soft px-5 py-3 text-base font-semibold text-brand-navy-text"
          >
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-brand-blue" />
            {t('qq.generating')}
          </div>
        ) : (
          <Button
            disabled={topics.length === 0}
            {...(topics.length === 0 ? { disabledReason: t('qq.noTopics') } : {})}
            className="min-w-64 justify-center text-base"
          >
            <Sparkles aria-hidden="true" className="size-5" />
            {t('qq.generate')}
          </Button>
        )}
        <span className="text-2xs text-ink-muted">
          {pending ? t('qq.generatingHint') : t('qq.writtenBy', { provider: providerLabel })}
        </span>
        {topics.length === 0 ? (
          <span className="text-sm text-ink-muted">{t('qq.noTopics')}</span>
        ) : null}
      </div>
    </form>
  );
};

export const StudioModeSwitch = ({
  mode,
  actingAs,
}: {
  readonly mode: 'SIMPLE' | 'FULL';
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(setStudioModeAction, null);
  const next = mode === 'SIMPLE' ? 'FULL' : 'SIMPLE';
  return (
    <form action={submit} className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
      <input type="hidden" name="mode" value={next} />
      <span>{mode === 'SIMPLE' ? t('qq.modeSimpleNote') : t('qq.modeFullNote')}</span>
      <Button
        tone="ghost"
        size="sm"
        disabled={pending}
        {...(pending ? { disabledReason: t('ds.working') } : {})}
      >
        {next === 'FULL' ? t('qq.switchToFull') : t('qq.switchToSimple')}
      </Button>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}
    </form>
  );
};

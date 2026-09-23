// Every user-visible string in the Sync Manager (content rule C1).
//
// The product statement at the top is the most important line in this file.
// The approved design is called "SharePoint Sync Manager", and this release
// synchronizes configured sources INTO Knowzy for extraction and indexing —
// it does not replicate content between two SharePoint locations. The header
// says so on every screen, so nobody has to infer it from a missing feature.

export const copy = {
  'app.name': 'SharePoint Sync Manager',
  'app.subtitle': 'Knowledge-source synchronization into KNOWZY',
  'app.tagline': 'Workflow administration · Scheduling · Monitoring',

  // ------------------------------------------------------------------ header
  'header.connection': 'Service health',
  'header.connected': 'Connected',
  'header.warning': 'Attention',
  'header.disconnected': 'Disconnected',
  'header.lastChecked': 'Last checked',
  'header.never': 'Never tested',
  'header.identity': 'Acting as',
  'header.settings': 'Settings',
  'header.help': 'Help',
  'header.notifications': 'Notifications',
  'header.plannedNote': 'Not available in this release.',
  'header.environment': 'Environment',

  // --------------------------------------------------------------------- KPIs
  'kpi.workflows': 'Total workflows',
  'kpi.workflowsCaption': '{active} active of {total} configured',
  'kpi.successful': 'Successful syncs',
  'kpi.failed': 'Failed syncs',
  'kpi.pending': 'Pending syncs',
  'kpi.pendingCaption': 'Scheduled and awaiting their next run',
  'kpi.windowCaption': 'Last {days} days',
  'kpi.documents': 'Documents indexed',
  'kpi.documentsCaption': 'Across every source you can see',
  'kpi.asOf':
    'Counted at {time}. No comparison to an earlier period is shown, because none is stored.',

  // --------------------------------------------------------------- action bar
  'action.newWorkflow': 'New workflow',
  'action.syncAll': 'Sync all',
  'action.refresh': 'Refresh',
  'action.syncAllConfirm': 'Synchronize every active source now?',
  'action.syncAllBody':
    'Each source runs in turn. One source failing does not stop the others, and a source already synchronizing is left alone.',
  'action.cancel': 'Cancel',
  'action.confirm': 'Synchronize all',
  'action.working': 'Working…',

  // ----------------------------------------------------------- workflow table
  'table.heading': 'Synchronization workflows',
  'table.caption': 'Configured knowledge sources and their synchronization state',
  'table.name': 'Workflow',
  'table.sourceType': 'Adapter',
  'table.scope': 'Source scope',
  'table.destination': 'Destination',
  'table.schedule': 'Schedule',
  'table.lastRun': 'Last run',
  'table.nextRun': 'Next run',
  'table.status': 'Status',
  'table.documents': 'Documents',
  'table.actions': 'Actions',
  'table.empty': 'No source is configured yet. Create a workflow to synchronize one.',
  'table.emptyFiltered': 'No workflow matches this search.',
  'table.search': 'Search workflows',
  'table.searchHint': 'Matches a workflow name, an adapter type, or a container.',
  'table.filterStatus': 'Status',
  'table.filterAll': 'All statuses',
  'table.destinationValue': 'KNOWZY index',
  'table.destinationNote':
    'This release synchronizes into KNOWZY, not into another SharePoint location.',
  'table.never': 'Never',
  'table.noSchedule': 'Manual only',
  'table.nextRunManual': '—',
  'table.nextRunCron': 'On its cron expression',
  'table.overdue': 'overdue',
  'table.pathCount': '{count} path(s)',
  'table.noPaths': 'No path configured',

  // ---------------------------------------------------------- row actions
  'row.syncNow': 'Sync now',
  'row.edit': 'Edit',
  'row.pause': 'Pause',
  'row.resume': 'Resume',
  'row.archive': 'Archive',
  'row.delete': 'Delete',
  'row.history': 'Run history',
  'row.syncNowBlocked': 'A synchronization is already running for this source.',
  'row.pauseBlocked': 'An archived source cannot be paused or resumed.',

  // -------------------------------------------------------------- activity
  'activity.heading': 'Recent synchronization activity',
  'activity.intro': 'Real runs, newest first. Every row is a synchronization that happened.',
  'activity.empty': 'No synchronization has run yet.',
  'activity.completed': 'Synchronization completed',
  'activity.partial': 'Synchronization completed with per-item failures',
  'activity.failed': 'Synchronization failed',
  'activity.running': 'Synchronization running',
  'activity.cancelled': 'Synchronization cancelled',
  'activity.counts':
    '{scanned} scanned · {added} added · {modified} modified · {failed} failed · {skipped} skipped',
  'activity.trigger': 'Triggered {trigger}',
  'activity.manual': 'manually',
  'activity.scheduled': 'by the scheduler',

  // ------------------------------------------------------------------ wizard
  'wizard.createTitle': 'New synchronization workflow',
  'wizard.editTitle': 'Edit workflow',
  'wizard.basics': 'Basic information',
  'wizard.name': 'Workflow name',
  'wizard.description': 'Description',
  'wizard.sourceConfig': 'Source configuration',
  'wizard.adapter': 'Adapter type',
  'wizard.adapterHint': 'Only adapter types this environment has registered are listed.',
  'wizard.localRoot': 'Root path on the server',
  'wizard.localRootHint':
    'Must be inside an allowed root the deployment declares. The browser never lists server directories, and the path is validated server-side.',
  'wizard.allowedRoots': 'Allowed roots: {roots}',
  'wizard.noAllowedRoots':
    'This environment declares no allowed roots, so a file-repository source cannot be created. Set sources.allowedLocalRoots first.',
  'wizard.container': 'Container or library',
  'wizard.containerHint': 'The top-level folder or library to scan.',
  'wizard.folder': 'Folder within the container',
  'wizard.folderHint': 'Leave empty to scan the whole container.',
  'wizard.destinationConfig': 'Destination configuration',
  'wizard.destinationSite': 'Destination site',
  'wizard.destinationLibrary': 'Destination library',
  'wizard.destinationFolder': 'Destination folder',
  'wizard.options': 'Synchronization options',
  'wizard.oneWay': 'One-way synchronization into KNOWZY',
  'wizard.oneWayNote': 'The only mode this release implements.',
  'wizard.twoWay': 'Two-way synchronization',
  'wizard.includeSubfolders': 'Include subfolders',
  'wizard.includeSubfoldersNote': 'A synchronization scans a configured path recursively.',
  'wizard.syncMetadata': 'Write metadata to SharePoint',
  'wizard.syncDeletes': 'Sync deletes to SharePoint',
  'wizard.usableForGeneration': 'Usable for question generation',
  'wizard.scheduling': 'Scheduling',
  'wizard.scheduleMode': 'Schedule',
  'wizard.intervalHours': 'Hours between runs',
  'wizard.cron': 'Cron expression',
  'wizard.cronHint': 'Five fields, as pg-boss reads them. An expression it rejects never fires.',
  'wizard.timezone': 'Timezone',
  'wizard.timezoneHint': 'Recorded with the schedule, because a time without one means nothing.',
  'wizard.nextRunPreview': 'Next run',
  'wizard.save': 'Save workflow',
  'wizard.saveEdit': 'Save changes',
  'wizard.requiresGraph': 'Requires Microsoft Graph write integration and tenant approval.',

  // ----------------------------------------------------------------- retire
  'retire.title': 'Retire workflow',
  'retire.archiveBody':
    'Archiving removes this workflow from every selection surface and keeps its lineage. Documents it indexed, and questions that cite them, are untouched.',
  'retire.deleteBody':
    'Nothing references this source, so it can be deleted outright. This cannot be undone.',
  'retire.blocked':
    'This workflow cannot be deleted: {documents} document(s), {draftQuestions} question(s) and {syncRuns} run(s) reference it. Archive it instead.',
  'retire.archive': 'Archive workflow',
  'retire.delete': 'Delete permanently',

  // -------------------------------------------------------------- schedule
  'schedule.modeMANUAL': 'Manual only',
  'schedule.modeHOURLY': 'Hourly',
  'schedule.modeDAILY': 'Daily',
  'schedule.modeWEEKLY': 'Weekly',
  'schedule.modeMONTHLY': 'Monthly',
  'schedule.modeCRON': 'Cron expression',

  // ---------------------------------------------------------------- results
  'result.syncAllHeading': 'Sync all result',
  'result.requested': 'Requested',
  'result.succeeded': 'Succeeded',
  'result.partial': 'Partial',
  'result.failed': 'Failed',
  'result.alreadyRunning': 'Already running',
  'result.skippedHeading': 'Left alone deliberately',
  'result.perSource': 'Per source',
  'result.close': 'Close',

  // ------------------------------------------------------- refusal rendering
  'error.heading': 'That did not work',
  'error.gateFailures': 'Gate failures',
  'error.actingAs':
    'You are acting as {identity}. This is a permission refusal, not a broken feature — an identity holding source.manage and source.sync can do this.',

  // ------------------------------------------------------------------ states
  'state.loading': 'Loading the current state…',
  'state.refusedTitle': 'The server refused this read',
  'state.actingAs': 'Acting as {identity}.',
  'state.unsupportedHeading': 'Not in this release',
  'state.unsupportedIntro':
    'The approved design shows these capabilities. They are shown disabled rather than hidden, because hiding them would make the gap invisible.',
} as const;

export type CopyKey = keyof typeof copy;

export const t = (key: CopyKey, values?: Readonly<Record<string, string | number>>): string => {
  const template = copy[key];
  if (values === undefined) return template;
  return Object.entries(values).reduce<string>(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    template,
  );
};

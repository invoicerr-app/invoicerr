/** Its OWN queue — deliberately never `documents/queue`'s `Q_DOCUMENT_ACTION`: this module has
 *  nothing to do with a document's own action lifecycle, and sharing that queue would mean every
 *  backup-sweep tick competes with real "send" jobs for the same worker/consumer. */
export const Q_BACKUP = 'instance-backup';

export const BACKUP_SWEEP_JOB_NAME = 'backup-sweep';

/** The `jobId` the repeatable is registered under (`backup-queue.dispatcher.ts`) — kept for parity
 *  with every other sweep in this codebase, though BullMQ v5's own job-scheduler id is actually
 *  derived from a hash of the repeat options rather than this value verbatim (see
 *  `backup-status.service.ts`'s own header on why the status read filters by job NAME instead). */
export const BACKUP_SWEEP_JOB_ID = 'backup-sweep-singleton';

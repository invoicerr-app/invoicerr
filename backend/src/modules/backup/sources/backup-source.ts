/**
 * The shape both source walkers (`archive-source.ts`, `inbound-source.ts`) enumerate to —
 * intentionally provider-agnostic: `backup-runner.ts` never knows or cares whether a given file came
 * off local disk or out of the primary archive's own S3 bucket.
 */
export interface BackupSourceFile {
  /** Stable, relative object key this file is backed up under (never includes `BACKUP_S3_PREFIX` —
   *  `backup-destination.ts` adds that itself at write time). Every source in this module is
   *  content-hash-addressed by construction (see `backup-runner.ts`'s own header), so the SAME key
   *  can only ever mean IDENTICAL bytes — this is what makes the size-only diff in `backup-runner.ts`
   *  a safe incremental check rather than a real hash comparison. */
  key: string;
  /** Byte size, read cheaply (a `stat`/`ListObjectsV2` entry — never a `HeadObjectCommand` per file)
   *  — used for the incremental diff BEFORE `read()` is ever called. */
  size: number;
  /** Reads this file's bytes on demand — never called unless the incremental diff
   *  (`backup-runner.ts`) actually decided this file needs (re-)uploading. */
  read(): Promise<Buffer>;
}

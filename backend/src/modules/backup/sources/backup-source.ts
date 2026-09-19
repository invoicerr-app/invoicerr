import type { Readable } from 'node:stream';

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
   *  — used for the incremental diff BEFORE `read()` is ever called. This is the PLAINTEXT size;
   *  `backup-runner.ts` adds `BACKUP_ENCRYPTION_OVERHEAD_BYTES` (`backup-crypto.ts`) when comparing
   *  against what is actually sitting at the (encrypted) destination. */
  size: number;
  /** Opens a fresh, on-demand READ STREAM for this file — never a whole-file `Buffer`. A company's
   *  document archive is not a string: `backup-destination.ts#upload` pipes this stream straight
   *  through encryption and a multipart S3 upload, holding only a few chunks in memory at a time
   *  regardless of how large the artifact is (see `backup-crypto.ts`'s own header). Local sources
   *  return a fresh `fs.createReadStream`; S3 sources return the `GetObjectCommand` response's own
   *  `Body`. Either way, called only once per file, only after the incremental size diff above
   *  already decided this file needs (re-)uploading. */
  read(): Promise<Readable>;
}

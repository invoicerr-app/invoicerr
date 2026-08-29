export interface RunActionDto {
  /** Absent to create a new document instance; present to act on an existing one. */
  documentId?: string;
  data: Record<string, unknown>;
}

export interface RunActionDto {
  /** Absent to create a new document instance; present to act on an existing one. */
  documentId?: string;
  data: Record<string, unknown>;
  /** The action's OWN parameters (see DocumentActionDescriptor.params) — a separate namespace from
   *  `data`. Absent/empty is fine for an action that declares no params. */
  params?: Record<string, unknown>;
}

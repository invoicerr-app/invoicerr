import type { TFunction } from "i18next"

/**
 * One explanation the server composes as a key plus its values (see the backend's
 * `documents/messages/server-message.ts`). The English text lives in `locales/en/translation.json`
 * under the same key, so every locale can translate the sentence and keep the values as they are.
 */
export interface ServerMessage {
  key: string
  params?: Record<string, string | number>
}

/** Renders one server message in the active language. */
export function formatServerMessage(t: TFunction, message: ServerMessage): string {
  return t(message.key, message.params ?? {})
}

/** Renders a list of server messages, keeping their order. */
export function formatServerMessages(t: TFunction, messages: readonly ServerMessage[]): string[] {
  return messages.map((message) => formatServerMessage(t, message))
}

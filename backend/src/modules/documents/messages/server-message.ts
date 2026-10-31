import { SERVER_MESSAGES_EN, ServerMessageKey } from './messages.en';

/**
 * One explanation the server composes, as an identity plus its values rather than a finished English
 * sentence. The API hands this object to the frontend, which renders it through `t()` in the user's
 * language; anything the server itself must print (the PDF, the CSV export) renders it through
 * `formatServerMessage` below, from the same English catalog.
 *
 * `key` is typed against `SERVER_MESSAGES_EN`, so a producer cannot invent a key no locale holds.
 */
export interface ServerMessage {
  key: ServerMessageKey;
  params?: Record<string, string | number>;
}

export function serverMessage(
  key: ServerMessageKey,
  params?: Record<string, string | number>,
): ServerMessage {
  return params ? { key, params } : { key };
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/**
 * Renders a message in English, for output that leaves the server already finished (a rendered PDF,
 * a CSV cell). A placeholder with no param is left as written rather than blanked: a visible
 * `{{rate}}` in a PDF is a bug report, an empty gap is a silent wrong sentence.
 */
export function formatServerMessage(message: ServerMessage): string {
  const template = SERVER_MESSAGES_EN[message.key];
  if (template === undefined) return message.key;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = message.params?.[name];
    return value === undefined ? match : String(value);
  });
}

/** Renders a list of messages for a server-side consumer; an empty list stays an empty list. */
export function formatServerMessages(messages: readonly ServerMessage[]): string[] {
  return messages.map(formatServerMessage);
}

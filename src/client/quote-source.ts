/**
 * The quote chip's input-trigger source. It exists for the reference codec:
 * the candidate menu never shows it (the roll is always empty, and the menu
 * hides ready-but-empty groups), while submit serialization routes every
 * occurrence with this source name through `codec.serialize`.
 */
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { decodeQuoteRef, formatQuoteSerialized } from './quote.ts'

/** Source name stamped on ReferenceInsert and used by the quote bar filter. */
export const QUOTE_SOURCE_NAME = 'dsh-sessions-quote'

/** Create the quote codec source registered once per client root. */
export function createQuoteSource(): InputTriggerSource {
  return {
    trigger: '@',
    name: QUOTE_SOURCE_NAME,
    order: 1000,

    async candidates() {
      return []
    },

    onPick() {
      return undefined
    },

    codec: {
      clipboardText(ref) {
        const payload = decodeQuoteRef(ref)
        return formatQuoteSerialized(payload.text, payload.comment)
      },
      async serialize(ref) {
        const payload = decodeQuoteRef(ref)
        return formatQuoteSerialized(payload.text, payload.comment)
      },
    },
  }
}

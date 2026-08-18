import { type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'

const PRESENTATION_HINTS = [
  { label: '<!-- present: break -->', detail: 'Force a scene break' },
  { label: '<!-- present: keep -->', detail: 'Keep the next block together' },
  { label: '<!-- present: hero -->', detail: 'Emphasize the next image' },
  { label: '<!-- present: hide -->', detail: 'Hide the next block in presentation' },
  { label: '<!-- present: only -->', detail: 'Show the next block only in presentation' },
  { label: '<!-- present: step -->', detail: 'Reveal the next list item by item' },
  { label: '<!-- present: group -->', detail: 'Start a group that stays on one scene' },
  { label: '<!-- present: end-group -->', detail: 'End the same-scene group' },
  { label: '<!-- present: columns -->', detail: 'Start responsive semantic columns' },
  { label: '<!-- present: column -->', detail: 'Start another column' },
  { label: '<!-- present: end-columns -->', detail: 'End semantic columns' },
]

export function presentationHintCompletion(context: CompletionContext): CompletionResult | null {
  const token = context.matchBefore(/<!--\s*present:\s*[a-z-]*/i)
  if (!token || (!context.explicit && token.from === token.to)) return null
  return {
    from: token.from,
    options: PRESENTATION_HINTS.map((hint) => ({ ...hint, type: 'keyword' })),
    validFor: /<!--\s*present:\s*[a-z-]*\s*(?:-->)?/i,
  }
}


# Parser walkthrough

## Tokenizing

```ts
function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '#') {
      tokens.push({ kind: 'hash', at: cursor })
      cursor += 1
      continue
    }
    if (char === '\n') {
      tokens.push({ kind: 'newline', at: cursor })
      cursor += 1
      continue
    }
    const start = cursor
    while (cursor < source.length && source[cursor] !== '\n') cursor += 1
    tokens.push({ kind: 'text', at: start, value: source.slice(start, cursor) })
  }
  return tokens
}
```

The tokenizer never backtracks. Every character is visited once.

## Building blocks

```ts
function toBlocks(tokens: Token[]): Block[] {
  const blocks: Block[] = []
  let heading: Token | null = null
  for (const token of tokens) {
    if (token.kind === 'hash') heading = token
    else if (token.kind === 'text' && heading) {
      blocks.push({ kind: 'heading', text: token.value })
      heading = null
    } else if (token.kind === 'text') {
      blocks.push({ kind: 'paragraph', text: token.value })
    }
  }
  return blocks
}
```

## Error handling

```python
def safe_parse(source):
    try:
        return parse(source)
    except ParseError as error:
        return Document.empty(reason=str(error))
```

Failures degrade to an empty document rather than a crash.

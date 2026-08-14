# toolbelt

A small utility library with no dependencies.

## Install

```bash
npm install @example/toolbelt
```

## Quick start

```ts
import { debounce } from '@example/toolbelt'

const save = debounce(() => api.save(), 300)
```

## API

| Function | Signature | Notes |
| --- | --- | --- |
| debounce | (fn, ms) => fn | Trailing edge |
| throttle | (fn, ms) => fn | Leading edge |
| once | (fn) => fn | Caches result |

## Why another utility library

> Every project deserves utilities it can read in one sitting.

- Zero dependencies
- Every function under twenty lines
- Types included

![Coverage badge](coverage.svg)

The badge is generated on every merge to main.

## License

MIT. Contributions welcome, tests required.

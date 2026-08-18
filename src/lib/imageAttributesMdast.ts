import { formatMarpitImageAlt, parseImageAttributes } from '../imageSyntax'

interface MdastNode {
  type: string
  alt?: string | null
  value?: string
  children?: MdastNode[]
}

/**
 * Folds a hybrid `{key=value}` attribute block that follows an image into the
 * image's alt, re-encoded in the legacy Marpit token form that downstream
 * renderers already parse. Rendered Markdown therefore never shows the block
 * as literal text. Mutates the tree in place.
 */
export function foldImageAttributes(node: MdastNode): void {
  const children = node.children
  if (!children) return
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child.type !== 'image') {
      foldImageAttributes(child)
      continue
    }
    const sibling = children[index + 1]
    const match = sibling?.type === 'text' ? sibling.value?.match(/^\{([^}\n]*)\}/) : null
    if (!match || !sibling) continue
    child.alt = formatMarpitImageAlt(parseImageAttributes(child.alt ?? '', match[1]))
    const rest = (sibling.value ?? '').slice(match[0].length).replace(/^\s+/, '')
    if (rest) sibling.value = rest
    else children.splice(index + 1, 1)
  }
}

export function remarkFoldImageAttributes() {
  return (tree: MdastNode) => foldImageAttributes(tree)
}

// ABOUTME: A literal YAML frontmatter block for Milkdown's Markdown parser and serializer.
// ABOUTME: Keeps metadata editable without interpreting YAML values as Markdown or rewriting their syntax.

import type { NodeSchema } from '@milkdown/kit/transformer'
import { $node, $remark } from '@milkdown/kit/utils'
import remarkFrontmatter from 'remark-frontmatter'

export const frontmatterSpec: NodeSchema = {
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'pre[data-frontmatter]', preserveWhitespace: 'full', priority: 60 }],
  toDOM: () => ['pre', { 'data-frontmatter': 'yaml', class: 'frontmatter' }, ['code', {}, 0]],
  parseMarkdown: {
    match: (node) => node.type === 'yaml',
    runner: (state, node, type) => {
      state.openNode(type)
      if (node.value) state.addText(node.value as string)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'frontmatter',
    runner: (state, node) => { state.addNode('yaml', undefined, node.textContent) },
  },
}

const yaml = $remark('emditor-frontmatter', () => remarkFrontmatter, 'yaml')
const block = $node('frontmatter', () => frontmatterSpec)
export const frontmatter = [...yaml, block]

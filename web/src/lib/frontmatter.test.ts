// @vitest-environment jsdom
// ABOUTME: Exercises frontmatter through the same Milkdown plugins used by the rich editor.
// ABOUTME: Checks literal YAML round trips, body edits, keyboard editing, and ordinary Markdown rules.

import { Editor, defaultValueCtx, editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { exitCode, newlineInCode } from '@milkdown/kit/prose/commands'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { frontmatter } from './frontmatter'

const yaml = `title: "The Rise of Personal Software"
description: "AI makes small, personal tools easier to build."
tldr: "Adapt it, export your data, and keep it running."
date: 2026-09-26
tags: ["AI", "TOOLS", "SOFTWARE"]
draft: true
author: "Nikola Balić"
topics: ["End-user programming", "Personal software", "Software ownership"]
entities: ["Ink & Switch", "Simon Willison", "GitHub Spark"]
answers_questions:
  - "What makes personal software useful?"
  - "How can you keep control of an AI-built tool?"
# Keep this comment
summary: |
  First line.
  Second line.`
const markdown = `---\n${yaml}\n---\n\nYour software is almost right.\n`
let editor: Editor

beforeEach(async () => {
  const host = document.createElement('div')
  document.body.append(host)
  editor = await Editor.make().config((ctx) => {
    ctx.set(rootCtx, host)
    ctx.set(defaultValueCtx, markdown)
  }).use(commonmark).use(gfm).use(frontmatter).create()
})

afterEach(async () => {
  await editor.destroy()
  document.body.replaceChildren()
})

it('renders metadata separately and round trips literal YAML', () => {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    expect(view.state.doc.firstChild?.type.name).toBe('frontmatter')
    expect(view.state.doc.firstChild?.textContent).toBe(yaml)
    expect(view.dom.querySelector('pre[data-frontmatter] code')?.textContent).toBe(yaml)
    expect(ctx.get(serializerCtx)(view.state.doc)).toBe(markdown)
  })
})

it('preserves metadata while editing the prose and reparsing external changes', () => {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText(' Updated.', view.state.doc.content.size - 1))
    const saved = ctx.get(serializerCtx)(view.state.doc)
    expect(saved).toBe(markdown.trimEnd() + ' Updated.\n')
    const incoming = saved.replace('draft: true', 'draft: false')
    const next = ctx.get(parserCtx)(incoming)!
    expect(next.firstChild?.textContent).toBe(yaml.replace('draft: true', 'draft: false'))
    expect(ctx.get(serializerCtx)(next)).toBe(incoming)
  })
})

it('supports literal newlines and exiting frontmatter into prose', () => {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const end = view.state.doc.firstChild!.nodeSize - 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    expect(newlineInCode(view.state, view.dispatch)).toBe(true)
    view.dispatch(view.state.tr.insertText('custom: "value"'))
    expect(view.state.doc.firstChild?.textContent).toBe(yaml + '\ncustom: "value"')
    expect(ctx.get(serializerCtx)(view.state.doc)).toBe(markdown.replace(yaml, yaml + '\ncustom: "value"'))
    expect(exitCode(view.state, view.dispatch)).toBe(true)
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
  })
})

it('keeps empty frontmatter and leaves rules, headings, and fenced YAML as Markdown', () => {
  editor.action((ctx) => {
    const parse = ctx.get(parserCtx)
    const serialize = ctx.get(serializerCtx)
    const empty = parse('---\n---\n\nBody\n')!
    expect(empty.firstChild?.type.name).toBe('frontmatter')
    expect(serialize(empty)).toBe('---\n---\n\nBody\n')
    for (const source of ['Body\n\n---\n', '---\n\n# Heading\n', '```yaml\ntitle: "Code"\n```\n']) {
      const doc = parse(source)!
      expect(doc.toJSON().content.some((node: { type: string }) => node.type === 'frontmatter')).toBe(false)
    }
  })
})

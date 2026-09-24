// ABOUTME: A sheet that lists every keyboard shortcut.
// ABOUTME: Open it with ? on the desk or ⌥/ anywhere.

import { motion } from 'motion/react'

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Everywhere',
    keys: [
      ['⌘K', 'Find or create a document'],
      ['⌥0', 'Switch desk and workspace'],
      ['⌘S', 'Save all now'],
      ['⌥/', 'This sheet'],
    ],
  },
  {
    title: 'Workspace',
    keys: [
      ['⌥1 – ⌥7', 'Layout: one, two, three, 2×2, one + two, rows, 3×2'],
      ['⌃H ⌃J ⌃K ⌃L', 'Focus the pane left, down, up, right'],
      ['⌃⇧H ⌃⇧J ⌃⇧K ⌃⇧L', 'Move the pane'],
      ['⌥L', 'Lock scroll of all panes'],
      ['⌘/', 'Rich text or Markdown source'],
      ['⌥W', 'Close the pane'],
      ['⌘P', 'Print the focused pane on A4'],
    ],
  },
  {
    title: 'Desk',
    keys: [
      ['← → ↑ ↓', 'Move the cursor'],
      ['↵  ⇧↵', 'Open  ·  open in a new pane'],
      ['␣  ⌘-click', 'Select'],
      ['G  U', 'Stack the selection  ·  unstack'],
      ['⌥ + arrows', 'Move the card (manual order)'],
      ['S', 'Next sort: recent, name, manual'],
      ['+ −', 'Thumbnail size'],
      ['N', 'New document'],
    ],
  },
]

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.div
        className="sheet-panel"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ type: 'spring', stiffness: 480, damping: 36 }}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h2>{group.title}</h2>
            <dl>
              {group.keys.map(([keys, what]) => (
                <div key={keys} className="shortcut">
                  <dt>{keys}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </motion.div>
    </motion.div>
  )
}

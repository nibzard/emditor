// ABOUTME: A sheet that lists every keyboard shortcut.
// ABOUTME: Open it with ? on the desk or ⌥/ anywhere.

import { Dialog } from './Dialog'

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Everywhere',
    keys: [
      ['⌘K', 'Find a document'],
      ['⌥0', 'Show or close the paper desk'],
      ['⌘S', 'Save all now'],
      ['⌥N', 'New document'],
      ['⌥T', 'Theme: system, light, dark'],
      ['⌥/', 'This sheet'],
    ],
  },
  {
    title: 'Workspace',
    keys: [
      ['⌥1 – ⌥7', 'Arrange panes'],
      ['⌃H ⌃J ⌃K ⌃L', 'Focus the pane left, down, up, right'],
      ['⌃⇧H ⌃⇧J ⌃⇧K ⌃⇧L', 'Move the pane'],
      ['⌥L', 'Lock scroll of all panes'],
      ['⌥F', 'Focus mode'],
      ['⌘= ⌘− ⌘0', 'Zoom the paper in, out, actual size'],
      ['⌘/', 'Formatted text or Markdown source'],
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
    <Dialog title="Keyboard shortcuts" onClose={onClose}>{(dismiss) => <>
        <div className="dialog-heading"><h2>Keyboard shortcuts</h2><button className="text-btn" onClick={dismiss}>Close</button></div>
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
      </>}
    </Dialog>
  )
}

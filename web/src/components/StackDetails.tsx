// ABOUTME: Reveals every document in a desk stack before opening or separating them.

import type { DeskItem } from '../lib/desk'
import { dirOf, titleFromPath } from '../lib/text'
import { Dialog } from './Dialog'

type StackItem = Extract<DeskItem, { kind: 'stack' }>
type Props = {
  item: StackItem
  onOpen: (path: string, beside: boolean) => void
  onOpenMany: (paths: string[]) => void
  onUnstack: () => void
  onClose: () => void
}

export function StackDetails({ item, onOpen, onOpenMany, onUnstack, onClose }: Props) {
  return <Dialog title={`${item.files.length} documents in stack`} onClose={onClose} className="stack-dialog">{(dismiss) => <>
    <div className="dialog-heading"><h2>{item.files.length} documents in this stack</h2><button className="text-btn" onClick={dismiss}>Close</button></div>
    <div className="stack-members">
      {item.files.map((file) => <div className="stack-member" key={file.path}>
        <span><strong>{titleFromPath(file.path)}</strong><small>{dirOf(file.path)}</small></span>
        <span className="stack-member-actions"><button className="text-btn" onClick={() => onOpen(file.path, false)}>Open</button>
          <button className="text-btn" onClick={() => onOpen(file.path, true)}>Open beside</button></span>
      </div>)}
    </div>
    <div className="dialog-actions">
      <button className="text-btn" onClick={onUnstack}>Unstack</button>
      <button className="btn" onClick={() => onOpenMany(item.stack.paths)}>{item.files.length > 6 ? 'Open first six' : 'Open all'}</button>
    </div>
    {item.files.length > 6 && <p className="field-hint">The other documents remain in this stack.</p>}
  </>}
  </Dialog>
}

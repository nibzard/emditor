// ABOUTME: Root of the emditor web app: loads the folder, then shows the desk and the workspace.
// ABOUTME: It owns the global keyboard shortcuts, the palette, and state kept per folder.

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { api, ApiError, type Listing } from './api'
import { Desk, isTypingTarget } from './components/Desk'
import { Enso } from './components/Enso'
import { LockIcon } from './components/icons'
import { LayoutPicker } from './components/LayoutPicker'
import { Palette } from './components/Palette'
import { Segmented } from './components/Segmented'
import { Shortcuts } from './components/Shortcuts'
import { Workspace } from './components/Workspace'
import { SAVE_ALL_EVENT } from './hooks/useDocument'
import { readStored, useStoredState } from './hooks/useStoredState'
import { buildDesk, type DeskState, EMPTY_DESK } from './lib/desk'
import { type Direction, LAYOUTS } from './lib/layouts'
import { titleFromPath } from './lib/text'
import { initialWork, type OpenTarget, type Work, workReducer } from './lib/workspace'

type View = 'desk' | 'work'

const PANE_KEYS: Record<string, Direction> = { KeyH: 'left', KeyJ: 'down', KeyK: 'up', KeyL: 'right' }

export default function App() {
  const [listing, setListing] = useState<Listing | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    api.list().then(setListing, (err) => {
      console.error('emditor: cannot load the folder', err)
      setFailed(true)
    })
  }, [])
  if (failed) return <div className="boot">Cannot reach the emditor server. Is it still running?</div>
  if (!listing)
    return (
      <div className="boot">
        <Enso size={56} />
      </div>
    )
  return <Main key={listing.path} initialListing={listing} />
}

function startWork(listing: Listing): Work {
  const stored = readStored<Work | null>(`emditor.work:${listing.path}`, null)
  let work = stored && Array.isArray(stored.panes) && stored.panes.length > 0 ? stored : initialWork()
  work = workReducer(work, { type: 'prune', existing: listing.files.map((f) => f.path) })
  const fromUrl = new URLSearchParams(location.search).get('file')
  if (fromUrl && listing.files.some((f) => f.path === fromUrl)) {
    work = workReducer(work, { type: 'open', path: fromUrl, where: 'slot' })
  }
  return work
}

function Main({ initialListing }: { initialListing: Listing }) {
  const [listing, setListing] = useState(initialListing)
  const root = listing.path
  const [desk, setDesk] = useStoredState<DeskState>(`emditor.desk:${root}`, EMPTY_DESK)
  const [work, dispatch] = useReducer(workReducer, initialListing, startWork)
  const [view, setView] = useState<View>(() => (work.panes.some((p) => p.path) ? 'work' : 'desk'))
  const [palette, setPalette] = useState<{ target: OpenTarget; title: string } | null>(null)
  const [shortcuts, setShortcuts] = useState(false)
  const [focusSignal, setFocusSignal] = useState(0)
  const [quiet, setQuiet] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setListing(await api.list())
    } catch (err) {
      console.error('emditor: cannot refresh the folder', err)
    }
  }, [])

  useEffect(() => {
    if (location.search) history.replaceState(null, '', '/')
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(`emditor.work:${root}`, JSON.stringify(work))
    } catch {
      // Storage is not available. The workspace is not kept after a reload.
    }
  }, [root, work])

  useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(t)
  }, [toast])

  const items = useMemo(() => buildDesk(listing.files, desk), [listing.files, desk])
  const openPaths = useMemo(() => new Set(work.panes.flatMap((p) => (p.path ? [p.path] : []))), [work.panes])
  const focusedPath = work.panes[work.focus]?.path

  useEffect(() => {
    document.title = view === 'work' && focusedPath ? `${titleFromPath(focusedPath)} — emditor` : `${listing.root} — emditor`
  }, [view, focusedPath, listing.root])

  const bumpFocus = () => setFocusSignal((n) => n + 1)

  const openDoc = useCallback((path: string, where: OpenTarget) => {
    dispatch({ type: 'open', path, where })
    setView('work')
    setPalette(null)
    setFocusSignal((n) => n + 1)
  }, [])

  const openMany = useCallback((paths: string[]) => {
    dispatch({ type: 'openMany', paths })
    setView('work')
    setFocusSignal((n) => n + 1)
  }, [])

  const createDoc = async (path: string, where: OpenTarget) => {
    try {
      await api.create(path, `# ${titleFromPath(path)}\n\n`)
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'exists')) {
        console.error(`emditor: cannot create ${path}`, err)
        setToast(err instanceof ApiError && err.code === 'not-found' ? 'That folder does not exist.' : `Cannot create ${path}.`)
        return
      }
    }
    await refresh()
    openDoc(path, where)
  }

  const openPalette = useCallback((target: OpenTarget) => {
    const title = typeof target === 'number' ? `Open in pane ${target + 1}` : 'Open in the focused pane'
    setPalette({ target, title })
  }, [])

  const switchView = useCallback((next: View) => {
    setView(next)
    if (next === 'desk') void refresh()
    else setFocusSignal((n) => n + 1)
  }, [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const code = e.code
      if (e.metaKey && !e.altKey && code === 'KeyK') {
        e.preventDefault()
        openPalette('focused')
        return
      }
      if (e.metaKey && code === 'KeyS') {
        e.preventDefault()
        window.dispatchEvent(new Event(SAVE_ALL_EVENT))
        return
      }
      if (palette) return
      if (shortcuts) {
        if (e.key === 'Escape' || (e.altKey && code === 'Slash')) {
          e.preventDefault()
          setShortcuts(false)
        }
        return
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const digit = /^Digit(\d)$/.exec(code)
        if (digit) {
          e.preventDefault()
          const n = Number(digit[1])
          if (n === 0) switchView(view === 'desk' ? 'work' : 'desk')
          else if (LAYOUTS[n - 1]) {
            dispatch({ type: 'layout', id: LAYOUTS[n - 1].id })
            switchView('work')
          }
        } else if (code === 'KeyL') {
          e.preventDefault()
          dispatch({ type: 'lock' })
        } else if (code === 'KeyW' && view === 'work') {
          e.preventDefault()
          dispatch({ type: 'close', index: work.focus })
          bumpFocus()
        } else if (code === 'Slash') {
          e.preventDefault()
          setShortcuts(true)
        } else if (code === 'KeyN') {
          e.preventDefault()
          openPalette('focused')
        }
        return
      }
      if (e.metaKey && code === 'Slash' && view === 'work') {
        e.preventDefault()
        dispatch({ type: 'toggleMode' })
        bumpFocus()
        return
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && view === 'work' && PANE_KEYS[code]) {
        e.preventDefault()
        e.stopPropagation()
        dispatch({ type: e.shiftKey ? 'moveDir' : 'focusDir', dir: PANE_KEYS[code] })
        bumpFocus()
        return
      }
      if (e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault()
        setShortcuts(true)
      }
    }
    // Capture phase, so that the editors do not take these keys first.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [palette, shortcuts, view, work.focus, openPalette, switchView])

  useEffect(() => {
    const onType = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return
      if ((e.target as HTMLElement).closest?.('.pane-scroll')) setQuiet(true)
    }
    const onMove = () => setQuiet(false)
    window.addEventListener('keydown', onType)
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('keydown', onType)
      window.removeEventListener('mousemove', onMove)
    }
  }, [])

  const hasDocs = work.panes.some((p) => p.path)

  return (
    <div className="app" data-quiet={quiet && view === 'work'}>
      <header className="topbar chrome">
        <div className="topbar-left">
          <span className="brand-seal" aria-hidden />
          <span className="root-name" title={listing.path}>
            {listing.root}
          </span>
        </div>
        <Segmented
          id="view"
          value={view}
          onChange={switchView}
          options={[
            { value: 'desk', label: 'Desk', title: 'Desk (⌥0)' },
            { value: 'work', label: 'Workspace', title: 'Workspace (⌥0)' },
          ]}
        />
        <div className="topbar-right">
          <AnimatePresence initial={false}>
            {view === 'work' && (
              <motion.div className="tool-group" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}>
                <LayoutPicker value={work.layout} onChange={(id) => dispatch({ type: 'layout', id })} />
                <button
                  className="icon-btn lock-btn"
                  data-on={work.lock}
                  onClick={() => dispatch({ type: 'lock' })}
                  title={work.lock ? 'Scroll lock is on (⌥L)' : 'Lock scroll of all panes (⌥L)'}
                  aria-pressed={work.lock}
                >
                  <LockIcon locked={work.lock} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <button className="icon-btn" onClick={() => setShortcuts(true)} title="Keyboard shortcuts (⌥/)" aria-label="Keyboard shortcuts">
            <span className="qmark">?</span>
          </button>
        </div>
      </header>

      <main className="stage">
        <div className="work-layer" inert={view === 'desk'}>
          <Workspace work={work} dispatch={dispatch} focusSignal={focusSignal} onPick={(i) => openPalette(i)} />
        </div>
        <AnimatePresence>
          {view === 'desk' && (
            <motion.div
              className="desk-layer"
              initial={{ opacity: 0, scale: 1.012 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.012 }}
              transition={{ duration: 0.28, ease: [0.2, 0.7, 0.1, 1] }}
            >
              <Desk
                listing={listing}
                items={items}
                desk={desk}
                setDesk={setDesk}
                active={!palette && !shortcuts}
                openPaths={openPaths}
                onOpen={openDoc}
                onOpenMany={openMany}
                onNew={() => openPalette('slot')}
                onBack={() => hasDocs && switchView('work')}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {palette && (
          <Palette
            files={listing.files}
            title={palette.title}
            onOpen={(path, newPane) => openDoc(path, newPane ? 'new' : palette.target)}
            onCreate={(path, newPane) => {
              setPalette(null)
              void createDoc(path, newPane ? 'new' : palette.target)
            }}
            onClose={() => {
              setPalette(null)
              bumpFocus()
            }}
          />
        )}
        {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

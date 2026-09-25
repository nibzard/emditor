// ABOUTME: Root of the emditor web app: loads the folder, then shows the desk and the workspace.
// ABOUTME: It owns the global keyboard shortcuts, the palette, and state kept per folder.

import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { api, ApiError, type Listing } from './api'
import { Desk, isTypingTarget } from './components/Desk'
import { DocumentNavigation } from './components/DocumentNavigation'
import { Enso } from './components/Enso'
import { BackIcon, DarkThemeIcon, ExitFocusIcon, FocusIcon, LightThemeIcon, LockIcon, NewDocumentIcon, OpenBesideIcon, SearchIcon, ShortcutsIcon, SidebarIcon, SystemThemeIcon, ZoomInIcon, ZoomOutIcon } from './components/icons'
import { LayoutPicker } from './components/LayoutPicker'
import { NewDocument } from './components/NewDocument'
import { Palette } from './components/Palette'
import { Shortcuts } from './components/Shortcuts'
import { Workspace } from './components/Workspace'
import { DocumentProvider, useDocumentProblems, useDocumentStore } from './hooks/useDocument'
import { readStored, useStoredState } from './hooks/useStoredState'
import { useTheme } from './hooks/useTheme'
import { buildDesk, type DeskState, EMPTY_DESK } from './lib/desk'
import { type Direction, LAYOUTS } from './lib/layouts'
import { titleFromPath } from './lib/text'
import { nextTheme, type ThemeChoice } from './lib/theme'
import { zoomLabel, zoomStep } from './lib/zoom'
import { initialWork, type OpenTarget, type Work, workReducer } from './lib/workspace'

type View = 'desk' | 'work'

const PANE_KEYS: Record<string, Direction> = { KeyH: 'left', KeyJ: 'down', KeyK: 'up', KeyL: 'right' }

const THEME_LABEL: Record<ThemeChoice, string> = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }

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
  return <DocumentProvider key={listing.path} root={listing.path}><Main initialListing={listing} /></DocumentProvider>
}

function startWork(listing: Listing): Work {
  const stored = readStored<Work | null>(`emditor.work:${listing.path}`, null)
  const restored = Boolean(stored && Array.isArray(stored.panes) && stored.panes.length > 0)
  let work = restored ? stored! : initialWork()
  work = workReducer(work, { type: 'prune', existing: listing.files.map((f) => f.path) })
  const fromUrl = new URLSearchParams(location.search).get('file')
  if (fromUrl && listing.files.some((f) => f.path === fromUrl)) {
    work = workReducer(work, { type: 'open', path: fromUrl, where: 'slot' })
  } else if (!restored && listing.files.length > 0) {
    const recent = listing.files.reduce((latest, file) => file.modified > latest.modified ? file : latest)
    work = workReducer(work, { type: 'open', path: recent.path, where: 'slot' })
  }
  return work
}

function Main({ initialListing }: { initialListing: Listing }) {
  const [listing, setListing] = useState(initialListing)
  const root = listing.path
  const [desk, setDesk] = useStoredState<DeskState>(`emditor.desk:${root}`, EMPTY_DESK)
  const [work, dispatch] = useReducer(workReducer, initialListing, startWork)
  const [view, setView] = useState<View>('work')
  const [showDocuments, setShowDocuments] = useStoredState(`emditor.documents${window.matchMedia('(max-width: 580px)').matches ? '.mobile' : ''}:${root}`, !window.matchMedia('(max-width: 580px)').matches)
  const [focusMode, setFocusMode] = useState(false)
  const [zoom, setZoom] = useStoredState(`emditor.zoom:${root}`, 1)
  const [showNotes, setShowNotes] = useStoredState('emditor.notes', true)
  const { choice: themeChoice, setChoice: setThemeChoice } = useTheme()
  const [palette, setPalette] = useState<{ target: OpenTarget; title: string } | null>(null)
  const [newDialog, setNewDialog] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [focusSignal, setFocusSignal] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const problems = useDocumentProblems()
  const documentStore = useDocumentStore()
  const [searchTarget, setSearchTarget] = useState<{ path: string; line: number; id: number } | null>(null)

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
  const focusedPath = work.panes[work.focus]?.path ?? null

  useEffect(() => {
    document.title = view === 'work' && focusedPath ? `${titleFromPath(focusedPath)} — emditor` : `${listing.root} — emditor`
  }, [view, focusedPath, listing.root])

  const bumpFocus = () => setFocusSignal((n) => n + 1)

  const openDoc = useCallback((path: string, where: OpenTarget) => {
    setSearchTarget(null)
    if (where === 'new' && work.panes.filter((pane) => pane.path).length >= 6) {
      setToast('Six documents are open. Close one before opening another beside it.')
      return
    }
    dispatch({ type: 'open', path, where })
    setView('work')
    setPalette(null)
    if (window.matchMedia('(max-width: 580px)').matches) setShowDocuments(false)
    setFocusSignal((n) => n + 1)
  }, [work.panes, setShowDocuments])

  const openMany = useCallback((paths: string[]) => {
    dispatch({ type: 'openMany', paths })
    if (paths.length > 6) setToast('Opened the first six documents. The others are still available in the stack.')
    setView('work')
    setFocusSignal((n) => n + 1)
  }, [])

  const createDoc = async (path: string): Promise<string | null> => {
    try {
      await api.create(path, `# ${titleFromPath(path)}\n\n`)
    } catch (err) {
      console.error(`emditor: cannot create ${path}`, err)
      if (err instanceof ApiError && err.code === 'exists') return 'A document with that name already exists.'
      return err instanceof ApiError && err.code === 'not-found' ? 'That folder does not exist.' : `Cannot create ${path}.`
    }
    await refresh()
    setNewDialog(false)
    openDoc(path, 'slot')
    return null
  }

  const openPalette = useCallback((target: OpenTarget) => {
    const title = target === 'new' ? 'Open beside this document' : typeof target === 'number' ? `Open in pane ${target + 1}` : 'Find a document'
    setNewDialog(false)
    setShortcuts(false)
    setPalette({ target, title })
  }, [])

  const openNew = useCallback(() => {
    setPalette(null)
    setShortcuts(false)
    setNewDialog(true)
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
        window.dispatchEvent(new Event('emditor:save-all'))
        return
      }
      if (e.metaKey && !e.altKey && !e.ctrlKey && view === 'work' && (code === 'Equal' || code === 'Minus' || code === 'Digit0')) {
        // Zoom the paper, not the whole page with the app controls.
        e.preventDefault()
        setZoom((current) => code === 'Digit0' ? 1 : zoomStep(current, code === 'Equal' ? 1 : -1))
        return
      }
      if (palette || newDialog || shortcuts) return
      if (e.key === 'Escape' && focusMode && view === 'work' && !(e.target instanceof HTMLInputElement)) {
        setFocusMode(false)
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
        } else if (code === 'KeyM' && view === 'work') {
          e.preventDefault()
          setShowNotes((current) => !current)
        } else if (code === 'KeyF' && view === 'work') {
          e.preventDefault()
          setFocusMode((current) => !current)
        } else if (code === 'KeyW' && view === 'work') {
          e.preventDefault()
          dispatch({ type: 'close', index: work.focus })
          bumpFocus()
        } else if (code === 'Slash') {
          e.preventDefault()
          setShortcuts(true)
        } else if (code === 'KeyN') {
          e.preventDefault()
          openNew()
        } else if (code === 'KeyT') {
          e.preventDefault()
          setThemeChoice(nextTheme)
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
  }, [palette, newDialog, shortcuts, focusMode, view, work.focus, openPalette, openNew, switchView, setZoom, setThemeChoice, setShowNotes])

  const hasDocs = work.panes.some((p) => p.path)

  return (
    <div className="app" data-focus={focusMode && view === 'work'}>
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn" data-tip={view === 'desk' ? 'Back to writing ⌥0' : 'Documents'}
            aria-label={view === 'desk' ? 'Back to writing' : 'Documents'} onClick={() => {
            if (view === 'desk') switchView('work')
            else { setFocusMode(false); setShowDocuments((current) => !current) }
          }} aria-expanded={view === 'work' ? showDocuments && !focusMode : undefined}>
            {view === 'desk' ? <BackIcon /> : <SidebarIcon />}
          </button>
          <span className="brand-seal" aria-hidden />
          <span className="root-name" title={listing.path}>
            {listing.root}
          </span>
        </div>
        <div className="topbar-right">
          <AnimatePresence initial={false}>
            {view === 'work' && (
              <motion.div className="tool-group" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}>
                {hasDocs && work.panes.filter((pane) => pane.path).length < 6 && <button className="icon-btn" onClick={() => openPalette('new')}
                  data-tip="Open beside" aria-label="Open beside…"><OpenBesideIcon /></button>}
                <LayoutPicker value={work.layout} onChange={(id) => dispatch({ type: 'layout', id })} />
                {work.panes.length > 1 && <button className="icon-btn lock-btn" data-on={work.lock}
                  onClick={() => dispatch({ type: 'lock' })} data-tip="Scroll together ⌥L" aria-label="Scroll together" aria-pressed={work.lock}>
                  <LockIcon locked={work.lock} />
                </button>}
                <button className="icon-btn" onClick={() => { setFocusMode((current) => !current); bumpFocus() }} aria-pressed={focusMode}
                  data-tip={focusMode ? 'Exit focus ⌥F' : 'Focus ⌥F'} aria-label={focusMode ? 'Exit focus' : 'Focus'}>
                  {focusMode ? <ExitFocusIcon /> : <FocusIcon />}
                </button>
                <span className="tool-divider" aria-hidden />
                <button className="icon-btn" onClick={() => setZoom((current) => zoomStep(current, -1))} data-tip="Zoom out ⌘−" aria-label="Zoom out"><ZoomOutIcon /></button>
                <button className="zoom-level" onClick={() => setZoom(1)} data-tip="Actual size ⌘0" aria-label={`Zoom ${zoomLabel(zoom)}, reset to actual size`}>{zoomLabel(zoom)}</button>
                <button className="icon-btn" onClick={() => setZoom((current) => zoomStep(current, 1))} data-tip="Zoom in ⌘=" aria-label="Zoom in"><ZoomInIcon /></button>
                <span className="tool-divider" aria-hidden />
              </motion.div>
            )}
          </AnimatePresence>
          <button className="icon-btn" onClick={() => openPalette('focused')} data-tip="Find ⌘K" aria-label="Find"><SearchIcon /></button>
          <button className="icon-btn" onClick={openNew} data-tip="New document ⌥N" aria-label="New document"><NewDocumentIcon /></button>
          <button className="icon-btn" onClick={() => setThemeChoice(nextTheme)} data-tip={`${THEME_LABEL[themeChoice]} ⌥T`} aria-label={THEME_LABEL[themeChoice]}>
            {themeChoice === 'dark' ? <DarkThemeIcon /> : themeChoice === 'light' ? <LightThemeIcon /> : <SystemThemeIcon />}
          </button>
          <button className="icon-btn" onClick={() => setShortcuts(true)} data-tip="Keyboard shortcuts ?" aria-label="Keyboard shortcuts">
            <ShortcutsIcon />
          </button>
        </div>
      </header>

      <main className="stage">
        <div className="work-layer" inert={view === 'desk' || Boolean(palette || newDialog || shortcuts)}>
          {view === 'work' && showDocuments && !focusMode && <DocumentNavigation files={listing.files} openPaths={openPaths}
            focusedPath={focusedPath} shelf={work.shelf} problems={problems} onOpen={(path) => openDoc(path, 'slot')}
            onDesk={() => switchView('desk')} />}
          <div className="workspace-region" style={{ '--paper-zoom': zoom } as CSSProperties}>
            {problems.length > 0 && view === 'work' && <div className="document-problems" role="alert">
              <span>{problems.length === 1 ? `${titleFromPath(problems[0].path)} needs attention.` : `${problems.length} documents need attention.`} Your draft is kept here.</span>
              <button className="text-btn" onClick={() => openDoc(problems[0].path, 'slot')}>Open draft</button>
            </div>}
            <Workspace work={work} dispatch={dispatch} focusSignal={focusSignal} searchTarget={searchTarget} onPick={(i) => openPalette(i)} onSplit={(path) => openDoc(path, 'new')}
              showNotes={showNotes} onShowNotes={setShowNotes} />
          </div>
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
                active={!palette && !newDialog && !shortcuts}
                openPaths={openPaths}
                onOpen={openDoc}
                onOpenMany={openMany}
                onNew={openNew}
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
            drafts={documentStore.searchableDrafts()}
            title={palette.title}
            onOpen={(path, newPane, line) => {
              if (line) {
                const where = newPane ? 'new' : palette.target
                if (where === 'new' && work.panes.filter((pane) => pane.path).length >= 6) {
                  setToast('Six documents are open. Close one before opening another beside it.')
                  return
                }
                dispatch({ type: 'openMatch', path, where })
                setSearchTarget({ path, line, id: Date.now() })
                setView('work')
                setPalette(null)
                if (window.matchMedia('(max-width: 580px)').matches) setShowDocuments(false)
              } else openDoc(path, newPane ? 'new' : palette.target)
            }}
            onClose={() => {
              setPalette(null)
              bumpFocus()
            }}
          />
        )}
        {newDialog && <NewDocument files={listing.files} onCreate={createDoc} onClose={() => setNewDialog(false)} />}
        {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

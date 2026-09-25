// ABOUTME: An A4 sheet that scales with its container and grows by whole pages.
// ABOUTME: It draws page breaks and page numbers, prints as real A4 pages, and can hold margin notes beside it.

import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

const A4_RATIO = 297 / 210

type Props = { children: ReactNode; onPages?: (pages: number) => void; /** Content beside the sheet, such as margin notes. */ aside?: ReactNode }

export function Paper({ children, onPages, aside }: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState({ pageHeight: 0, pages: 1 })
  const onPagesRef = useRef(onPages)
  onPagesRef.current = onPages

  useLayoutEffect(() => {
    const frame = frameRef.current!
    const paper = paperRef.current!
    const content = contentRef.current!
    const measure = () => {
      const pageHeight = frame.clientWidth * A4_RATIO
      if (!pageHeight) return
      const style = getComputedStyle(paper)
      const needed = content.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const pages = Math.max(1, Math.ceil((needed - 1) / pageHeight))
      setMetrics((m) => (m.pageHeight === pageHeight && m.pages === pages ? m : { pageHeight, pages }))
      onPagesRef.current?.(pages)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    observer.observe(content)
    measure()
    return () => observer.disconnect()
  }, [])

  const { pageHeight, pages } = metrics
  return (
    <div className="paper-frame" ref={frameRef}>
      <div className="paper" ref={paperRef} style={{ minHeight: pageHeight ? pages * pageHeight : undefined }}>
        <div className="paper-content" ref={contentRef}>
          {children}
        </div>
        {pageHeight > 0 &&
          Array.from({ length: pages }, (_, i) => (
            <Fragment key={i}>
              {i > 0 && <div className="page-break" style={{ top: i * pageHeight }} aria-hidden />}
              <span className="folio" style={{ top: (i + 1) * pageHeight }} aria-hidden>
                {i + 1}
              </span>
            </Fragment>
          ))}
      </div>
      {aside}
    </div>
  )
}

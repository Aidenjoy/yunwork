/**
 * 云大师 Agent brand components occupying the sidebar and blank-home identity slots,
 * 1:1 aligned with `uwork/packages/client/ui-brand-yundashi`.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'

export const BRAND_NAME = '云大师 Agent'
export const BRAND_COLOR = '#2D97D3'

function YundashiMarkSvg ({ size, className }: { readonly size: number; readonly className?: string }) {
  const gradId = useId()
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      style={{ display: 'block', width: size, height: size, flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0.25">
          <stop offset="0.00" stopColor="#1C6BB4" />
          <stop offset="0.20" stopColor="#1D6EB6" />
          <stop offset="0.50" stopColor="#2C8ACA" />
          <stop offset="0.80" stopColor="#34A0D9" />
          <stop offset="1.00" stopColor="#40B2E5" />
        </linearGradient>
      </defs>
      <g transform="matrix(1 0 0 1 0.35 0.65)">
        <path
          d="M 23.98 38.4 C 25.39 38.3, 28.09 38.22, 29.61 38.32 C 31.13 38.42, 31.95 38.67, 33.13 39.01 C 34.3 39.34, 35.35 39.67, 36.64 40.35 C 37.93 41.04, 38.75 41.26, 40.86 43.11 C 42.97 44.97, 47.69 50.15, 49.3 51.48 C 50.91 52.8, 48.99 52.45, 50.51 51.05 C 52.03 49.66, 56.41 44.9, 58.44 43.11 C 60.46 41.33, 61.37 41.04, 62.66 40.35 C 63.95 39.67, 64.88 39.36, 66.17 39.01 C 67.46 38.65, 69.1 38.37, 70.39 38.23 C 71.68 38.1, 72.62 38.09, 73.91 38.2 C 75.2 38.31, 76.84 38.55, 78.13 38.88 C 79.41 39.22, 80.59 39.72, 81.64 40.19 C 82.7 40.67, 83.28 40.85, 84.45 41.74 C 85.63 42.64, 87.49 44.23, 88.67 45.55 C 89.86 46.87, 90.83 48.38, 91.57 49.65 C 92.32 50.92, 92.73 51.88, 93.13 53.16 C 93.53 54.45, 93.83 55.86, 93.97 57.38 C 94.12 58.91, 94.13 60.78, 94 62.3 C 93.86 63.83, 93.56 65.23, 93.19 66.52 C 92.81 67.81, 92.48 68.72, 91.73 70.04 C 90.98 71.36, 89.8 73.18, 88.67 74.47 C 87.54 75.75, 86.25 76.84, 84.97 77.77 C 83.68 78.7, 82.43 79.42, 80.94 80.04 C 79.45 80.67, 78.01 81.26, 76.02 81.51 C 74.02 81.76, 70.74 81.67, 68.98 81.54 C 67.23 81.42, 66.52 81.09, 65.47 80.76 C 64.41 80.42, 63.91 80.27, 62.66 79.53 C 61.41 78.8, 60.08 78.22, 57.97 76.37 C 55.86 74.51, 51.49 69.71, 50 68.42 C 48.51 67.13, 50.81 67.05, 49.05 68.63 C 47.29 70.22, 41.99 75.91, 39.45 77.93 C 36.92 79.95, 35.47 80.14, 33.83 80.76 C 32.19 81.38, 31.13 81.48, 29.61 81.63 C 28.09 81.78, 26.21 81.8, 24.69 81.67 C 23.16 81.54, 21.76 81.25, 20.47 80.87 C 19.18 80.5, 18.36 80.23, 16.95 79.41 C 15.55 78.58, 13.6 77.48, 12.03 75.92 C 10.47 74.36, 8.66 72.07, 7.57 70.04 C 6.47 68, 5.81 66.05, 5.46 63.71 C 5.12 61.37, 5.38 57.73, 5.5 55.98 C 5.62 54.22, 5.8 54.22, 6.17 53.16 C 6.54 52.11, 7.26 50.59, 7.72 49.65 C 8.19 48.71, 8.25 48.46, 8.97 47.54 C 9.68 46.62, 11.05 45.07, 12.03 44.1 C 13.01 43.14, 13.91 42.4, 14.84 41.74 C 15.78 41.09, 16.6 40.67, 17.66 40.19 C 18.71 39.72, 20.12 39.18, 21.17 38.88 C 22.23 38.58, 22.58 38.49, 23.98 38.4 Z M 26.8 49.6 C 25.63 49.62, 24.57 49.59, 23.28 50.19 C 21.99 50.79, 20.05 52.24, 19.06 53.2 C 18.07 54.17, 17.75 54.81, 17.34 55.98 C 16.92 57.14, 16.56 58.79, 16.59 60.2 C 16.62 61.6, 16.92 63.13, 17.52 64.41 C 18.13 65.7, 19.25 67.05, 20.21 67.93 C 21.17 68.81, 22.07 69.29, 23.28 69.69 C 24.5 70.1, 26.21 70.36, 27.5 70.35 C 28.79 70.33, 30.2 69.85, 31.02 69.6 C 31.84 69.35, 30.71 70.4, 32.42 68.83 C 34.13 67.26, 39.87 61.8, 41.28 60.2 C 42.68 58.59, 42.22 60.61, 40.86 59.18 C 39.5 57.74, 34.88 53.11, 33.13 51.6 C 31.37 50.09, 31.37 50.44, 30.31 50.11 C 29.26 49.78, 27.97 49.59, 26.8 49.6 Z M 71.8 49.63 C 70.63 49.62, 69.92 49.78, 68.98 50.11 C 68.05 50.44, 67.93 50.09, 66.17 51.6 C 64.41 53.11, 59.8 57.74, 58.44 59.18 C 57.08 60.61, 56.61 58.59, 58.02 60.2 C 59.43 61.8, 64.81 67.17, 66.88 68.83 C 68.94 70.5, 69.34 69.94, 70.39 70.19 C 71.45 70.44, 72.15 70.46, 73.2 70.33 C 74.26 70.21, 75.51 70.07, 76.72 69.43 C 77.93 68.8, 79.52 67.71, 80.48 66.52 C 81.44 65.34, 82.11 63.59, 82.47 62.3 C 82.83 61.02, 82.86 60.08, 82.65 58.79 C 82.45 57.5, 81.89 55.74, 81.23 54.57 C 80.57 53.4, 79.58 52.49, 78.71 51.76 C 77.84 51.03, 77.17 50.54, 76.02 50.19 C 74.86 49.83, 72.97 49.65, 71.8 49.63 Z"
          fillRule="evenodd"
          fill={`url(#${gradId})`}
        />
        <path
          d="M 46.48 17.29 C 45.75 17.4, 41.76 18.2, 40.86 18.55 C 39.96 18.9, 35.33 21.37, 34.53 21.96 C 33.73 22.55, 30.71 25.78, 30.24 26.45 C 29.77 27.11, 27.99 30.41, 28.2 30.82 C 28.42 31.23, 32.44 31.65, 33.13 31.86 C 33.81 32.08, 36.82 33.79, 37.34 33.69 C 37.87 33.59, 39.73 30.94, 40.16 30.53 C 40.58 30.13, 42.55 28.59, 42.97 28.32 C 43.39 28.06, 45.31 27.14, 45.78 26.99 C 46.26 26.84, 48.72 26.3, 49.3 26.3 C 49.88 26.3, 52.99 26.84, 53.52 26.99 C 54.04 27.14, 55.91 28.06, 56.33 28.32 C 56.75 28.59, 58.72 30.13, 59.14 30.53 C 59.56 30.94, 61.43 33.59, 61.95 33.69 C 62.48 33.79, 65.48 32.09, 66.17 31.86 C 66.87 31.64, 71.09 31.18, 71.22 30.66 C 71.36 30.15, 68.41 25.69, 67.92 25.04 C 67.44 24.39, 65.27 22.35, 64.77 21.96 C 64.27 21.56, 61.94 20.11, 61.25 19.79 C 60.56 19.48, 56.42 17.92, 55.63 17.71 C 54.83 17.51, 51.39 17.11, 50.7 17.08 C 50.02 17.05, 47.22 17.18, 46.48 17.29 Z"
          fill="#4ABFD3"
        />
      </g>
    </svg>
  )
}

export function BrandMark ({ size = 24 }: { readonly size?: number }) {
  return <YundashiMarkSvg size={size} />
}

export function BrandName () {
  return (
    <span
      data-brand-name=""
      style={{ color: BRAND_COLOR, fontWeight: 600, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}
    >
      {BRAND_NAME}
    </span>
  )
}

export function HeroMark ({ size = 36, className }: { readonly size?: number; readonly className?: string }) {
  return <YundashiMarkSvg size={size} className={className} />
}

export function BrandFrame ({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const root = ref.current
    if (root === null) return
    const replaceHeroText = (): void => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node !== null) {
        const text = node.textContent
        if (text === '探索未至之境') node.textContent = 'AI 数字员工'
        else if (text === '预览版') node.textContent = '云大师 Agent'
        else if (text === 'Explore the Unknown') node.textContent = 'AI Digital Employee'
        else if (text === 'Preview') node.textContent = 'Yundashi Agent'
        node = walker.nextNode()
      }
    }
    replaceHeroText()
    const observer = new MutationObserver(replaceHeroText)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect() }
  }, [])
  return <div ref={ref} style={{ display: 'contents' }}>{children}</div>
}

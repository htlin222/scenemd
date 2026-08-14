import { useEffect, useRef } from 'react'

/**
 * Focus management for custom modals (#14).
 *
 * Chosen over native dialog.showModal(): showModal would give trapping for
 * free but moves every dialog into the browser top layer, changing stacking
 * and backdrop behavior across the app at once. This hook adds the two
 * behaviors a modal owes the keyboard — focus moves in on open and is
 * restored on close, and Tab cycles inside — without altering rendering.
 *
 * Mark the element that should receive initial focus with `data-autofocus`;
 * otherwise the first focusable element (usually the close button) gets it.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useModalFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const initial = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE)
    initial?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => element.getClientRects().length > 0)
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const current = document.activeElement
      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus()
    }
  }, [])

  return ref
}

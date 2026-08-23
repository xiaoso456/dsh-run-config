/**
 * Shared transient-toast hook over the official `Toast` primitive (top-center
 * banner: slides in, holds 3s, fades out, then unmounts). The owner calls
 * `show(text, icon?)` from event handlers; re-showing restarts the cycle via
 * a per-show key. Rendered wherever the caller mounts it (Toast portals to
 * document.body itself).
 * @module @xiaoso/dsh-run-config/client/useToast
 */

import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

interface ToastState {
  seq: number
  text: string
  icon?: ReactNode
}

export interface UseToast {
  /** Mount this node (typically at the component root) to render toasts. */
  node: ReactNode
  /** Show a transient toast; re-showing restarts the cycle. */
  show: (text: string, icon?: ReactNode) => void
}

/** Manage one transient `Toast` per component. */
export function useToast(): UseToast {
  const [toast, setToast] = useState<ToastState | undefined>(undefined)
  const seqRef = useRef(0)

  return {
    node:
      toast === undefined ? null : (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={toast.icon}
          onDone={() => {
            setToast(undefined)
          }}
        />
      ),
    show: (text, icon) => {
      seqRef.current += 1
      setToast({ seq: seqRef.current, text, icon })
    },
  }
}

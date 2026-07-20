import type { ReactNode } from 'react'

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: {
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-1/40 px-4">
      <div className="bg-white border border-line rounded-xl3 max-w-md w-full p-5 shadow-none">
        <h3 className="text-[16px] font-extrabold text-ink-1 mb-3">{title}</h3>
        <div className="text-[13px] text-ink-2 mb-5">{body}</div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl2 px-3.5 py-2 text-xs font-bold text-ink-2 border border-line hover:bg-surface-1 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-xl2 px-3.5 py-2 text-xs font-bold bg-bosch-red text-white disabled:opacity-50"
          >
            {busy ? 'Recording…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

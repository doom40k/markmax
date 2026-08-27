import { useEffect } from 'react'

interface Props {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
}

/** 自定义确认弹窗：替代 window.confirm。Escape / 点遮罩取消。 */
export function ConfirmDialog({
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-lg bg-white p-4 shadow-xl sm:p-6"
        role="dialog"
        aria-modal="true"
      >
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-2 text-sm leading-relaxed text-[#666]">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            autoFocus
            className="rounded-md border border-[#d4d4d4] px-4 py-1.5 text-sm text-[#666] transition-colors hover:border-black hover:text-black"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-black px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#333]"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

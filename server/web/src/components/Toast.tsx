export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="fixed bottom-5 left-5 z-50 rounded-md bg-black px-4 py-2.5 font-mono text-xs text-white shadow-lg">
      {message}
    </div>
  )
}

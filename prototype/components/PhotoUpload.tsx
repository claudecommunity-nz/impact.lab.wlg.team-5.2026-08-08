'use client'

import { useRef, useState } from 'react'

export interface StagedPhoto {
  key: string
  name: string
  dataUrl: string
}

interface PhotoUploadProps {
  photos: StagedPhoto[]
  onChange: (photos: StagedPhoto[]) => void
}

// Photos are downscaled in the browser before they go anywhere. On a phone in a
// storm, on whatever signal is left, sending a 6MB original is how a report
// fails to arrive at all.

const MAX_EDGE = 1200
const MAX_PHOTOS = 4
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png']

function downscale(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not decode the image'))
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.6))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export default function PhotoUpload({ photos, onChange }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleFiles(fileList: FileList | null): Promise<void> {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setError(null)

    if (files.some((f) => !ALLOWED.includes(f.type))) {
      setError('Only jpg, jpeg or png files are allowed.')
      return
    }
    if (photos.length + files.length > MAX_PHOTOS) {
      setError(`You can attach up to ${MAX_PHOTOS} photos.`)
      return
    }

    setBusy(true)
    try {
      const added: StagedPhoto[] = []
      for (const file of files) {
        const dataUrl = await downscale(file)
        added.push({
          key: `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '-')}`,
          name: file.name,
          dataUrl,
        })
      }
      onChange([...photos, ...added])
    } catch {
      setError('An error occurred when preparing the images. Please try a different photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <span className="label">
        Photos <span className="font-normal text-council-ink/50">(optional, up to {MAX_PHOTOS})</span>
      </span>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          handleFiles(e.dataTransfer.files)
        }}
        className="cursor-pointer rounded border-2 border-dashed border-council-line bg-white p-6 text-center hover:border-council-accent"
      >
        <p className="font-semibold">
          {busy ? 'Preparing photos…' : 'Drag and drop photos here, or click to select photos'}
        </p>
        <p className="mt-1 hint">jpg or png. Large photos are shrunk before sending.</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {error && <p className="error">{error}</p>}

      {photos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {photos.map((photo) => (
            <li key={photo.key} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.dataUrl}
                alt={photo.name}
                className="h-24 w-24 rounded border border-council-line object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(photos.filter((p) => p.key !== photo.key))}
                className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-council-ink text-sm font-bold text-white"
                aria-label={`Remove ${photo.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

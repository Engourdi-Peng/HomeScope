import { useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { X, Image, Building } from 'lucide-react';
import type { Photo } from '../types';

interface PhotoUploaderProps {
  photos: Photo[];
  onPhotosChange: (photos: Photo[]) => void;
}

export function PhotoUploader({ photos, onPhotosChange }: PhotoUploaderProps) {
  const addPhotos = useCallback(
    (files: File[]) => {
      const newPhotos = files.slice(0, 10 - photos.length).map((file) => ({
        id: Math.random().toString(36).substring(7),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      onPhotosChange([...photos, ...newPhotos].slice(0, 10));
    },
    [photos, onPhotosChange]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      addPhotos(acceptedFiles);
    },
    [addPhotos]
  );

  // Paste from clipboard handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        addPhotos(imageFiles);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [addPhotos]);

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
    },
    maxFiles: 10 - photos.length,
    disabled: photos.length >= 10,
  });

  const removePhoto = (id: string) => {
    const photo = photos.find((p) => p.id === id);
    if (photo) {
      URL.revokeObjectURL(photo.previewUrl);
    }
    onPhotosChange(photos.filter((p) => p.id !== id));
  };

  return (
    <div className="flex flex-col h-full group">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-widest text-stone-800 flex items-center gap-2">
          <Image size={14} className="text-stone-400" /> Architecture & Space
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-stone-400">{photos.length} Files</span>
      </div>
      
      <label className="flex-1 relative flex flex-col p-4 bg-stone-50/40 border border-stone-200/80 rounded-3xl cursor-pointer hover:bg-stone-50/80 hover:border-stone-300 transition-all duration-500 overflow-hidden">
        <input {...getRootProps()} className="hidden" />
        <input {...getInputProps()} />

        {/* Main paste area - chat-like input */}
        <div
          className="flex-1 flex flex-col bg-white border-2 border-stone-200 rounded-2xl hover:border-stone-400 focus-within:border-stone-500 focus-within:ring-2 focus-within:ring-stone-100 transition-all duration-300"
          onClick={() => {
            const textarea = document.getElementById('paste-input');
            textarea?.focus();
          }}
        >
          <textarea
            id="paste-input"
            className="flex-1 w-full p-3 resize-none outline-none text-sm text-stone-700 placeholder:text-stone-400 bg-transparent"
            placeholder="Paste images here (Ctrl+V)"
            onPaste={(e) => {
              e.preventDefault();
              const items = e.clipboardData?.items;
              if (!items) return;

              const imageFiles: File[] = [];
              for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                  const file = items[i].getAsFile();
                  if (file) {
                    imageFiles.push(file);
                  }
                }
              }

              if (imageFiles.length > 0) {
                addPhotos(imageFiles);
              }
            }}
          />
        </div>

        {/* Decorative faint house icon in background */}
        <Building size={160} className="absolute text-stone-200/30 -bottom-8 -right-8 pointer-events-none transition-transform duration-700 group-hover:scale-110 group-hover:-translate-y-2 group-hover:-translate-x-2" strokeWidth={0.5} />
      </label>

      {photos.length > 0 && (
        <div className="mt-4">
          <div className="grid grid-cols-4 gap-2">
            {photos.map((photo) => (
              <div key={photo.id} className="relative group">
                <img
                  src={photo.previewUrl}
                  alt="Preview"
                  className="w-full h-20 object-cover rounded-xl"
                />
                <button
                  onClick={() => removePhoto(photo.id)}
                  className="absolute top-1 right-1 bg-stone-900/80 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-stone-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-stone-400 mt-3 font-light">
        Recommended: Kitchen, Bathroom, Living room, Bedroom (Max 10 photos used)
      </p>
    </div>
  );
}

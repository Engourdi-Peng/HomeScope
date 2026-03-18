import React, { useCallback, useEffect, useRef } from 'react';
import { Image, X } from 'lucide-react';
import type { Photo } from '../types';

interface DescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  photos?: Photo[];
  onPhotosChange?: (photos: Photo[]) => void;
}

export function DescriptionInput({ value, onChange, photos = [], onPhotosChange }: DescriptionInputProps) {
  const addPhotos = useCallback(
    (files: File[]) => {
      if (!onPhotosChange) return;
      const newPhotos = files.slice(0, 8 - photos.length).map((file) => ({
        id: Math.random().toString(36).substring(7),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      onPhotosChange([...photos, ...newPhotos].slice(0, 8));
    },
    [photos, onPhotosChange]
  );

  // Paste handler for images
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onPhotosChange) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      // Check if any images are being pasted
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      // Only prevent default and handle if there are images
      if (imageFiles.length > 0) {
        e.preventDefault();
        addPhotos(imageFiles);
      }
      // If no images, let default paste behavior happen (insert text)
    },
    [addPhotos, onPhotosChange]
  );

  // Global paste handler (works even when textarea is not focused)
  useEffect(() => {
    if (!onPhotosChange) return;
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;

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

    document.addEventListener('paste', handleGlobalPaste);
    return () => document.removeEventListener('paste', handleGlobalPaste);
  }, [addPhotos, onPhotosChange]);

  const removePhoto = (id: string) => {
    if (!onPhotosChange) return;
    const photo = photos.find((p) => p.id === id);
    if (photo) {
      URL.revokeObjectURL(photo.previewUrl);
    }
    onPhotosChange(photos.filter((p) => p.id !== id));
  };

  const hasPhotoSupport = Boolean(onPhotosChange);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      addPhotos(fileArray);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-700 flex items-center gap-2">
            <Image size={14} className="text-stone-400" /> Listing text & screenshots
          </h3>
          <div className="text-[10px] uppercase tracking-widest text-stone-400">
            {photos.length}/8 added
          </div>
        </div>
        <p className="text-xs text-stone-500 mt-2 leading-relaxed">
          Paste any listing description or notes. Add screenshots via upload or Ctrl+V.
        </p>
      </div>

      <div className="relative flex-1">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          placeholder="Paste the listing description, inspection notes, or anything important about the property…"
          className="flex-1 min-h-[280px] w-full p-6 pr-24 bg-stone-50/40 border border-stone-200/80 rounded-3xl resize-none outline-none focus:ring-0 focus:border-stone-400 focus:bg-white transition-all duration-500 placeholder:text-stone-400 text-stone-700 leading-relaxed font-light text-[15px]"
        ></textarea>

        {/* Upload button in bottom right */}
        {hasPhotoSupport && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-4 right-3 flex items-center gap-2 px-3 py-1.5 bg-white/90 backdrop-blur rounded-full border border-stone-200 hover:bg-white hover:border-stone-300 transition-all cursor-pointer"
          >
            <Image size={14} className="text-stone-500" />
            <span className="text-[10px] font-medium uppercase tracking-widest text-stone-500">Add screenshots</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </button>
        )}
      </div>

      {/* Photo thumbnails */}
      {photos.length > 0 && (
        <div className="mt-4">
          <div className="grid grid-cols-4 gap-2.5">
            {photos.map((photo) => (
              <div key={photo.id} className="relative group">
                <img
                  src={photo.previewUrl}
                  alt="Preview"
                  className="w-full h-20 object-cover rounded-xl ring-1 ring-stone-200"
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
        {hasPhotoSupport ? 'Tip: include kitchen + bathroom screenshots for best accuracy' : 'Even a short description is enough to start'}
      </p>
    </div>
  );
}

import { type Ref, onScopeDispose, ref } from 'vue';

export interface CameraMediaResource {
  type: 'image' | 'video';
  value: string;
  createdAt: Date;
}

/** Own captured media in the tool scope and release browser Blob URLs when items leave it. */
export function useCameraMediaCollection(): {
  mediaItems: Ref<CameraMediaResource[]>;
  addMedia: (media: CameraMediaResource) => void;
  removeMedia: (index: number) => void;
} {
  const mediaItems = ref<CameraMediaResource[]>([]);

  const addMedia = (media: CameraMediaResource) => {
    mediaItems.value.unshift(media);
  };

  const removeMedia = (index: number) => {
    const [media] = mediaItems.value.splice(index, 1);
    if (media) {
      releaseMediaObjectUrl(media);
    }
  };

  onScopeDispose(() => {
    mediaItems.value.forEach(releaseMediaObjectUrl);
    mediaItems.value = [];
  });

  return { mediaItems, addMedia, removeMedia };
}

/** Revoke only recorder-owned Blob URLs; image data URLs need no explicit release. */
function releaseMediaObjectUrl(media: CameraMediaResource): void {
  if (media.type === 'video' && media.value.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(media.value);
  }
}

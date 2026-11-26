import { tr } from '../i18n/translator';

export function compressImageFileToDataUrl(
  file: File,
  maxDimension: number = 640,
  quality: number = 0.76
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error(tr('الملف المختار ليس صورة صالحة', 'Selected file is not a valid image')));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error(tr('تعذر قراءة ملف الصورة', 'Could not read image file')));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(tr('تعذر معالجة الصورة المختارة', 'Could not process selected image')));
      img.onload = () => {
        const ratio = Math.min(1, maxDimension / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round(img.width * ratio));
        const height = Math.max(1, Math.round(img.height * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

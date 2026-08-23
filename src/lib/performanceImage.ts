const PERFORMANCE_IMAGE_WIDTH = 600;
const WEBP_QUALITY = 0.8;

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('画像の読み込みに失敗しました。'));
    };
    image.src = objectUrl;
  });

const canvasToWebp = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('WebP形式への変換に失敗しました。'));
      },
      'image/webp',
      WEBP_QUALITY,
    );
  });

export const preparePerformanceImage = async (file: File): Promise<File> => {
  if (
    file.type !== 'image/jpeg' &&
    file.type !== 'image/png' &&
    file.type !== 'image/webp'
  ) {
    throw new Error('JPEG・PNG・WebP形式の画像を選択してください。');
  }

  const image = await loadImage(file);
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('画像のサイズを取得できませんでした。');
  }

  const canvas = document.createElement('canvas');
  canvas.width = PERFORMANCE_IMAGE_WIDTH;
  canvas.height = Math.max(
    1,
    Math.round(
      (image.naturalHeight / image.naturalWidth) * PERFORMANCE_IMAGE_WIDTH,
    ),
  );
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('画像の変換に対応していないブラウザです。');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const webp = await canvasToWebp(canvas);
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'performance-image';
  return new File([webp], `${baseName}.webp`, { type: 'image/webp' });
};

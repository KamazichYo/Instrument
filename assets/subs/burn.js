// Вшивание субтитров в видео: декодируем кадры (WebCodecs), рисуем субтитр, кодируем обратно в MP4.
// Звук копируется без перекодирования — качество не теряется.
import {
  Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS,
  QUALITY_HIGH, getFirstEncodableVideoCodec,
} from '../vendor/mediabunny/mediabunny.min.mjs';
import { drawCaption, findCue } from './render.js';

const MAX_SIDE = 1920; // 4K перекодировать на телефоне долго — уменьшаем до Full HD

export function canBurn() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
}

export async function burnSubtitles(file, cues, opts, onProgress) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('В файле нет видео');
  const dw = track.displayWidth, dh = track.displayHeight;
  const k = Math.min(1, MAX_SIDE / Math.max(dw, dh));
  const width = Math.round((dw * k) / 2) * 2;
  const height = Math.round((dh * k) / 2) * 2;

  const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height });
  if (!codec) throw new Error('Этот браузер не умеет кодировать видео');

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  let canvas = null, ctx = null;
  const conversion = await Conversion.init({
    input,
    output,
    video: {
      width, height, fit: 'contain',
      allowTransformationMetadata: false, // поворот iPhone «запекаем» в кадр, чтобы текст не лёг боком
      forceTranscode: true,
      codec,
      quality: QUALITY_HIGH,
      process: (sample) => {
        const w = sample.displayWidth, h = sample.displayHeight;
        if (!canvas || canvas.width !== w || canvas.height !== h) {
          canvas = new OffscreenCanvas(w, h);
          ctx = canvas.getContext('2d');
        }
        sample.draw(ctx, 0, 0, w, h);
        drawCaption(ctx, w, h, findCue(cues, sample.timestamp), sample.timestamp, opts);
        return canvas;
      },
    },
  });
  const lostVideo = conversion.discardedTracks.find((d) => d.track.type === 'video');
  if (lostVideo) throw new Error('Не получилось прочитать видео в этом браузере (' + lostVideo.reason + ')');
  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((d) => d.reason).join(', ');
    throw new Error('Не получилось перекодировать видео (' + why + ')');
  }
  conversion.onProgress = (p) => onProgress && onProgress(p);
  await conversion.execute();
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

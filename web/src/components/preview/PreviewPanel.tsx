import React, { useEffect, useState } from 'react';
import styles from './PreviewPanel.module.css';
import type { FetchBlobFn, FileItem, StreamVideoFn } from '../../hooks/useMTPDevice';
import type { PDFDocument } from 'pdf-lib';
import FileTypeIcon from '../explorer/FileTypeIcon';
import { plural } from '../../utils/format';
import { Download, FileAudio } from 'lucide-react';

/** Bytes que se leen para el preview de texto. */
const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
/** Caracteres que se muestran en el preview de texto. */
const TEXT_PREVIEW_MAX_CHARS = 20000;

/* ─── Types ──────────────────────────────────────────────────────────────── */
type PreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'fallback';

function getPreviewType(name: string, isFolder: boolean): PreviewType {
  if (isFolder) return 'fallback';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg','jpeg','png','gif','webp','bmp','svg','heic'].includes(ext)) return 'image';
  if (['mp4','webm','ogg','mov'].includes(ext)) return 'video';
  if (['mp3','wav','ogg','aac','flac','m4a'].includes(ext)) return 'audio';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['txt','md','json','xml','csv','log','js','ts','tsx','jsx','html','css'].includes(ext)) return 'text';
  return 'fallback';
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getKindLabel(file: FileItem): string {
  if (file.isFolder) return 'Carpeta';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const kinds: Record<string, string> = {
    jpg: 'Imagen JPEG', jpeg: 'Imagen JPEG', png: 'Imagen PNG',
    gif: 'Imagen GIF', webp: 'Imagen WebP', heic: 'Imagen HEIC',
    mp4: 'Video MP4', mov: 'Video QuickTime', webm: 'Video WebM',
    mp3: 'Audio MP3', wav: 'Audio WAV', aac: 'Audio AAC', flac: 'Audio FLAC',
    pdf: 'Documento PDF',
    txt: 'Texto plano', md: 'Markdown',
    json: 'JSON', xml: 'XML', csv: 'CSV',
    apk: 'App Android', zip: 'Archivo ZIP', rar: 'Archivo RAR',
  };
  return kinds[ext] ?? (ext ? `Archivo .${ext.toUpperCase()}` : 'Documento');
}

/**
 * Converts MTP date string (YYYYMMDDTHHMMSS or ISO) to dd/mm/yyyy format.
 * Falls back to showing the raw string if unparseable.
 */
function formatDate(raw: string): string {
  if (!raw) return '--';
  try {
    // MTP format: 20240315T142500 or 20240315T142500.0Z
    const m = raw.match(/(\d{4})(\d{2})(\d{2})/);
    if (m) {
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    // ISO date
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }
  } catch { /* ignore */ }
  return raw;
}

/* ─── Stacked icons (multi-selection) ─────────────────────────────────── */
const STACK_TRANSFORMS = [
  'rotate(-8deg) translate(-6px, 8px)',   // back
  'rotate(5deg)  translate(7px, 3px)',    // middle
  'rotate(0deg)  translate(0px, 0px)',    // front
];

const StackedIcons: React.FC<{ files: FileItem[] }> = ({ files }) => {
  // Show at most 3 icons, back-to-front order
  const capped = files.slice(0, 3);
  const layers = capped.length === 1 ? [capped[0]] : capped;
  const total = STACK_TRANSFORMS.length;
  const offset = total - layers.length; // align transforms to front slots

  return (
    <div className={styles.stackContainer}>
      {layers.map((file, i) => (
        <div
          key={file.id}
          className={styles.stackCard}
          style={{ transform: STACK_TRANSFORMS[offset + i], zIndex: i + 1 }}
        >
          {file.isFolder
            ? <FolderFallback />
            : <FileTypeIcon name={file.name} size={64} className={styles.stackEmoji} />
          }
        </div>
      ))}
    </div>
  );
};

/* ─── Props ──────────────────────────────────────────────────────────────── */
interface PreviewPanelProps {
  file: FileItem | null;
  /** All currently selected files — when > 1 shows stacked-icon view */
  selectedFiles?: FileItem[];
  onDownload: (file: FileItem) => void;
  /** Descargar toda la selección (con varios archivos se arma un ZIP). */
  onDownloadSelected?: () => void;
  isDownloading: boolean;
  onFetchBlob: FetchBlobFn;
  /**
   * When true, skips the preview area and shows only file metadata.
   * Used in gallery mode where the preview is shown in the center content area.
   */
  metadataOnly?: boolean;
  /**
   * Opcional — función que devuelve una URL directa con token embebido.
   * Cuando se provee, imagen/video/audio se muestran via <img src> / <video src>
   * en lugar de descargar el blob completo primero. Carga progresiva y nativa.
   */
  getDirectUrl?: (file: FileItem) => string | null;
  /**
   * Opcional — crea un stream MSE para videos MTP.
   * Recibe signal para abortar si el usuario cambia de archivo.
   * Retorna la URL de MediaSource de forma sincrónica; el streaming USB
   * corre en segundo plano → la reproducción empieza sin esperar la descarga.
   */
  onStreamVideo?: StreamVideoFn;
}

/* ─── Folder fallback icon inline (no import loop) ────────── */
const FolderFallback = () => (
  <svg className={styles.fallbackFolderSvg} viewBox="0 0 88 76" fill="none">
    <defs>
      <linearGradient id="pvBodyGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#72bcf7"/>
        <stop offset="100%" stopColor="#5ba8ea"/>
      </linearGradient>
    </defs>
    <path d="M4 20 Q4 14 10 14 L32 14 Q36 14 38 18 L42 24 L4 24 Z" fill="#62aae8"/>
    <rect x="4" y="22" width="80" height="50" rx="6" fill="url(#pvBodyGrad)"/>
    <rect x="4" y="22" width="80" height="16" rx="5" fill="white" opacity="0.07"/>
    <rect x="4" y="68" width="80" height="4" rx="4" fill="#4a90d9" opacity="0.4"/>
  </svg>
);

/* ─── Main component ────────────────────────────────────────────────────── */
const PreviewPanel: React.FC<PreviewPanelProps> = ({
  file,
  selectedFiles,
  onDownload,
  onDownloadSelected,
  isDownloading,
  onFetchBlob,
  metadataOnly = false,
  getDirectUrl,
  onStreamVideo,
}) => {
  // El padre monta un PreviewPanel nuevo por archivo (key = file.id), así
  // que el estado arranca limpio en cada archivo sin resetearlo a mano.
  const isMulti = (selectedFiles?.length ?? 0) > 1;
  const previewType = file ? getPreviewType(file.name, file.isFolder) : 'fallback';
  const wantsContent = !!file && !file.isFolder && !metadataOnly && previewType !== 'fallback';
  // Modo red: imagen/video/audio se muestran con URL directa — el navegador
  // hace carga progresiva y Range requests sin descargar el blob entero.
  const directUrl = wantsContent && getDirectUrl &&
    (previewType === 'image' || previewType === 'video' || previewType === 'audio')
    ? getDirectUrl(file)
    : null;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobMimeType, setBlobMimeType] = useState<string | null>(null);
  // cleanup fn for MediaSource URLs created by onStreamVideo
  const streamCleanupRef = React.useRef<(() => void) | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingBlob, setLoadingBlob] = useState(() => wantsContent && !directUrl);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState<number>(0);
  const [pdfDocInternal, setPdfDocInternal] = useState<PDFDocument | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  };

  // Ensure volume is always max when a video is loaded
  React.useEffect(() => {
    if (videoRef.current) videoRef.current.volume = 1;
  }, [blobUrl]);

  useEffect(() => {
    if (!file || !wantsContent || directUrl) return;
    const ptype = previewType;
    const abortCtrl = new AbortController();

    // Streaming MSE para video MTP — la reproducción empieza sin esperar la descarga.
    if (ptype === 'video' && onStreamVideo) {
      const stream = onStreamVideo(file, abortCtrl.signal, () => videoRef.current?.currentTime ?? 0);
      if (stream) {
        streamCleanupRef.current = stream.cleanup;
        setBlobUrl(stream.url);
        return () => { abortCtrl.abort(); };
      }
    }

    // Fallback: descarga blob completo (MTP/USB o tipos que lo requieren: pdf, text)
    // Texto: alcanza con el primer MB (se muestran 20 000 caracteres). En modo
    // WiFi se pide por Range; con signal, cambiar de archivo cancela la lectura.
    onFetchBlob(file, {
      signal: abortCtrl.signal,
      maxBytes: ptype === 'text' ? TEXT_PREVIEW_MAX_BYTES : undefined,
    }).then(blob => {
      if (abortCtrl.signal.aborted || !blob) { setLoadingBlob(false); return; }

      if (ptype === 'text') {
        blob.text().then(t => {
          if (!abortCtrl.signal.aborted) { setTextContent(t); setLoadingBlob(false); }
        }).catch(() => setLoadingBlob(false));
      } else if (ptype === 'pdf') {
        blob.arrayBuffer()
          .then(async ab => {
            try {
              const { PDFDocument } = await import('pdf-lib');
              const pdfDoc = await PDFDocument.load(ab, { ignoreEncryption: true });
              if (!abortCtrl.signal.aborted) {
                setPdfTotalPages(pdfDoc.getPageCount());
                setPdfDocInternal(pdfDoc);
              }
            } catch (err) {
              console.warn('Could not parse PDF pages', err);
              const fallbackBlob = new Blob([blob], { type: 'application/pdf' });
              if (!abortCtrl.signal.aborted) {
                setBlobUrl(URL.createObjectURL(fallbackBlob));
                setPdfTotalPages(9999);
                setLoadingBlob(false);
              }
            }
          })
          .catch(() => {
            if (!abortCtrl.signal.aborted) {
              setLoadingBlob(false);
              setPdfTotalPages(9999);
            }
          });
      } else {
        const url = URL.createObjectURL(blob);
        if (!abortCtrl.signal.aborted) {
          setBlobUrl(url);
          setBlobMimeType(blob.type || null);
          setLoadingBlob(false);
        }
      }
    }).catch(() => { if (!abortCtrl.signal.aborted) setLoadingBlob(false); });

    return () => { abortCtrl.abort(); };
    // Solo al montar: un archivo distinto monta otro PreviewPanel (key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup MediaSource stream on unmount
  useEffect(() => () => { streamCleanupRef.current?.(); }, []);

  // Liberar cada blob URL cuando se reemplaza (página de PDF) o al desmontar
  useEffect(() => {
    if (!blobUrl) return;
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  useEffect(() => {
    if (!pdfDocInternal) return;

    // Mientras se arma la página nueva se sigue mostrando la anterior.
    let cancelled = false;

    const renderSinglePage = async () => {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const newDoc = await PDFDocument.create();
        const [copied] = await newDoc.copyPages(pdfDocInternal, [pdfPage - 1]);
        newDoc.addPage(copied);
        const bytes = await newDoc.save();
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        if (!cancelled) {
          setBlobUrl(url); // la anterior la libera el efecto de blobUrl
          setLoadingBlob(false);
        } else {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.error("Failed to render single page", err);
        if (!cancelled) setLoadingBlob(false);
      }
    };

    renderSinglePage();

    return () => { cancelled = true; };
  }, [pdfPage, pdfDocInternal]);

  /* ── Multi-select stacked view ── */
  if (isMulti && selectedFiles) {
    const totalSize = selectedFiles.filter(f => !f.isFolder).reduce((s, f) => s + (f.size || 0), 0);
    const fileCount = selectedFiles.filter(f => !f.isFolder).length;
    return (
      <div className={styles.panel}>
        <div className={styles.previewArea}>
          <StackedIcons files={selectedFiles} />
        </div>
        <div className={styles.metaArea}>
          <div className={styles.fileName}>{plural(selectedFiles.length, 'elemento seleccionado', 'elementos seleccionados')}</div>
          {totalSize > 0 && (
            <div className={styles.metaRow}>
              <span className={styles.metaKey}>Tamaño total</span>
              <span className={styles.metaVal}>{formatSize(totalSize)}</span>
            </div>
          )}
          {onDownloadSelected && fileCount > 0 && (
            <button
              type="button"
              className={styles.downloadBtn}
              onClick={onDownloadSelected}
              disabled={isDownloading}
            >
              {isDownloading
                ? 'Descargando…'
                : fileCount === 1 ? 'Descargar' : `Descargar ${fileCount} archivos (ZIP)`}
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── Guard ── */
  if (!file) return null;
  // In normal mode, don't render for folders (AppLayout already filters).
  // In metadataOnly mode, render metadata for any file type.
  if (file.isFolder && !metadataOnly) return null;

  const ptype = getPreviewType(file.name, file.isFolder);
  // MTP thumbnails for video files are embedded JPEGs — render as image, not video player
  const effectivePtype = (ptype === 'video' && blobMimeType?.startsWith('image/')) ? 'image' : ptype;

  /** Seek the video to the position clicked/dragged on the timeline. */
  const seekTimeline = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (videoRef.current && videoDuration > 0) {
      videoRef.current.currentTime = pct * videoDuration;
      setVideoTime(pct * videoDuration);
    }
  };

  const formatVideoTime = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };

  /* ── Render preview content ── */
  const renderPreview = () => {
    if (loadingBlob && !directUrl && !blobUrl) {
      return (
        <div className={styles.loadingPreview}>
          <div className={styles.spinner} />
          <span>Cargando vista previa…</span>
        </div>
      );
    }

    if (file.isFolder) return <FolderFallback />;

    if (effectivePtype === 'image' && (directUrl ?? blobUrl)) {
      return <img className={styles.previewImage} src={directUrl ?? blobUrl!} alt={file.name} />;
    }

    if (effectivePtype === 'video' && (directUrl ?? blobUrl)) {
      const progress = videoDuration > 0 ? (videoTime / videoDuration) * 100 : 0;
      return (
        <div className={styles.videoWrapper} onClick={togglePlay}>
          <video
            ref={videoRef}
            className={styles.previewVideo}
            src={directUrl ?? blobUrl!}
            playsInline
            preload="auto"
            onEnded={() => setIsPlaying(false)}
            onTimeUpdate={() => setVideoTime(videoRef.current?.currentTime ?? 0)}
            onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
          />
          <button
            className={`${styles.playBtn} ${isPlaying ? styles.playing : ''}`}
            onClick={e => { e.stopPropagation(); togglePlay(); }}
            aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying
              ? /* Pause icon */
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <rect x="3" y="2" width="4" height="14" rx="1.5"/>
                  <rect x="11" y="2" width="4" height="14" rx="1.5"/>
                </svg>
              : /* Play icon */
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <path d="M4 2.5l12 6.5-12 6.5V2.5Z"/>
                </svg>
            }
          </button>
          {/* Timeline scrubber */}
          <div
            className={styles.videoTimeline}
            onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); seekTimeline(e); }}
            onPointerMove={e => { if (e.buttons > 0) seekTimeline(e); }}
            onClick={e => e.stopPropagation()}
          >
            {videoDuration > 0 && (
              <span className={styles.videoTimeLabel}>
                {formatVideoTime(videoTime)} / {formatVideoTime(videoDuration)}
              </span>
            )}
            <div className={styles.videoTimelineTrack}>
              <div className={styles.videoTimelineProgress} style={{ width: `${progress}%` }} />
              <div className={styles.videoTimelineKnob} style={{ left: `${progress}%` }} />
            </div>
          </div>
        </div>
      );
    }

    if (effectivePtype === 'audio' && (directUrl ?? blobUrl)) {
      return (
        <div className={styles.audioWrap}>
          <FileAudio size={48} strokeWidth={1.2} className={styles.audioIcon} aria-hidden="true" />
          <audio className={styles.previewAudio} src={directUrl ?? blobUrl!} controls />
        </div>
      );
    }

    if (effectivePtype === 'pdf' && blobUrl) {
      return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <iframe
            className={styles.previewFrame}
            src={`${blobUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            title={file.name}
          />
          <div className={styles.pdfControls}>
            <button
              className={styles.pdfBtn}
              onClick={() => setPdfPage(p => Math.max(1, p - 1))}
              disabled={pdfPage <= 1}
              aria-label="Página anterior"
            >
              ←
            </button>
            <button
              className={styles.pdfBtn}
              onClick={() => setPdfPage(p => p + 1)}
              disabled={pdfTotalPages > 0 && pdfPage >= pdfTotalPages}
              aria-label="Página siguiente"
            >
              →
            </button>
          </div>
        </div>
      );
    }

    if (effectivePtype === 'text' && textContent !== null) {
      return (
        // sandbox="" (sin scripts, origen opaco) además del escape: el texto
        // viene del dispositivo y no debe poder ejecutar nada. Se corta antes
        // de escapar para no partir una entidad (&amp; → &am).
        <iframe
          className={styles.previewFrame}
          sandbox=""
          srcDoc={`<html><body style="margin:0;padding:8px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;background:#1a1a1a;color:#ddd;">${textContent
            .substring(0, TEXT_PREVIEW_MAX_CHARS)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</body></html>`}
          title={file.name}
        />
      );
    }

    /* Fallback */
    return (
      <div className={styles.fallbackWrap}>
        <FileTypeIcon name={file.name} size={72} className={styles.fallbackIcon} />
      </div>
    );
  };

  return (
    <div className={styles.panel}>
      {/* Preview area — hidden in gallery mode (preview shown in center instead) */}
      {!metadataOnly && (
        <div className={styles.previewArea}>
          {renderPreview()}
        </div>
      )}

      {/* Metadata */}
      <div className={`${styles.metaArea} ${metadataOnly ? styles.metaAreaFull : ''}`}>
        <div className={styles.fileName}>{file.name}</div>

        <div className={styles.metaRow}>
          <span className={styles.metaKey}>Tipo</span>
          <span className={styles.metaVal}>{getKindLabel(file)}</span>
        </div>

        {!file.isFolder && (
          <div className={styles.metaRow}>
            <span className={styles.metaKey}>Tamaño</span>
            <span className={styles.metaVal}>{formatSize(file.size)}</span>
          </div>
        )}

        {file.dateModified && (
          <div className={styles.metaRow}>
            <span className={styles.metaKey}>Modificado</span>
            <span className={styles.metaVal}>{formatDate(file.dateModified)}</span>
          </div>
        )}

        {!file.isFolder && (
          <button
            className={styles.downloadBtn}
            onClick={() => onDownload(file)}
            disabled={isDownloading}
          >
            <Download size={14} strokeWidth={1.8} aria-hidden="true" />
            {isDownloading ? 'Descargando…' : 'Descargar'}
          </button>
        )}
      </div>
    </div>
  );
};

export default PreviewPanel;

/** Emoji representativo según la extensión del archivo. */
export function getFileEmoji(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg','jpeg','png','gif','heic','webp','bmp','heif','tiff','raw','cr2','nef','arw'].includes(ext)) return '🖼️';
  if (['mp4','mkv','mov','avi','webm'].includes(ext)) return '🎬';
  if (['mp3','wav','aac','flac','m4a'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📄';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️';
  if (['apk'].includes(ext)) return '📦';
  if (['txt','md'].includes(ext)) return '📝';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['xls','xlsx','csv'].includes(ext)) return '📊';
  return '📄';
}

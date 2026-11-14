/// Parseo del header HTTP `Range` (RFC 9110 §14) para un único rango de bytes.
library;

/// Rango de bytes inclusivo `[start, end]` ya validado contra el tamaño del archivo.
class ByteRange {
  final int start;
  final int end;

  const ByteRange(this.start, this.end);

  int get length => end - start + 1;

  @override
  bool operator ==(Object other) =>
      other is ByteRange && other.start == start && other.end == end;

  @override
  int get hashCode => Object.hash(start, end);

  @override
  String toString() => 'ByteRange($start-$end)';
}

/// Resultado de [parseRange].
sealed class RangeResult {
  const RangeResult();
}

/// Sin header, header no soportado (unidad ≠ bytes, multi-range) o sintaxis
/// inválida: se responde el archivo completo con 200, como indica el RFC.
class RangeIgnored extends RangeResult {
  const RangeIgnored();
}

/// Rango válido: responder 206 con [range].
class RangeSatisfiable extends RangeResult {
  final ByteRange range;
  const RangeSatisfiable(this.range);
}

/// Rango sintácticamente válido pero fuera del archivo: responder 416.
class RangeNotSatisfiable extends RangeResult {
  const RangeNotSatisfiable();
}

/// Interpreta [header] para un archivo de [fileLength] bytes.
///
/// Soporta `bytes=a-b`, `bytes=a-` y el rango sufijo `bytes=-n` (los últimos
/// n bytes). Los multi-range (`bytes=0-1,5-6`) se ignoran y se sirve el
/// archivo completo.
RangeResult parseRange(String? header, int fileLength) {
  if (header == null) return const RangeIgnored();
  final value = header.trim();
  if (!value.startsWith('bytes=')) return const RangeIgnored();

  final spec = value.substring(6).trim();
  if (spec.contains(',')) return const RangeIgnored();

  final dash = spec.indexOf('-');
  if (dash < 0) return const RangeIgnored();
  final first = spec.substring(0, dash).trim();
  final last = spec.substring(dash + 1).trim();

  if (first.isEmpty) {
    // Rango sufijo: bytes=-n
    final suffix = int.tryParse(last);
    if (suffix == null || suffix < 0) return const RangeIgnored();
    if (suffix == 0 || fileLength == 0) return const RangeNotSatisfiable();
    final start = suffix >= fileLength ? 0 : fileLength - suffix;
    return RangeSatisfiable(ByteRange(start, fileLength - 1));
  }

  final start = int.tryParse(first);
  if (start == null || start < 0) return const RangeIgnored();

  int? end;
  if (last.isNotEmpty) {
    end = int.tryParse(last);
    if (end == null || end < start) return const RangeIgnored();
  }

  if (start >= fileLength) return const RangeNotSatisfiable();
  final clampedEnd = (end == null || end >= fileLength) ? fileLength - 1 : end;
  return RangeSatisfiable(ByteRange(start, clampedEnd));
}

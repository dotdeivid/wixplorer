import 'dart:io';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:mime/mime.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class FileItem {
  final String name;
  final String path;
  final bool isFolder;
  final int size;
  final int dateModified;
  final String? mimeType;

  const FileItem({
    required this.name,
    required this.path,
    required this.isFolder,
    required this.size,
    required this.dateModified,
    this.mimeType,
  });

  Map<String, dynamic> toJson() => {
        'name': name,
        'path': path,
        'isFolder': isFolder,
        'size': size,
        'dateModified': dateModified,
        'mimeType': mimeType,
      };
}

class StorageInfo {
  final String id;
  final String name;
  final String path;

  const StorageInfo({
    required this.id,
    required this.name,
    required this.path,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'path': path,
      };
}

/// Acceso al sistema de archivos del dispositivo.
class FileService {
  FileService._();
  static final FileService instance = FileService._();

  // Raíces de almacenamiento permitidas — se pobla al iniciar.
  final List<StorageInfo> _storages = [];
  final Set<String> _allowedRoots = {};

  // Cuántos stat() corren en paralelo al listar una carpeta.
  // En Android, el VFS aguanta 8-10 calls paralelos sin penalización.
  static const int _statConcurrency = 8;

  Future<void> init() async {
    _storages.clear();
    _allowedRoots.clear();

    // Almacenamiento interno
    final extDirs = await getExternalStorageDirectories();
    if (extDirs != null && extDirs.isNotEmpty) {
      final root = _resolveStorageRoot(extDirs.first.path);
      _storages.add(StorageInfo(id: 'internal', name: 'Almacenamiento interno', path: root));
      _allowedRoots.add(root);
    }

    // Intento de detección de tarjeta SD en Android
    try {
      final externalDirs = await getExternalStorageDirectories();
      if (externalDirs != null && externalDirs.length > 1) {
        final sdRoot = _resolveStorageRoot(externalDirs[1].path);
        _storages.add(StorageInfo(id: 'sdcard', name: 'Tarjeta SD', path: sdRoot));
        _allowedRoots.add(sdRoot);
      }
    } catch (_) {}

    if (_storages.isEmpty) {
      final docs = await getApplicationDocumentsDirectory();
      _storages.add(StorageInfo(id: 'documents', name: 'Documentos', path: docs.path));
      _allowedRoots.add(docs.path);
    }
  }

  List<StorageInfo> get storages => List.unmodifiable(_storages);

  /// Lista archivos en [path] con stat() paralelos para mayor velocidad.
  /// Los elementos salen ordenados: carpetas primero, luego archivos, ambos por nombre.
  Future<List<FileItem>> listFiles(String path) async {
    final resolved = _sanitizePath(path);
    final dir = Directory(resolved);
    if (!await dir.exists()) {
      throw FileSystemException('No existe el directorio', resolved);
    }

    // Recoger todas las entradas primero (I/O de directorio — rápido).
    // toList() puede lanzar si el proceso no tiene permiso de lectura en el dir.
    final List<FileSystemEntity> entries;
    try {
      entries = await dir.list(followLinks: false).toList();
    } on FileSystemException {
      rethrow;
    } catch (e) {
      throw FileSystemException('Error al leer el directorio: $e', resolved);
    }

    // Stat en batches paralelos para reducir latencia total
    final items = <FileItem>[];
    for (var i = 0; i < entries.length; i += _statConcurrency) {
      final batch = entries.skip(i).take(_statConcurrency).toList();
      final results = await Future.wait(batch.map(_statEntity));
      items.addAll(results.whereType<FileItem>());
    }

    items.sort((a, b) {
      if (a.isFolder != b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });

    return items;
  }

  /// Versión streaming de [listFiles]: emite ítems en batches de [_statConcurrency]
  /// a medida que se completan los stat(), con carpetas primero dentro de cada batch.
  /// Permite renderizado progresivo en el cliente sin esperar el listado completo.
  Stream<FileItem> streamFiles(String path) async* {
    final resolved = _sanitizePath(path);
    final dir = Directory(resolved);
    if (!await dir.exists()) {
      throw FileSystemException('No existe el directorio', resolved);
    }

    final List<FileSystemEntity> entries;
    try {
      entries = await dir.list(followLinks: false).toList();
    } on FileSystemException {
      rethrow;
    } catch (e) {
      throw FileSystemException('Error al leer el directorio: $e', resolved);
    }

    // Emitir en batches para que el cliente reciba datos antes de que termine
    // de procesarse todo el directorio
    for (var i = 0; i < entries.length; i += _statConcurrency) {
      final batch = entries.skip(i).take(_statConcurrency).toList();
      final results = await Future.wait(batch.map(_statEntity));
      final batchItems = results.whereType<FileItem>().toList()
        ..sort((a, b) {
          if (a.isFolder != b.isFolder) return a.isFolder ? -1 : 1;
          return a.name.toLowerCase().compareTo(b.name.toLowerCase());
        });
      for (final item in batchItems) {
        yield item;
      }
    }
  }

  /// Verifica que [path] existe y es accesible sin listar su contenido.
  Future<void> validatePath(String path) async {
    final resolved = _sanitizePath(path); // lanza si fuera de los roots permitidos
    if (!await Directory(resolved).exists()) {
      throw FileSystemException('No existe el directorio', resolved);
    }
  }

  /// Abre el archivo en [path] para lectura en streaming.
  File openFile(String path) {
    final resolved = _sanitizePath(path);
    return File(resolved);
  }

  /// Elimina el archivo o carpeta en [path].
  /// Lanza [FileSystemException] si el path está fuera del almacenamiento
  /// permitido o si la entidad no existe.
  Future<void> deleteItem(String path) async {
    // allowRoot: false — nunca borrar una raíz entera (p.ej. /storage/emulated/0)
    final resolved = resolveWithinRoots(path, _allowedRoots, allowRoot: false);
    final type = await FileSystemEntity.type(resolved);
    if (type == FileSystemEntityType.directory) {
      await Directory(resolved).delete(recursive: true);
    } else if (type == FileSystemEntityType.file) {
      await File(resolved).delete();
    } else {
      throw FileSystemException('No encontrado', resolved);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  static Future<FileItem?> _statEntity(FileSystemEntity entity) async {
    try {
      final name = entity.path.split('/').last;
      if (name.startsWith('.')) return null;
      final stat = await entity.stat();
      return FileItem(
        name: name,
        path: entity.path,
        isFolder: entity is Directory,
        size: stat.size,
        dateModified: stat.modified.millisecondsSinceEpoch,
        mimeType: entity is File ? lookupMimeType(entity.path) : null,
      );
    } catch (_) {
      return null; // archivo inaccessible — ignorar
    }
  }

  String _sanitizePath(String path) => resolveWithinRoots(path, _allowedRoots);

  /// Verifica que [path] quede dentro de alguna de las [roots] y lo devuelve
  /// normalizado. Lanza [FileSystemException] si no.
  ///
  /// 1. La validación usa la ruta real ([_realPath]: sin `..` y con symlinks
  ///    resueltos), así un link dentro del almacenamiento que apunte afuera
  ///    no sirve para escapar.
  /// 2. Compara por componentes con `p.isWithin()` (no por prefijo de texto),
  ///    así `/storage/emulated/0-evil` no pasa por `/storage/emulated/0`.
  ///
  /// Con [allowRoot] en false, la raíz misma también se rechaza (solo se
  /// aceptan rutas estrictamente dentro de ella).
  ///
  /// Devuelve la ruta canonicalizada (no la real) para que los paths que ve
  /// el cliente sigan colgando de la raíz que conoce.
  @visibleForTesting
  static String resolveWithinRoots(
    String path,
    Iterable<String> roots, {
    bool allowRoot = true,
  }) {
    final resolved = _realPath(path);
    if (resolved == null ||
        !roots
            .map(_realPath)
            .whereType<String>()
            .any(
              (root) =>
                  (allowRoot && resolved == root) || p.isWithin(root, resolved),
            )) {
      throw const FileSystemException(
        'Acceso denegado — path fuera del almacenamiento permitido',
      );
    }
    return p.canonicalize(path);
  }

  /// Ruta absoluta, normalizada y con symlinks resueltos.
  ///
  /// `p.canonicalize()` solo trabaja sobre el texto, así que los symlinks se
  /// resuelven aparte. Si el path no existe todavía, se resuelve el ancestro
  /// existente más cercano y se le agrega el resto. Devuelve null si no se
  /// puede resolver (p.ej. un symlink roto) — el caller lo trata como denegado.
  static String? _realPath(String path) {
    var existing = p.canonicalize(path);
    final missing = <String>[];
    while (FileSystemEntity.typeSync(existing, followLinks: false) ==
        FileSystemEntityType.notFound) {
      final parent = p.dirname(existing);
      if (parent == existing) break;
      missing.insert(0, p.basename(existing));
      existing = parent;
    }
    try {
      final real = File(existing).resolveSymbolicLinksSync();
      return p.joinAll([real, ...missing]);
    } on FileSystemException {
      return null;
    }
  }

  static String _resolveStorageRoot(String appSubdir) {
    final match = RegExp(r'^(/storage/[^/]+/\d+)').firstMatch(appSubdir);
    if (match != null) return match.group(1)!;
    var dir = Directory(appSubdir);
    for (var i = 0; i < 4; i++) {
      dir = dir.parent;
    }
    return dir.path;
  }
}

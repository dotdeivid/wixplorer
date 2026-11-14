import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:fc_native_video_thumbnail/fc_native_video_thumbnail.dart';
import 'package:flutter/foundation.dart' show compute, debugPrint;
import 'package:flutter/services.dart' show AssetManifest, rootBundle;
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image/image.dart' as img;
import 'package:mime/mime.dart';
import 'package:network_info_plus/network_info_plus.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:shelf_router/shelf_router.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../models/server_status.dart';
import 'auth_service.dart';
import 'file_service.dart';
import 'foreground_service_channel.dart';
import 'http_range.dart';
import 'http_security.dart';

// ── Top-level function para compute() ────────────────────────────────────────
// Necesita ser top-level (no método de clase) para que compute() pueda
// enviarlo a un Isolate separado. Corre en un Dart Isolate → no bloquea la UI.
// Solo se usa como fallback cuando FlutterImageCompress falla.
Uint8List _encodeJpegThumbnail(Uint8List srcBytes) {
  final decoded = img.decodeImage(srcBytes);
  if (decoded == null) return Uint8List(0);
  final thumb = img.copyResize(decoded, width: 320);
  return img.encodeJpg(thumb, quality: 75);
}

/// Gestiona el ciclo de vida del servidor HTTP.
/// Expone un stream de [ServerState] para que la UI reaccione.
class ServerService {
  ServerService._() {
    // Si Android corta el foreground service, el servidor no puede seguir.
    ForegroundServiceChannel.setOnSystemStop(() => stop());
  }
  static final ServerService instance = ServerService._();

  // Puerto preferido; si está ocupado se prueban los siguientes.
  static const int _basePort = 7070;
  static const int _maxPortAttempts = 10;
  // Sin requests durante _inactivityThreshold se avisa; si siguen sin
  // llegar hasta _autoStopAfter, el servidor se detiene solo. Además de
  // ahorrar batería, evita agotar el límite diario del foreground service
  // dataSync en Android 15+.
  static const Duration _inactivityThreshold = Duration(minutes: 15);
  static const Duration _autoStopAfter = Duration(minutes: 30);

  // ── Semáforo para generación de thumbnails ────────────────────────────────
  // Limita las compresiones de imagen concurrentes para no saturar la CPU/GPU.
  static const int _maxConcurrentThumbs = 3;
  // Tope para servir la imagen original cuando no se pudo generar miniatura.
  static const int _maxOriginalAsThumb = 512 * 1024;
  int _activeThumbOps = 0;
  final _thumbSlotQueue = <Completer<void>>[];

  HttpServer? _server;
  // Se incrementa en cada stop(): un start() en curso detecta que fue
  // cancelado comparando la generación que capturó al empezar.
  int _generation = 0;
  String? _cachedDeviceName;
  Timer? _inactivityTimer;
  Timer? _autoStopTimer;
  // Requests de la API con respuesta todavía en curso (descargas, video).
  // Mientras haya alguno el servidor no está inactivo.
  int _activeRequests = 0;

  // Assets web pre-cargados en memoria.
  final Map<String, Uint8List> _webAssets = {};

  // Directorio de caché de thumbnails en disco (temp del SO).
  Directory? _thumbCacheDir;

  final _videoThumbnailer = FcNativeVideoThumbnail();

  final _stateController = StreamController<ServerState>.broadcast();

  Stream<ServerState> get stateStream => _stateController.stream;
  ServerState _current = const ServerState.stopped();
  ServerState get current => _current;

  Future<void> start() async {
    if (_current.isRunning || _current.isBusy) return;
    final gen = _generation;
    _emit(const ServerState(status: ServerStatus.starting));

    try {
      final access = await _requestStoragePermissions();
      if (gen != _generation) return; // stop() durante el arranque
      if (access == _StorageAccess.denied) {
        _emit(const ServerState(
          status: ServerStatus.error,
          errorMessage: 'Permisos de almacenamiento denegados',
        ));
        return;
      }

      // Iniciar servicios + precargar assets en paralelo
      await Future.wait([
        FileService.instance.init(),
        _preloadWebAssets(),
        _initThumbCache(),
      ]);
      AuthService.instance.generate();
      _cachedDeviceName ??= await _resolveDeviceName();

      final ip = await _localIp();
      if (gen != _generation) return;

      final handler = const Pipeline()
          .addMiddleware(_corsMiddleware())
          .addMiddleware(_gzipJsonMiddleware())
          .addMiddleware(_activityMiddleware())
          .addMiddleware(_authMiddleware())
          .addHandler(_buildRouter());

      final server = await _bind(handler);
      if (gen != _generation) {
        await server.close(force: true);
        return;
      }
      _server = server;
      server.autoCompress = false; // No usar — interfiere con range requests de video

      await ForegroundServiceChannel.start(ip: ip, port: server.port);
      await WakelockPlus.enable();

      _emit(ServerState(
        status: ServerStatus.running,
        ip: ip,
        port: server.port,
        pin: AuthService.instance.currentPin,
        limitedAccess: access == _StorageAccess.mediaOnly,
      ));
      _resetInactivityTimer();
    } catch (e) {
      if (gen != _generation) return;
      await _server?.close(force: true);
      _server = null;
      _emit(ServerState(
        status: ServerStatus.error,
        errorMessage: 'No se pudo iniciar el servidor: $e',
      ));
    }
  }

  /// Escucha en [_basePort] o, si está ocupado, en el siguiente libre.
  Future<HttpServer> _bind(Handler handler) async {
    SocketException? lastError;
    for (var i = 0; i < _maxPortAttempts; i++) {
      try {
        return await shelf_io.serve(handler, InternetAddress.anyIPv4, _basePort + i);
      } on SocketException catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? const SocketException('No hay puertos libres');
  }

  Future<void> stop() async {
    _generation++;
    _inactivityTimer?.cancel();
    _inactivityTimer = null;
    _autoStopTimer?.cancel();
    _autoStopTimer = null;
    _activeRequests = 0;
    await _server?.close(force: true);
    _server = null;
    AuthService.instance.invalidate();
    await ForegroundServiceChannel.stop();
    await WakelockPlus.disable();
    _emit(const ServerState.stopped());
  }

  void dispose() {
    stop();
    _stateController.close();
  }

  // ── Semáforo ──────────────────────────────────────────────────────────────

  /// Adquiere un slot de generación de thumbnail; espera si ya hay
  /// [_maxConcurrentThumbs] operaciones activas.
  Future<T> _withThumbSlot<T>(Future<T> Function() work) async {
    if (_activeThumbOps < _maxConcurrentThumbs) {
      _activeThumbOps++;
    } else {
      final completer = Completer<void>();
      _thumbSlotQueue.add(completer);
      await completer.future;
      _activeThumbOps++;
    }
    try {
      return await work();
    } finally {
      _activeThumbOps--;
      if (_thumbSlotQueue.isNotEmpty) {
        _thumbSlotQueue.removeAt(0).complete();
      }
    }
  }

  // ── Caché de thumbnails en disco ──────────────────────────────────────────

  Future<void> _initThumbCache() async {
    try {
      final tmp = await getTemporaryDirectory();
      _thumbCacheDir = Directory('${tmp.path}/wixplorer_thumbs');
      await _thumbCacheDir!.create(recursive: true);
      // Limpiar archivos más viejos de 7 días para no acumular basura
      _thumbCacheDir!.list().listen((entity) async {
        if (entity is File) {
          try {
            final stat = await entity.stat();
            if (DateTime.now().difference(stat.modified).inDays > 7) {
              await entity.delete();
            }
          } catch (_) {}
        }
      }, onError: (Object e) {
        debugPrint('[WiXplorer] Error limpiando caché de thumbs: $e');
      });
    } catch (e) {
      debugPrint('[WiXplorer] No se pudo inicializar caché de thumbs: $e');
      _thumbCacheDir = null;
    }
  }

  /// Hash djb2 del path para nombre de archivo de caché.
  static int _hashPath(String path) {
    var hash = 5381;
    for (final c in path.codeUnits) {
      hash = ((hash << 5) + hash ^ c) & 0x7FFFFFFF;
    }
    return hash;
  }

  String _thumbCacheFilename(String path, int mtimeMs, String ext) =>
      '${_hashPath(path).toRadixString(16)}_$mtimeMs.$ext';

  Future<Uint8List?> _getThumbFromDiskCache(String path, int mtimeMs) async {
    if (_thumbCacheDir == null) return null;
    // Intentar webp primero, luego jpeg
    for (final ext in ['webp', 'jpg']) {
      final file = File('${_thumbCacheDir!.path}/${_thumbCacheFilename(path, mtimeMs, ext)}');
      if (await file.exists()) {
        return file.readAsBytes();
      }
    }
    return null;
  }

  Future<void> _saveThumbToDiskCache(
      String path, int mtimeMs, Uint8List data, String ext) async {
    if (_thumbCacheDir == null) return;
    final file = File('${_thumbCacheDir!.path}/${_thumbCacheFilename(path, mtimeMs, ext)}');
    try {
      await file.writeAsBytes(data, flush: false);
    } catch (_) {}
  }

  // ── Router ────────────────────────────────────────────────────────────────

  Handler _buildRouter() {
    final router = Router();

    router.get('/api/ping', (Request req) {
      return _json({'app': 'WiXplorer', 'version': '1.0', 'deviceName': _deviceName()});
    });

    router.post('/api/auth', (Request req) async {
      final client = _clientIp(req);
      // Exigir JSON obliga a los navegadores a hacer preflight CORS en
      // requests cross-origin: una página ajena no puede probar PINs (ni
      // bloquear al usuario) con un simple POST de formulario.
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return _json({'error': 'unsupported_media_type'}, status: 415);
      }
      if (AuthService.instance.isBlockedFor(client)) {
        return _tooManyAttempts();
      }
      final body = await req.readAsString();
      final Map<String, dynamic> json;
      try {
        json = jsonDecode(body) as Map<String, dynamic>;
      } catch (_) {
        return _json({'error': 'invalid_body'}, status: 400);
      }
      final pin = json['pin'];
      if (pin is! String) return _json({'error': 'missing_pin'}, status: 400);

      final token = AuthService.instance.validatePin(pin, client: client);
      if (token == null) {
        if (AuthService.instance.isBlockedFor(client)) return _tooManyAttempts();
        return _json({'error': 'invalid_pin'}, status: 401);
      }
      return _json({'token': token});
    });

    router.get('/api/storages', (Request req) {
      final list = FileService.instance.storages.map((s) => s.toJson()).toList();
      return _json(list);
    });

    // Lista de archivos — soporta NDJSON streaming para renderizado progresivo.
    // El cliente señala soporte enviando Accept: application/x-ndjson.
    router.get('/api/files', (Request req) async {
      final path = req.url.queryParameters['path'];
      if (path == null || path.isEmpty) {
        return _json({'error': 'missing path'}, status: 400);
      }

      final wantsNdjson = (req.headers['accept'] ?? '').contains('x-ndjson');

      // Validación rápida antes de iniciar la respuesta (necesario para NDJSON
      // porque una vez que enviamos Response.ok ya no podemos cambiar el status).
      try {
        await FileService.instance.validatePath(path);
      } on FileSystemException catch (e) {
        final status = e.message.contains('denegado') ? 403 : 404;
        return _json({'error': e.message}, status: status);
      }

      if (wantsNdjson) {
        // Streaming NDJSON: emite ítems en batches a medida que se completan
        // los stat() paralelos. El cliente React puede renderizar progresivamente.
        //
        // Nota: NO setear 'transfer-encoding: chunked' manualmente — Dart's
        // HttpResponse lo gestiona solo cuando el body es un Stream sin
        // content-length. Setearlo explícitamente lanza HttpException y la
        // conexión se cierra sin enviar ningún header (ERR_EMPTY_RESPONSE).
        //
        // Si falla a mitad del listado se emite una última línea
        // {"error": "..."} para que el cliente no tome la lista truncada
        // como completa. Si el cliente corta la conexión, onCancel detiene
        // los stat() pendientes.
        late final StreamSubscription<FileItem> sub;
        final ctrl = StreamController<List<int>>(
          onCancel: () => sub.cancel(),
        );
        sub = FileService.instance.streamFiles(path).listen(
          (item) {
            if (!ctrl.isClosed) {
              ctrl.add(utf8.encode('${jsonEncode(item.toJson())}\n'));
            }
          },
          onError: (Object e) {
            debugPrint('[WiXplorer] streamFiles error: $e');
            if (!ctrl.isClosed) {
              final msg = e is FileSystemException ? e.message : 'Error al leer el directorio';
              ctrl.add(utf8.encode('${jsonEncode({'error': msg})}\n'));
              ctrl.close();
            }
          },
          onDone: () { if (!ctrl.isClosed) ctrl.close(); },
          cancelOnError: true,
        );
        return Response.ok(
          ctrl.stream,
          headers: {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'x-accel-buffering': 'no',
          },
        );
      } else {
        // JSON array clásico (compatibilidad con clientes viejos)
        try {
          final items = await FileService.instance.listFiles(path);
          return _json(items.map((i) => i.toJson()).toList());
        } on FileSystemException catch (e) {
          final status = e.message.contains('denegado') ? 403 : 404;
          return _json({'error': e.message}, status: status);
        }
      }
    });

    // Descarga / streaming con soporte de Range requests
    router.get('/api/file', (Request req) async {
      final path = req.url.queryParameters['path'];
      if (path == null || path.isEmpty) {
        return _json({'error': 'missing path'}, status: 400);
      }
      try {
        final file = await FileService.instance.openFile(path);
        if (!await file.exists()) return _json({'error': 'not found'}, status: 404);

        final mimeType = lookupMimeType(path) ?? 'application/octet-stream';
        final name = path.split('/').last;
        final fileLength = await file.length();
        // En modo auto-hospedado los archivos comparten origen con la web:
        // un .html/.svg del teléfono abierto inline podría ejecutar scripts
        // ahí. nosniff + CSP sandbox lo impiden, y solo la multimedia
        // (que usan <img>/<video>/<audio>) se sirve inline.
        final fileHeaders = {
          'content-type': mimeType,
          'accept-ranges': 'bytes',
          'content-disposition': contentDisposition(name, inline: isSafeInlineType(mimeType)),
          'x-content-type-options': 'nosniff',
          'content-security-policy': 'sandbox',
        };

        switch (parseRange(req.headers['range'], fileLength)) {
          case RangeNotSatisfiable():
            return Response(
              416,
              headers: {
                'content-range': 'bytes */$fileLength',
                'accept-ranges': 'bytes',
              },
            );
          case RangeSatisfiable(:final range):
            return Response(
              206,
              body: file.openRead(range.start, range.end + 1),
              headers: {
                ...fileHeaders,
                'content-length': range.length.toString(),
                'content-range': 'bytes ${range.start}-${range.end}/$fileLength',
              },
            );
          case RangeIgnored():
            break;
        }

        return Response.ok(
          file.openRead(),
          headers: {
            ...fileHeaders,
            'content-length': fileLength.toString(),
          },
        );
      } on FileSystemException catch (e) {
        return _json({'error': e.message}, status: 403);
      }
    });

    // Eliminar uno o varios archivos/carpetas
    router.delete('/api/file', (Request req) async {
      final body = await req.readAsString();
      final Map<String, dynamic> json;
      try {
        json = jsonDecode(body) as Map<String, dynamic>;
      } catch (_) {
        return _json({'error': 'invalid_body'}, status: 400);
      }
      final rawPaths = json['paths'];
      if (rawPaths is! List || rawPaths.isEmpty || rawPaths.any((p) => p is! String)) {
        return _json({'error': 'missing paths'}, status: 400);
      }
      final paths = rawPaths.cast<String>();
      final deleted = <String>[];
      final failed = <Map<String, String>>[];
      for (final path in paths) {
        try {
          await FileService.instance.deleteItem(path);
          deleted.add(path);
        } on FileSystemException catch (e) {
          failed.add({'path': path, 'error': e.message});
        }
      }
      if (failed.isNotEmpty) {
        // 207: algunos se borraron y otros no; 403 si no se borró ninguno.
        return _json({
          'error': failed.map((f) => f['error']).join('; '),
          'deleted': deleted,
          'failed': failed,
        }, status: deleted.isEmpty ? 403 : 207);
      }
      return _json({'ok': true, 'deleted': deleted});
    });

    // Thumbnail con caché en disco + semáforo de concurrencia
    router.get('/api/thumb', (Request req) async {
      final path = req.url.queryParameters['path'];
      if (path == null || path.isEmpty) {
        return _json({'error': 'missing path'}, status: 400);
      }
      try {
        final file = await FileService.instance.openFile(path);
        if (!await file.exists()) return _json({'error': 'not found'}, status: 404);

        final mimeType = lookupMimeType(path) ?? '';
        final ext = path.contains('.')
            ? path.substring(path.lastIndexOf('.')).toLowerCase()
            : '';

        const videoExts = {
          '.mp4', '.mkv', '.mov', '.avi', '.webm',
          '.3gp', '.m4v', '.ts', '.flv', '.wmv',
        };
        final isImage = mimeType.startsWith('image/');
        final isVideo = mimeType.startsWith('video/') || videoExts.contains(ext);

        if (!isImage && !isVideo) {
          return _json({'error': 'unsupported type'}, status: 415);
        }

        const cacheHeaders = <String, String>{
          'cache-control': 'public, max-age=86400',
        };

        // 1. Intentar caché en disco (evita recomprimir en sesiones subsiguientes)
        final fileStat = await file.stat();
        final mtimeMs = fileStat.modified.millisecondsSinceEpoch;
        final cached = await _getThumbFromDiskCache(path, mtimeMs);
        if (cached != null) {
          final cachedMime = cached.length > 3 &&
              cached[0] == 0x52 && cached[1] == 0x49 && cached[2] == 0x46
              ? 'image/webp'
              : 'image/jpeg';
          return Response.ok(
            Stream.value(cached),
            headers: {
              'content-type': cachedMime,
              'content-length': cached.length.toString(),
              ...cacheHeaders,
            },
          );
        }

        // 2. Generar thumbnail (dentro del semáforo para limitar concurrencia)
        return await _withThumbSlot(() async {
          if (isImage) {
            final Uint8List srcBytes;
            try {
              srcBytes = await file.readAsBytes();
            } catch (_) {
              return Response(204);
            }
            try {
              // Primario: WebP nativo via FlutterImageCompress (hilo nativo, no bloquea Dart)
              final webpData = await FlutterImageCompress.compressWithList(
                srcBytes,
                minWidth: 320,
                minHeight: 320,
                quality: 72,
                format: CompressFormat.webp,
                keepExif: false,
              );
              if (webpData.isNotEmpty) {
                unawaited(_saveThumbToDiskCache(path, mtimeMs, webpData, 'webp'));
                return Response.ok(
                  Stream.value(webpData),
                  headers: {
                    'content-type': 'image/webp',
                    'content-length': webpData.length.toString(),
                    ...cacheHeaders,
                  },
                );
              }
            } catch (_) {}

            // Fallback: JPEG en Dart Isolate (no bloquea el isolate principal)
            try {
              final jpegData = await compute(_encodeJpegThumbnail, srcBytes);
              if (jpegData.isNotEmpty) {
                unawaited(_saveThumbToDiskCache(path, mtimeMs, jpegData, 'jpg'));
                return Response.ok(
                  Stream.value(jpegData),
                  headers: {
                    'content-type': 'image/jpeg',
                    'content-length': jpegData.length.toString(),
                    ...cacheHeaders,
                  },
                );
              }
            } catch (_) {}

            // Último fallback: el original, solo si es chico. Para una foto
            // de varios MB (o un RAW) es mejor no tener miniatura que
            // mandarla entera en cada grilla.
            if (srcBytes.length <= _maxOriginalAsThumb && mimeType != 'image/svg+xml') {
              return Response.ok(
                Stream.value(srcBytes),
                headers: {
                  'content-type': mimeType,
                  'content-length': srcBytes.length.toString(),
                  'x-content-type-options': 'nosniff',
                  ...cacheHeaders,
                },
              );
            }
            return Response(204);
          }

          // Video: frame JPEG nativo → recomprimir a WebP
          Uint8List? frameData;
          try {
            frameData = await _videoThumbnailer.saveThumbnailToBytes(
              srcFile: path,
              width: 320,
              height: 320,
              quality: 70,
            );
          } catch (_) {}

          if (frameData != null) {
            Uint8List outData = frameData;
            String outMime = 'image/jpeg';
            String outExt = 'jpg';
            try {
              final webp = await FlutterImageCompress.compressWithList(
                frameData,
                minWidth: 320,
                minHeight: 320,
                quality: 72,
                format: CompressFormat.webp,
                keepExif: false,
              );
              if (webp.isNotEmpty) {
                outData = webp;
                outMime = 'image/webp';
                outExt = 'webp';
              }
            } catch (_) {}
            unawaited(_saveThumbToDiskCache(path, mtimeMs, outData, outExt));
            return Response.ok(
              Stream.value(outData),
              headers: {
                'content-type': outMime,
                'content-length': outData.length.toString(),
                ...cacheHeaders,
              },
            );
          }

          return Response(204); // codec no soportado
        });
      } on FileSystemException catch (e) {
        return _json({'error': e.message}, status: 403);
      }
    });

    // Web UI — activos React embebidos. Sin auth, al final para no interceptar /api/*.
    router.get('/<path|.*>', (Request req, String path) {
      final assetKey = path.isEmpty ? 'assets/www/index.html' : 'assets/www/$path';
      var bytes = _webAssets[assetKey];
      var servedPath = path.isEmpty ? 'index.html' : path;

      if (bytes == null) {
        // Un archivo inexistente (p.ej. un .js de un build viejo) es 404:
        // devolverle index.html con content-type de JS rompe la carga.
        // Solo las rutas sin extensión caen al shell de la SPA.
        if (path.startsWith('api/') || p.extension(path).isNotEmpty) {
          return Response.notFound('Not found');
        }
        bytes = _webAssets['assets/www/index.html'];
        servedPath = 'index.html';
      }

      if (bytes == null) {
        return Response.notFound('WiXplorer web UI not found. Run build_mobile_web.sh first.');
      }

      final mimeType = lookupMimeType(servedPath) ?? 'application/octet-stream';
      // Solo los assets de Vite llevan hash en el nombre y se pueden cachear
      // para siempre. index.html, sw.js, favicon.svg, etc. se revalidan.
      final cacheControl = servedPath.startsWith('assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache';

      return Response.ok(
        Stream.value(bytes),
        headers: {
          'content-type': mimeType,
          'content-length': bytes.length.toString(),
          'cache-control': cacheControl,
        },
      );
    });

    return router.call;
  }

  // ── Middlewares ───────────────────────────────────────────────────────────

  /// CORS restringido: solo la web del propio teléfono y la del launcher de
  /// escritorio (loopback) pueden usar la API desde un navegador. Un request
  /// con `Origin` de cualquier otro sitio se rechaza antes de llegar a la API.
  /// Los requests sin `Origin` (navegación, <img>/<video> del mismo origen,
  /// curl) pasan: la API igual exige el token.
  Middleware _corsMiddleware() {
    return (Handler inner) {
      return (Request req) async {
        final origin = req.headers['origin'];
        if (origin != null && !isAllowedOrigin(origin, host: req.headers['host'])) {
          return Response.forbidden('Origin not allowed', headers: {'vary': 'origin'});
        }
        final cors = origin == null ? const <String, String>{} : _corsHeaders(origin);
        if (req.method == 'OPTIONS') {
          return Response.ok('', headers: cors);
        }
        final response = await inner(req);
        if (cors.isEmpty) return response;
        // Conservar el Vary que ya puso gzip (accept-encoding)
        final vary = response.headers['vary'];
        return response.change(headers: {
          ...cors,
          if (vary != null) 'vary': '$vary, origin',
        });
      };
    };
  }

  /// Comprime con gzip las respuestas JSON de más de 512 bytes, solo si el
  /// cliente lo acepta. No toca NDJSON (streaming) ni archivos.
  Middleware _gzipJsonMiddleware() {
    return (Handler inner) {
      return (Request req) async {
        final response = await inner(req);
        final acceptsGzip = (req.headers['accept-encoding'] ?? '').contains('gzip');
        final contentType = response.headers['content-type'] ?? '';
        if (!acceptsGzip ||
            !contentType.startsWith('application/json') ||
            response.headers.containsKey('content-encoding')) {
          return response;
        }
        final bytes = await response.read().expand((chunk) => chunk).toList();
        if (bytes.length <= 512) {
          return response.change(body: bytes);
        }
        final compressed = GZipCodec().encode(bytes);
        return response.change(
          body: compressed,
          headers: {
            'content-encoding': 'gzip',
            'content-length': compressed.length.toString(),
            'vary': 'accept-encoding',
          },
        );
      };
    };
  }

  Middleware _activityMiddleware() {
    return (Handler inner) {
      return (Request req) async {
        if (!req.url.path.startsWith('api/')) return inner(req);

        _activeRequests++;
        _resetInactivityTimer();
        var finished = false;
        void finish() {
          if (finished) return;
          finished = true;
          _activeRequests--;
          // La inactividad se cuenta desde que terminó la última respuesta
          if (_activeRequests == 0) _resetInactivityTimer();
        }

        try {
          final response = await inner(req);
          return response.change(body: _onBodyDone(response.read(), finish));
        } catch (_) {
          finish();
          rethrow;
        }
      };
    };
  }

  /// Envuelve [body] para llamar a [onDone] cuando termina de enviarse o el
  /// cliente corta la conexión.
  static Stream<List<int>> _onBodyDone(Stream<List<int>> body, void Function() onDone) {
    late final StreamController<List<int>> ctrl;
    ctrl = StreamController<List<int>>(
      onListen: () {
        final sub = body.listen(
          ctrl.add,
          onError: ctrl.addError,
          onDone: () {
            onDone();
            ctrl.close();
          },
        );
        ctrl
          ..onPause = sub.pause
          ..onResume = sub.resume
          ..onCancel = () {
            onDone();
            return sub.cancel();
          };
      },
    );
    return ctrl.stream;
  }

  Middleware _authMiddleware() {
    return (Handler inner) {
      return (Request req) async {
        final path = req.url.path;
        final isApiRoute = path.startsWith('api/');
        final isPublicApi = path == 'api/ping' || path == 'api/auth';
        if (!isApiRoute || isPublicApi) return inner(req);

        // Aceptar token via header Bearer O via query param ?token=
        // El query param permite usar URLs directas en <img src> y <video src>
        // donde no es posible enviar headers personalizados.
        final authHeader = req.headers['authorization'] ?? '';
        final token = authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : req.url.queryParameters['token'] ?? '';

        if (!AuthService.instance.validateToken(token)) {
          return _json({'error': 'unauthorized'}, status: 401);
        }
        return inner(req);
      };
    };
  }

  // ── Inactividad ───────────────────────────────────────────────────────────

  /// "Mantener activo": reinicia la cuenta de inactividad desde la app.
  void keepAlive() {
    if (_current.isRunning) _resetInactivityTimer();
  }

  void _resetInactivityTimer() {
    _inactivityTimer?.cancel();
    _autoStopTimer?.cancel();
    if (_current.inactivityWarning) {
      _emit(_current.copyWith(inactivityWarning: false, autoStopAt: null));
    }
    // Con transferencias en curso no se cuenta; se reinicia al terminar.
    if (_activeRequests > 0) return;

    _inactivityTimer = Timer(_inactivityThreshold, () {
      if (!_current.isRunning) return;
      _emit(_current.copyWith(
        inactivityWarning: true,
        autoStopAt: DateTime.now().add(_autoStopAfter - _inactivityThreshold),
      ));
    });
    _autoStopTimer = Timer(_autoStopAfter, () {
      if (_current.isRunning && _activeRequests == 0) stop();
    });
  }

  // ── Web assets ────────────────────────────────────────────────────────────

  /// Pre-carga todos los assets de assets/www/ en paralelo usando Future.wait.
  /// Antes era secuencial; con ~8 assets, esto reduce el tiempo de carga ~5×.
  Future<void> _preloadWebAssets() async {
    _webAssets.clear();
    final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
    final keys = manifest.listAssets().where((k) => k.startsWith('assets/www/')).toList();

    await Future.wait(keys.map((key) async {
      try {
        final data = await rootBundle.load(key);
        _webAssets[key] = data.buffer.asUint8List();
      } catch (e) {
        debugPrint('[WiXplorer] Error cargando asset $key: $e');
      }
    }));

    debugPrint('[WiXplorer] Assets web cargados: ${_webAssets.length}');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  static Map<String, String> _corsHeaders(String origin) => {
        'access-control-allow-origin': origin,
        'vary': 'origin',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, range, accept',
        'access-control-expose-headers': 'content-range, accept-ranges, content-length',
      };

  /// Serializa [data] a JSON. La compresión la decide [_gzipJsonMiddleware].
  static Response _json(Object data, {int status = 200}) {
    return Response(
      status,
      body: jsonEncode(data),
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  }

  static Response _tooManyAttempts() => _json(
        {
          'error': 'too_many_attempts',
          'retryAfter': AuthService.instance.blockDuration.inSeconds,
        },
        status: 429,
      );

  /// IP del cliente según la conexión TCP (no hay proxies en el medio).
  static String _clientIp(Request req) {
    final info = req.context['shelf.io.connection_info'];
    return info is HttpConnectionInfo ? info.remoteAddress.address : '';
  }

  Future<String> _localIp() async {
    try {
      return await NetworkInfo().getWifiIP() ?? '—';
    } catch (_) {
      return '—';
    }
  }

  String _deviceName() => _cachedDeviceName ?? Platform.localHostname;

  static Future<String> _resolveDeviceName() async {
    try {
      final info = DeviceInfoPlugin();
      if (Platform.isAndroid) {
        final android = await info.androidInfo;
        final brand = _capitalize(android.brand);
        final model = android.model;
        if (model.toLowerCase().startsWith(android.brand.toLowerCase())) return model;
        return '$brand $model';
      } else if (Platform.isIOS) {
        return (await info.iosInfo).name;
      }
    } catch (_) {}
    return Platform.localHostname;
  }

  static String _capitalize(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1).toLowerCase();

  /// Pide los permisos de almacenamiento (y de notificaciones en Android 13+).
  ///
  /// En Android 11+ el acceso a todos los archivos (PDF, ZIP, APK, Download…)
  /// requiere MANAGE_EXTERNAL_STORAGE, que se concede desde Ajustes. Si el
  /// usuario lo rechaza, se sigue con los permisos de multimedia y el servidor
  /// arranca en modo limitado (solo fotos, videos y audio).
  Future<_StorageAccess> _requestStoragePermissions() async {
    if (!Platform.isAndroid) return _StorageAccess.full;

    final sdk = (await DeviceInfoPlugin().androidInfo).version.sdkInt;

    // Sin este permiso el foreground service corre, pero la notificación
    // persistente no se muestra. El resultado no bloquea el arranque.
    if (sdk >= 33) await Permission.notification.request();

    if (sdk >= 30) {
      final manage = Permission.manageExternalStorage;
      if (await manage.isGranted || (await manage.request()).isGranted) {
        return _StorageAccess.full;
      }
    }

    if (sdk >= 33) {
      final results = await [
        Permission.photos,
        Permission.videos,
        Permission.audio,
      ].request();
      return results.values.any((s) => s.isGranted)
          ? _StorageAccess.mediaOnly
          : _StorageAccess.denied;
    }

    if (!(await Permission.storage.request()).isGranted) return _StorageAccess.denied;
    // Android ≤ 10 con READ_EXTERNAL_STORAGE ve todo; en 11–12 solo multimedia.
    return sdk >= 30 ? _StorageAccess.mediaOnly : _StorageAccess.full;
  }

  void _emit(ServerState state) {
    _current = state;
    _stateController.add(state);
  }
}

/// Nivel de acceso al almacenamiento obtenido al iniciar el servidor.
enum _StorageAccess { full, mediaOnly, denied }

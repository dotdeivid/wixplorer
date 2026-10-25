import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart' show compute, debugPrint;
import 'package:flutter/services.dart' show AssetManifest, rootBundle;
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image/image.dart' as img;
import 'package:mime/mime.dart';
import 'package:network_info_plus/network_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:shelf_router/shelf_router.dart';
import 'package:video_thumbnail/video_thumbnail.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../models/server_status.dart';
import 'auth_service.dart';
import 'file_service.dart';
import 'foreground_service_channel.dart';

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
  ServerService._();
  static final ServerService instance = ServerService._();

  static const int _port = 7070;
  static const Duration _inactivityThreshold = Duration(minutes: 15);

  // ── Semáforo para generación de thumbnails ────────────────────────────────
  // Limita las compresiones de imagen concurrentes para no saturar la CPU/GPU.
  static const int _maxConcurrentThumbs = 3;
  int _activeThumbOps = 0;
  final _thumbSlotQueue = <Completer<void>>[];

  HttpServer? _server;
  String? _cachedDeviceName;
  Timer? _inactivityTimer;

  // Assets web pre-cargados en memoria.
  final Map<String, Uint8List> _webAssets = {};

  // Directorio de caché de thumbnails en disco (temp del SO).
  Directory? _thumbCacheDir;

  final _stateController = StreamController<ServerState>.broadcast();

  Stream<ServerState> get stateStream => _stateController.stream;
  ServerState _current = const ServerState.stopped();
  ServerState get current => _current;

  Future<void> start() async {
    if (_current.isRunning) return;
    _emit(const ServerState(status: ServerStatus.starting));

    final granted = await _requestStoragePermissions();
    if (!granted) {
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

    try {
      final handler = const Pipeline()
          .addMiddleware(_corsMiddleware())
          .addMiddleware(_activityMiddleware())
          .addMiddleware(_authMiddleware())
          .addHandler(_buildRouter());

      _server = await shelf_io.serve(handler, InternetAddress.anyIPv4, _port);
      _server!.autoCompress = false; // No usar — interfiere con range requests de video

      await ForegroundServiceChannel.start(ip: ip, port: _port);
      await WakelockPlus.enable();

      _emit(ServerState(
        status: ServerStatus.running,
        ip: ip,
        port: _port,
        pin: AuthService.instance.currentPin,
      ));
      _resetInactivityTimer();
    } catch (e) {
      _emit(ServerState(
        status: ServerStatus.error,
        errorMessage: 'No se pudo iniciar el servidor: $e',
      ));
    }
  }

  Future<void> stop() async {
    _inactivityTimer?.cancel();
    _inactivityTimer = null;
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
      if (AuthService.instance.isBlocked) {
        return _json({'error': 'too_many_attempts'}, status: 429);
      }
      final body = await req.readAsString();
      final Map<String, dynamic> json;
      try {
        json = jsonDecode(body) as Map<String, dynamic>;
      } catch (_) {
        return _json({'error': 'invalid_body'}, status: 400);
      }
      final pin = json['pin'] as String?;
      if (pin == null) return _json({'error': 'missing_pin'}, status: 400);

      final token = AuthService.instance.validatePin(pin);
      if (token == null) {
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
        final ctrl = StreamController<List<int>>();
        FileService.instance.streamFiles(path).listen(
          (item) {
            if (!ctrl.isClosed) {
              ctrl.add(utf8.encode('${jsonEncode(item.toJson())}\n'));
            }
          },
          onError: (e) {
            debugPrint('[WiXplorer] streamFiles error: $e');
            if (!ctrl.isClosed) ctrl.close();
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
        final file = FileService.instance.openFile(path);
        if (!await file.exists()) return _json({'error': 'not found'}, status: 404);

        final mimeType = lookupMimeType(path) ?? 'application/octet-stream';
        final name = path.split('/').last;
        final fileLength = await file.length();
        final rangeHeader = req.headers['range'];

        if (rangeHeader != null && rangeHeader.startsWith('bytes=')) {
          final rangePart = rangeHeader.substring(6);
          final parts = rangePart.split('-');
          final start = int.tryParse(parts[0]) ?? 0;
          final end = (parts.length > 1 && parts[1].isNotEmpty)
              ? (int.tryParse(parts[1]) ?? fileLength - 1)
              : fileLength - 1;

          final clampedStart = start.clamp(0, fileLength - 1);
          final clampedEnd = end.clamp(clampedStart, fileLength - 1);
          final length = clampedEnd - clampedStart + 1;

          return Response(
            206,
            body: file.openRead(clampedStart, clampedEnd + 1),
            headers: {
              'content-type': mimeType,
              'content-length': length.toString(),
              'content-range': 'bytes $clampedStart-$clampedEnd/$fileLength',
              'accept-ranges': 'bytes',
              'content-disposition': 'inline; filename="${Uri.encodeComponent(name)}"',
            },
          );
        }

        return Response.ok(
          file.openRead(),
          headers: {
            'content-type': mimeType,
            'content-length': fileLength.toString(),
            'accept-ranges': 'bytes',
            'content-disposition': 'attachment; filename="${Uri.encodeComponent(name)}"',
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
      final paths = (json['paths'] as List?)?.cast<String>();
      if (paths == null || paths.isEmpty) {
        return _json({'error': 'missing paths'}, status: 400);
      }
      final errors = <String>[];
      for (final path in paths) {
        try {
          await FileService.instance.deleteItem(path);
        } on FileSystemException catch (e) {
          errors.add(e.message);
        }
      }
      if (errors.isNotEmpty) {
        return _json({'error': errors.join('; ')}, status: 403);
      }
      return _json({'ok': true});
    });

    // Thumbnail con caché en disco + semáforo de concurrencia
    router.get('/api/thumb', (Request req) async {
      final path = req.url.queryParameters['path'];
      if (path == null || path.isEmpty) {
        return _json({'error': 'missing path'}, status: 400);
      }
      try {
        final file = FileService.instance.openFile(path);
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
            try {
              final srcBytes = await file.readAsBytes();
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
              final srcBytes = await file.readAsBytes();
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

            // Último fallback: archivo original
            return Response.ok(
              file.openRead(),
              headers: {
                'content-type': mimeType,
                'content-length': fileStat.size.toString(),
                ...cacheHeaders,
              },
            );
          }

          // Video: frame JPEG via VideoThumbnail → recomprimir a WebP
          Uint8List? frameData;
          try {
            frameData = await VideoThumbnail.thumbnailData(
              video: 'file://$path',
              imageFormat: ImageFormat.JPEG,
              maxWidth: 320,
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
      final bytes = _webAssets[assetKey] ?? _webAssets['assets/www/index.html'];

      if (bytes == null) {
        return Response.notFound('WiXplorer web UI not found. Run build_mobile_web.sh first.');
      }

      final mimeType = lookupMimeType(path) ?? 'text/html; charset=utf-8';
      final cacheControl = path.isEmpty || path == 'index.html'
          ? 'no-cache'
          : 'public, max-age=31536000, immutable';

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

  Middleware _corsMiddleware() {
    return (Handler inner) {
      return (Request req) async {
        if (req.method == 'OPTIONS') {
          return Response.ok('', headers: _corsHeaders());
        }
        final response = await inner(req);
        return response.change(headers: _corsHeaders());
      };
    };
  }

  Middleware _activityMiddleware() {
    return (Handler inner) {
      return (Request req) async {
        if (req.url.path.startsWith('api/')) {
          _resetInactivityTimer();
        }
        return inner(req);
      };
    };
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

  void _resetInactivityTimer() {
    _inactivityTimer?.cancel();
    if (_current.inactivityWarning) {
      _emit(_current.copyWith(inactivityWarning: false));
    }
    _inactivityTimer = Timer(_inactivityThreshold, () {
      if (_current.isRunning) {
        _emit(_current.copyWith(inactivityWarning: true));
      }
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

  static Map<String, String> _corsHeaders() => {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, range, accept',
        'access-control-expose-headers': 'content-range, accept-ranges, content-length',
      };

  /// Serializa [data] a JSON y comprime con gzip si el payload supera 512 bytes.
  static Response _json(Object data, {int status = 200}) {
    final jsonStr = jsonEncode(data);
    final bytes = utf8.encode(jsonStr);

    if (bytes.length > 512) {
      final compressed = Uint8List.fromList(GZipCodec().encode(bytes));
      return Response(
        status,
        body: Stream.value(compressed),
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-encoding': 'gzip',
          'content-length': compressed.length.toString(),
        },
      );
    }

    return Response(
      status,
      body: jsonStr,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
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

  Future<bool> _requestStoragePermissions() async {
    if (!Platform.isAndroid) return true;

    final results = await [
      Permission.photos,
      Permission.videos,
      Permission.audio,
    ].request();

    final anyGranted = results.values.any((s) => s.isGranted);
    if (anyGranted) return true;

    return (await Permission.storage.request()).isGranted;
  }

  void _emit(ServerState state) {
    _current = state;
    _stateController.add(state);
  }
}

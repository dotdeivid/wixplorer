import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:wixplorer_mobile/services/file_service.dart';

void main() {
  late Directory sandbox;
  late String root;

  Future<String> resolve(String path) => FileService.resolveWithinRoots(path, [root]);
  final denied = throwsA(isA<FileSystemException>());

  setUp(() {
    // Estructura:
    //   sandbox/storage/0/DCIM/foto.jpg   ← raíz permitida: storage/0
    //   sandbox/storage/0-evil/
    //   sandbox/secret/clave.txt
    sandbox = Directory.systemTemp.createTempSync('wixplorer_test_');
    root = p.join(sandbox.path, 'storage', '0');
    Directory(p.join(root, 'DCIM')).createSync(recursive: true);
    File(p.join(root, 'DCIM', 'foto.jpg')).writeAsStringSync('jpg');
    Directory(p.join(sandbox.path, 'storage', '0-evil')).createSync();
    Directory(p.join(sandbox.path, 'secret')).createSync();
    File(p.join(sandbox.path, 'secret', 'clave.txt')).writeAsStringSync('x');
  });

  tearDown(() => sandbox.deleteSync(recursive: true));

  group('FileService.resolveWithinRoots', () {
    test('permite la raíz y lo que cuelga de ella', () async {
      expect(await resolve(root), p.canonicalize(root));
      expect(
        await resolve(p.join(root, 'DCIM', 'foto.jpg')),
        p.canonicalize(p.join(root, 'DCIM', 'foto.jpg')),
      );
    });

    test('permite paths que todavía no existen dentro de la raíz', () async {
      expect(
        await resolve(p.join(root, 'nueva', 'carpeta')),
        p.canonicalize(p.join(root, 'nueva', 'carpeta')),
      );
    });

    test('colapsa ".." que se queda dentro de la raíz', () async {
      expect(
        await resolve(p.join(root, 'DCIM', '..', 'DCIM')),
        p.canonicalize(p.join(root, 'DCIM')),
      );
    });

    test('bloquea traversal con ".."', () async {
      await expectLater(resolve(p.join(root, '..', '..', 'secret', 'clave.txt')), denied);
      await expectLater(resolve(p.join(root, '..')), denied);
    });

    test('bloquea un hermano que comparte prefijo de texto', () async {
      await expectLater(resolve(p.join(sandbox.path, 'storage', '0-evil')), denied);
    });

    test('bloquea paths fuera de toda raíz', () async {
      await expectLater(resolve(p.join(sandbox.path, 'secret')), denied);
      await expectLater(resolve('/'), denied);
    });

    test('bloquea symlinks dentro de la raíz que apuntan afuera', () async {
      Link(p.join(root, 'escape')).createSync(p.join(sandbox.path, 'secret'));
      await expectLater(resolve(p.join(root, 'escape')), denied);
      await expectLater(resolve(p.join(root, 'escape', 'clave.txt')), denied);
      await expectLater(resolve(p.join(root, 'escape', 'nuevo.txt')), denied);
    });

    test('permite symlinks que apuntan dentro de la raíz', () async {
      Link(p.join(root, 'atajo')).createSync(p.join(root, 'DCIM'));
      expect(
        await resolve(p.join(root, 'atajo', 'foto.jpg')),
        p.canonicalize(p.join(root, 'atajo', 'foto.jpg')),
      );
    });

    test('bloquea symlinks rotos', () async {
      Link(p.join(root, 'roto')).createSync(p.join(sandbox.path, 'no-existe'));
      await expectLater(resolve(p.join(root, 'roto')), denied);
    });

    test(
      'con allowRoot: false rechaza la raíz (también por symlink) pero no su contenido',
      () async {
        Future<String> strict(String path) =>
            FileService.resolveWithinRoots(path, [root], allowRoot: false);
        Link(p.join(sandbox.path, 'alias')).createSync(root);

        await expectLater(strict(root), denied);
        await expectLater(strict(p.join(root, 'DCIM', '..')), denied);
        await expectLater(strict(p.join(sandbox.path, 'alias')), denied);
        expect(
          await strict(p.join(root, 'DCIM')),
          p.canonicalize(p.join(root, 'DCIM')),
        );
      },
    );

    test('sin raíces configuradas todo está denegado', () async {
      await expectLater(FileService.resolveWithinRoots(root, const []), denied);
    });
  });
}

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:wixplorer_mobile/services/file_service.dart';

void main() {
  late Directory sandbox;
  late String root;

  String resolve(String path) => FileService.resolveWithinRoots(path, [root]);
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
    test('permite la raíz y lo que cuelga de ella', () {
      expect(resolve(root), p.canonicalize(root));
      expect(
        resolve(p.join(root, 'DCIM', 'foto.jpg')),
        p.canonicalize(p.join(root, 'DCIM', 'foto.jpg')),
      );
    });

    test('permite paths que todavía no existen dentro de la raíz', () {
      expect(
        resolve(p.join(root, 'nueva', 'carpeta')),
        p.canonicalize(p.join(root, 'nueva', 'carpeta')),
      );
    });

    test('colapsa ".." que se queda dentro de la raíz', () {
      expect(
        resolve(p.join(root, 'DCIM', '..', 'DCIM')),
        p.canonicalize(p.join(root, 'DCIM')),
      );
    });

    test('bloquea traversal con ".."', () {
      expect(
        () => resolve(p.join(root, '..', '..', 'secret', 'clave.txt')),
        denied,
      );
      expect(() => resolve(p.join(root, '..')), denied);
    });

    test('bloquea un hermano que comparte prefijo de texto', () {
      expect(() => resolve(p.join(sandbox.path, 'storage', '0-evil')), denied);
    });

    test('bloquea paths fuera de toda raíz', () {
      expect(() => resolve(p.join(sandbox.path, 'secret')), denied);
      expect(() => resolve('/'), denied);
    });

    test('bloquea symlinks dentro de la raíz que apuntan afuera', () {
      Link(p.join(root, 'escape')).createSync(p.join(sandbox.path, 'secret'));
      expect(() => resolve(p.join(root, 'escape')), denied);
      expect(() => resolve(p.join(root, 'escape', 'clave.txt')), denied);
      expect(() => resolve(p.join(root, 'escape', 'nuevo.txt')), denied);
    });

    test('permite symlinks que apuntan dentro de la raíz', () {
      Link(p.join(root, 'atajo')).createSync(p.join(root, 'DCIM'));
      expect(
        resolve(p.join(root, 'atajo', 'foto.jpg')),
        p.canonicalize(p.join(root, 'atajo', 'foto.jpg')),
      );
    });

    test('bloquea symlinks rotos', () {
      Link(p.join(root, 'roto')).createSync(p.join(sandbox.path, 'no-existe'));
      expect(() => resolve(p.join(root, 'roto')), denied);
    });

    test(
      'con allowRoot: false rechaza la raíz (también por symlink) pero no su contenido',
      () {
        String strict(String path) =>
            FileService.resolveWithinRoots(path, [root], allowRoot: false);
        Link(p.join(sandbox.path, 'alias')).createSync(root);

        expect(() => strict(root), denied);
        expect(() => strict(p.join(root, 'DCIM', '..')), denied);
        expect(() => strict(p.join(sandbox.path, 'alias')), denied);
        expect(
          strict(p.join(root, 'DCIM')),
          p.canonicalize(p.join(root, 'DCIM')),
        );
      },
    );

    test('sin raíces configuradas todo está denegado', () {
      expect(() => FileService.resolveWithinRoots(root, const []), denied);
    });
  });
}

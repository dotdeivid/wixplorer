import 'package:flutter_test/flutter_test.dart';
import 'package:wixplorer_mobile/services/http_range.dart';

ByteRange? satisfiable(RangeResult r) =>
    r is RangeSatisfiable ? r.range : null;

void main() {
  group('parseRange', () {
    test('sin header se ignora', () {
      expect(parseRange(null, 100), isA<RangeIgnored>());
    });

    test('rango cerrado', () {
      expect(satisfiable(parseRange('bytes=0-9', 100)), const ByteRange(0, 9));
      expect(satisfiable(parseRange('bytes=0-0', 100)), const ByteRange(0, 0));
    });

    test('rango abierto llega hasta el final', () {
      expect(satisfiable(parseRange('bytes=10-', 100)), const ByteRange(10, 99));
    });

    test('el final se recorta al tamaño del archivo', () {
      expect(satisfiable(parseRange('bytes=90-500', 100)), const ByteRange(90, 99));
    });

    test('rango sufijo devuelve los últimos n bytes', () {
      expect(satisfiable(parseRange('bytes=-10', 100)), const ByteRange(90, 99));
      expect(satisfiable(parseRange('bytes=-500', 100)), const ByteRange(0, 99));
    });

    test('inicio fuera del archivo es 416', () {
      expect(parseRange('bytes=100-', 100), isA<RangeNotSatisfiable>());
      expect(parseRange('bytes=200-300', 100), isA<RangeNotSatisfiable>());
    });

    test('archivo vacío: cualquier rango es 416 (no lanza)', () {
      expect(parseRange('bytes=0-0', 0), isA<RangeNotSatisfiable>());
      expect(parseRange('bytes=-5', 0), isA<RangeNotSatisfiable>());
    });

    test('sufijo cero es 416', () {
      expect(parseRange('bytes=-0', 100), isA<RangeNotSatisfiable>());
    });

    test('multi-range, otra unidad o sintaxis inválida se ignoran', () {
      expect(parseRange('bytes=0-1,5-6', 100), isA<RangeIgnored>());
      expect(parseRange('items=0-1', 100), isA<RangeIgnored>());
      expect(parseRange('bytes=abc', 100), isA<RangeIgnored>());
      expect(parseRange('bytes=5-2', 100), isA<RangeIgnored>());
      expect(parseRange('bytes=-', 100), isA<RangeIgnored>());
    });
  });
}

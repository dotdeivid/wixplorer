import 'package:flutter_test/flutter_test.dart';
import 'package:wixplorer_mobile/main.dart';

void main() {
  testWidgets('App smoke test — renders without crashing',
      (WidgetTester tester) async {
    await tester.pumpWidget(const WiXplorerApp());
    expect(find.text('WiXplorer'), findsOneWidget);
  });
}

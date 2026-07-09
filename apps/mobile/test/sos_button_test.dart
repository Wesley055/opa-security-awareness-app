import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opa_mobile/src/features/sos/sos_button.dart';

void main() {
  testWidgets('renders accessible SOS button', (tester) async {
    var triggered = false;

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SosButton(onTriggered: () => triggered = true))));

    expect(find.text('SOS'), findsOneWidget);
    await tester.longPress(find.byType(SosButton));
    expect(triggered, isTrue);
  });
}
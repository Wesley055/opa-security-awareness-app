import 'package:flutter_test/flutter_test.dart';
import 'package:opa_mobile/src/features/voice/voice_trigger.dart';

void main() {
  test('matches HELP HELP phrase case-insensitively', () {
    final trigger = VoiceTrigger();
    expect(trigger.matches('help   help'), isTrue);
    expect(trigger.matches('help me'), isFalse);
  });
}
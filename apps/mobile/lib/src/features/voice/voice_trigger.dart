class VoiceTrigger {
  static const phrase = 'HELP HELP';

  bool matches(String transcript) {
    final normalized = transcript.trim().toUpperCase().replaceAll(RegExp(r'\s+'), ' ');
    return normalized == phrase;
  }
}
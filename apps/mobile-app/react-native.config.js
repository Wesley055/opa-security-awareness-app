// Voice protection (Picovoice wake word) is Android-only: iOS does not allow
// an always-on wake word for third-party apps. Keep its native code out of
// the iPhone app entirely (I3: build 8 launch crash, 22 Oct 2026).
module.exports = {
  dependencies: {
    '@picovoice/porcupine-react-native': { platforms: { ios: null } },
    '@picovoice/react-native-voice-processor': { platforms: { ios: null } },
  },
};

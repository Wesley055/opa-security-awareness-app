const { AppRegistry } = require('react-native');

// Register the existing journey background-location task at process startup.
// Android may create a headless JS context without loading journey-tracker,
// so the TaskManager definition must not depend on that foreground import.
require('./src/services/journey-background-task');

AppRegistry.registerHeadlessTask(
  'OpaProtectionEmergencyTrigger',
  () => {
    const {
      runHeadlessProtectionWorker,
    } = require('./src/services/headless-sos-worker');

    return async () => {
      await runHeadlessProtectionWorker();
    };
  },
);

// Expo Router remains the normal application entry point.
require('expo-router/entry');
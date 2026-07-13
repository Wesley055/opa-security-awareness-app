import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>OPA</Text>
      <Text style={styles.subtitle}>Emergency Intelligence & Coordination</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#F5F7F6',
    fontSize: 36,
    fontWeight: '800',
  },
  subtitle: {
    color: '#8896A0',
    fontSize: 14,
    marginTop: 8,
  },
});
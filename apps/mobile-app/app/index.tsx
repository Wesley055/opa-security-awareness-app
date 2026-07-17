import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../src/store/authStore';

export default function HomeScreen() {
  const { user, isLoading, logout } = useAuthStore();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>OPA</Text>
      <Text style={styles.welcome}>
        Welcome, {user?.firstName ?? 'there'}
      </Text>

      <TouchableOpacity
        style={styles.sosButton}
        onPress={() => router.push('/sos')}
        activeOpacity={0.85}
      >
        <Text style={styles.sosButtonText}>SOS</Text>
      </TouchableOpacity>
      <Text style={styles.sosHint}>Tap to activate an emergency</Text>

      <View style={styles.secondaryActions}>
        <TouchableOpacity
          style={styles.contactsButton}
          onPress={() => router.push('/contacts')}
        >
          <Text style={styles.contactsButtonText}>Emergency Contacts</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => logout()}>
          <Text style={styles.buttonText}>Log out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08111A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  logo: {
    fontSize: 40,
    fontWeight: '900',
    color: '#17C964',
    marginBottom: 8,
  },
  welcome: {
    fontSize: 18,
    color: '#FFFFFF',
    marginBottom: 48,
  },
  sosButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#FF5A36',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF5A36',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sosHint: {
    color: '#8B949E',
    fontSize: 13,
    marginTop: 16,
    marginBottom: 48,
  },
  secondaryActions: {
    width: '100%',
    gap: 12,
  },
  button: {
    backgroundColor: '#232E36',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  contactsButton: {
    backgroundColor: '#17C964',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  contactsButtonText: {
    color: '#08111A',
    fontWeight: '700',
  },
});
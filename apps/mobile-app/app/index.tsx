import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
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
      <TouchableOpacity style={styles.button} onPress={() => logout()}>
        <Text style={styles.buttonText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08111A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  logo: {
    fontSize: 40,
    fontWeight: '900',
    color: '#17C964',
    marginBottom: 16,
  },
  welcome: {
    fontSize: 18,
    color: '#FFFFFF',
    marginBottom: 32,
  },
  button: {
    backgroundColor: '#232E36',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
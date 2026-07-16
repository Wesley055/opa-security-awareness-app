import { useState } from 'react';
import {
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store/authStore';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const login = useAuthStore((state) => state.login);

  const handleLogin = async (): Promise<void> => {
    setError(null);
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setIsSubmitting(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace('/');
    } catch (error: unknown) {
      const responseMessage =
        typeof error === 'object' && error !== null && 'response' in error
          ? (
              error as {
                response?: { data?: { message?: string | string[] } };
              }
            ).response?.data?.message
          : undefined;

      setError(
        Array.isArray(responseMessage)
          ? responseMessage.join('\n')
          : responseMessage ?? 'Login failed. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.logo}>OPA</Text>
      <Text style={styles.subtitle}>Sign in to continue</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#8B949E"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!isSubmitting}
      />
      <View style={styles.passwordWrapper}>
        <TextInput
          style={styles.passwordInput}
          placeholder="Password"
          placeholderTextColor="#8B949E"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          textContentType="password"
          editable={!isSubmitting}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />
        <TouchableOpacity
          style={styles.showToggle}
          onPress={() => setShowPassword((prev) => !prev)}
          disabled={isSubmitting}
        >
          <Text style={styles.showToggleText}>
            {showPassword ? 'Hide' : 'Show'}
          </Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={isSubmitting}
        activeOpacity={0.85}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#08111A" />
        ) : (
          <Text style={styles.buttonText}>Sign In</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => router.push('/(auth)/register')}
        disabled={isSubmitting}
        activeOpacity={0.85}
      >
        <Text style={[styles.link, isSubmitting && styles.linkDisabled]}>
          Don't have an account? Create one
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08111A',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    fontSize: 48,
    fontWeight: '900',
    color: '#17C964',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#8B949E',
    textAlign: 'center',
    marginBottom: 32,
  },
  error: {
    color: '#FF5A36',
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 13,
  },
  input: {
    backgroundColor: '#151D24',
    borderWidth: 1,
    borderColor: '#232E36',
    borderRadius: 8,
    padding: 14,
    color: '#FFFFFF',
    marginBottom: 12,
    fontSize: 15,
  },
  passwordWrapper: {
    position: 'relative',
    justifyContent: 'center',
    marginBottom: 12,
  },
  passwordInput: {
    backgroundColor: '#151D24',
    borderWidth: 1,
    borderColor: '#232E36',
    borderRadius: 8,
    padding: 14,
    paddingRight: 60,
    color: '#FFFFFF',
    fontSize: 15,
  },
  showToggle: {
    position: 'absolute',
    right: 14,
  },
  showToggleText: {
    color: '#17C964',
    fontSize: 13,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#17C964',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#08111A',
    fontWeight: '700',
    fontSize: 16,
  },
  link: {
    color: '#17C964',
    textAlign: 'center',
    marginTop: 16,
    fontSize: 14,
  },
  linkDisabled: {
    opacity: 0.5,
  },
});
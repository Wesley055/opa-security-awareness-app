import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/services/api';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestReset = async (): Promise<void> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Enter your email address.');
      return;
    }

    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const { data } = await api.post('/auth/password-reset/request', {
        email: normalizedEmail,
      });
      setMessage(data.message);
    } catch {
      setError('Unable to request a password reset right now. Please try again.');
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
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.subtitle}>
        Enter the email address linked to your OPA account.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}

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

      <TouchableOpacity
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={requestReset}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#08111A" />
        ) : (
          <Text style={styles.buttonText}>Send reset instructions</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.push('/(auth)/reset-password')}
        disabled={isSubmitting}
      >
        <Text style={styles.link}>I have a reset token</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.replace('/(auth)/login')}
        disabled={isSubmitting}
      >
        <Text style={styles.secondaryLink}>Back to sign in</Text>
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
    fontSize: 42,
    fontWeight: '900',
    color: '#17C964',
    textAlign: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: '#8B949E',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#151D24',
    borderWidth: 1,
    borderColor: '#232E36',
    borderRadius: 8,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 15,
    marginBottom: 12,
  },
  error: {
    color: '#FF5A36',
    textAlign: 'center',
    marginBottom: 14,
    fontSize: 13,
  },
  success: {
    color: '#17C964',
    textAlign: 'center',
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 19,
  },
  button: {
    backgroundColor: '#17C964',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: '#08111A',
    fontWeight: '700',
    fontSize: 15,
  },
  link: {
    color: '#17C964',
    textAlign: 'center',
    marginTop: 18,
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryLink: {
    color: '#8B949E',
    textAlign: 'center',
    marginTop: 14,
    fontSize: 13,
  },
});
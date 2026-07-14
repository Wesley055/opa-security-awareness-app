import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';

import { useAuthStore } from '../../src/store/authStore';

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const register = useAuthStore((state) => state.register);

  const handleRegister = async (): Promise<void> => {
    setError(null);

    const normalizedFirstName = firstName.trim();
    const normalizedLastName = lastName.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (
      !normalizedFirstName ||
      !normalizedLastName ||
      !normalizedEmail ||
      !phoneNumber.trim() ||
      !password
    ) {
      setError('All fields are required.');
      return;
    }

    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }

    let normalizedPhone = phoneNumber.trim().replace(/[\s()-]/g, '');

    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = `+234${normalizedPhone.slice(1)}`;
    } else if (normalizedPhone.startsWith('234')) {
      normalizedPhone = `+${normalizedPhone}`;
    } else if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = `+234${normalizedPhone}`;
    }

    setIsSubmitting(true);

    try {
      await register({
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        email: normalizedEmail,
        phoneNumber: normalizedPhone,
        password,
      });

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
          : responseMessage ?? 'Registration failed. Please try again.',
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.logo}>OPA</Text>
        <Text style={styles.subtitle}>Create your account</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="First name"
          placeholderTextColor="#8B949E"
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          editable={!isSubmitting}
        />

        <TextInput
          style={styles.input}
          placeholder="Last name"
          placeholderTextColor="#8B949E"
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
          editable={!isSubmitting}
        />

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

        <TextInput
          style={styles.input}
          placeholder="Phone number, e.g. 08012345678"
          placeholderTextColor="#8B949E"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          editable={!isSubmitting}
        />

        <TextInput
          style={styles.input}
          placeholder="Password, minimum 12 characters"
          placeholderTextColor="#8B949E"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          editable={!isSubmitting}
          returnKeyType="done"
          onSubmitEditing={handleRegister}
        />

        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#08111A" />
          ) : (
            <Text style={styles.buttonText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/(auth)/login')}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          <Text style={[styles.link, isSubmitting && styles.linkDisabled]}>
            Already have an account? Sign in
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08111A',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  logo: {
    fontSize: 40,
    fontWeight: '900',
    color: '#17C964',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#8B949E',
    textAlign: 'center',
    marginBottom: 24,
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
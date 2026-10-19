import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { FormScreen, P } from '../../src/components/FormScreen';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store/authStore';

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [idempotencyKey] = useState(() => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
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
      !phoneNumber.trim()
    ) {
      setError('Fill in all four fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
      setError('Enter your full email address, e.g. name@example.com.');
      return;
    }
    if (!/^[+\d\s()-]{7,20}$/.test(phoneNumber.trim())) {
      setError('Enter your phone number with digits only, e.g. 08012345678.');
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
      const pending = await register({
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        email: normalizedEmail,
        phoneNumber: normalizedPhone,
        idempotencyKey,
      });
      router.replace({ pathname: '/(auth)/enroll', params: { requestId: pending.requestId } });
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
    <FormScreen>
      <P style={styles.logo}>OPA</P>
      <P accessibilityRole="header" style={styles.title}>Create a personal account</P>
      <P>
        For your own safety (SOS, SafeWalk, emergency contacts). We send a 4-digit code to your email and another to your phone to confirm they are yours.
      </P>
      <TouchableOpacity onPress={() => router.push('/(auth)/enroll')} disabled={isSubmitting}>
        <P style={styles.note}>
          Joining an estate, bank or school? Your administrator sends you an invitation. Tap here to accept it instead.
        </P>
      </TouchableOpacity>

      {error ? <P accessibilityRole="alert" style={styles.error}>{error}</P> : null}

      <P style={styles.label}>First name</P>
      <TextInput style={styles.input} placeholder="e.g. Amina" accessibilityLabel="First name"
        placeholderTextColor="#8B949E" value={firstName}
        onChangeText={setFirstName} autoCapitalize="words"
        editable={!isSubmitting} />

      <P style={styles.label}>Last name</P>
      <TextInput style={styles.input} placeholder="e.g. Bello" accessibilityLabel="Last name"
        placeholderTextColor="#8B949E" value={lastName}
        onChangeText={setLastName} autoCapitalize="words"
        editable={!isSubmitting} />

      <P style={styles.label}>Email</P>
      <TextInput style={styles.input} placeholder="name@example.com" accessibilityLabel="Email"
        placeholderTextColor="#8B949E" value={email}
        onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
        keyboardType="email-address" textContentType="emailAddress"
        editable={!isSubmitting} />

      <P style={styles.label}>Phone number</P>
      <TextInput style={styles.input} accessibilityLabel="Phone number"
        placeholder="e.g. 08012345678"
        placeholderTextColor="#8B949E" value={phoneNumber}
        onChangeText={setPhoneNumber} keyboardType="phone-pad"
        textContentType="telephoneNumber" editable={!isSubmitting} />

      <TouchableOpacity
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleRegister}
        disabled={isSubmitting}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#08111A" />
        ) : (
          <Text style={styles.buttonText}>Send my verification codes</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.push('/(auth)/login')}
        disabled={isSubmitting}
        activeOpacity={0.85}
      >
        <P style={[styles.link, isSubmitting && styles.linkDisabled]}>
          Already have an account? Sign in
        </P>
      </TouchableOpacity>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#08111A' },
  logo: {
    fontSize: 40,
    fontWeight: '900',
    color: '#17C964',
    textAlign: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  note: { color: '#5EEAD4', fontSize: 15 },
  label: { color: '#FFFFFF', fontWeight: '600', fontSize: 15, marginBottom: -6 },
  error: {
    color: '#FF7B72',
    fontSize: 15,
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
  showToggle: { position: 'absolute', right: 14 },
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
  buttonDisabled: { opacity: 0.6 },
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
  linkDisabled: { opacity: 0.5 },
});
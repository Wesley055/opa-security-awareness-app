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
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../src/store/authStore';

export default function ActivateScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(
    typeof params.token === 'string' ? params.token : '',
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activate = useAuthStore((state) => state.activate);

  const handleActivate = async (): Promise<void> => {
    setError(null);

    const normalizedToken = token.trim();

    if (!normalizedToken || !password || !confirmPassword) {
      setError('Enter your activation token and create a password.');
      return;
    }

    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      await activate(normalizedToken, password);
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
          : responseMessage ?? 'Activation failed. Please try again.',
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
        <Text style={styles.subtitle}>Activate your OPA account</Text>

        <Text style={styles.helper}>
          Enter the activation token sent by your estate or organization, then
          create your password.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Activation token"
          placeholderTextColor="#8B949E"
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSubmitting}
        />

        <View style={styles.passwordWrapper}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Password, minimum 12 characters"
            placeholderTextColor="#8B949E"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            textContentType="newPassword"
            editable={!isSubmitting}
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

        <TextInput
          style={styles.input}
          placeholder="Confirm password"
          placeholderTextColor="#8B949E"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry={!showPassword}
          textContentType="newPassword"
          editable={!isSubmitting}
          returnKeyType="done"
          onSubmitEditing={handleActivate}
        />

        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          onPress={handleActivate}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#08111A" />
          ) : (
            <Text style={styles.buttonText}>Activate Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.replace('/(auth)/login')}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          <Text style={[styles.link, isSubmitting && styles.linkDisabled]}>
            Already activated? Sign in
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
    marginBottom: 12,
  },
  helper: {
    fontSize: 13,
    color: '#8B949E',
    textAlign: 'center',
    lineHeight: 19,
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
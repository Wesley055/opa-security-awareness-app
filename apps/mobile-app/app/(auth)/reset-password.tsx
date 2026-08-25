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
import { router } from 'expo-router';
import { api } from '../../src/services/api';

export default function ResetPasswordScreen() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitReset = async (): Promise<void> => {
    const normalizedToken = token.trim();
    setError(null);

    if (!normalizedToken) {
      setError('Paste the reset token from your OPA email.');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/auth/password-reset/confirm', {
        token: normalizedToken,
        password,
      });
      router.replace('/(auth)/login');
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
          : responseMessage ??
              'The reset token is invalid or expired. Request a new one.',
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
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>
          Paste the secure token from your email. Reset tokens expire after
          30 minutes and can be used only once.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextInput
          style={[styles.input, styles.tokenInput]}
          placeholder="Reset token"
          placeholderTextColor="#8B949E"
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSubmitting}
        />

        <PasswordField
          label="New password, minimum 12 characters"
          value={password}
          onChange={setPassword}
          visible={showPassword}
          onToggle={() => setShowPassword((v) => !v)}
          editable={!isSubmitting}
        />

        <PasswordField
          label="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          visible={showConfirmPassword}
          onToggle={() => setShowConfirmPassword((v) => !v)}
          editable={!isSubmitting}
        />

        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          onPress={submitReset}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#08111A" />
          ) : (
            <Text style={styles.buttonText}>Reset password</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.replace('/(auth)/login')}
          disabled={isSubmitting}
        >
          <Text style={styles.secondaryLink}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  editable,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  editable: boolean;
}) {
  return (
    <View style={styles.passwordWrapper}>
      <TextInput
        style={styles.passwordInput}
        placeholder={label}
        placeholderTextColor="#8B949E"
        value={value}
        onChangeText={onChange}
        secureTextEntry={!visible}
        textContentType="newPassword"
        editable={editable}
      />
      <TouchableOpacity
        style={styles.showToggle}
        onPress={onToggle}
        disabled={!editable}
      >
        <Text style={styles.showToggleText}>
          {visible ? 'Hide' : 'Show'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#08111A' },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
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
  error: {
    color: '#FF5A36',
    textAlign: 'center',
    marginBottom: 14,
    fontSize: 13,
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
  tokenInput: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
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
    fontSize: 15,
  },
  secondaryLink: {
    color: '#8B949E',
    textAlign: 'center',
    marginTop: 16,
    fontSize: 13,
  },
});
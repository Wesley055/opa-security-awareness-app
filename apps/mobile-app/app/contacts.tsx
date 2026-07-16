import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../src/services/api';

interface EmergencyContact {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
  phoneNumber: string;
  email?: string;
  isPrimary: boolean;
  isActive: boolean;
}

// Emergency contacts can be international (@IsPhoneNumber() on the
// backend, no country restriction) — default to Nigerian formatting
// for a bare local number (the common case), while respecting an
// explicit international number typed with its own country code.
function normalizePhoneNumber(raw: string): string {
  const cleaned = raw.trim().replace(/[\s()-]/g, '');

  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('0')) return `+234${cleaned.slice(1)}`;
  if (cleaned.startsWith('234')) return `+${cleaned}`;
  return `+234${cleaned}`;
}

export default function ContactsScreen() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadContacts = useCallback(async () => {
    try {
      const { data } = await api.get<EmergencyContact[]>('/emergency-contacts');
      setContacts(data);
    } catch {
      Alert.alert('Error', 'Could not load emergency contacts.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadContacts();
    }, [loadContacts]),
  );

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setRelationship('');
    setPhoneNumber('');
    setEmail('');
    setError(null);
  };

  const handleCreate = async () => {
    setError(null);

    if (!firstName.trim() || !lastName.trim() || !relationship.trim() || !phoneNumber.trim()) {
      setError('Name, relationship, and phone number are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/emergency-contacts', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        relationship: relationship.trim(),
        phoneNumber: normalizePhoneNumber(phoneNumber),
        email: email.trim().length > 0 ? email.trim().toLowerCase() : undefined,
      });

      setIsModalVisible(false);
      resetForm();
      await loadContacts();
    } catch (err: unknown) {
      const responseMessage =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { data?: { message?: string | string[] } } }).response?.data
              ?.message
          : undefined;

      setError(
        Array.isArray(responseMessage)
          ? responseMessage.join('\n')
          : responseMessage ?? 'Could not add contact. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (contact: EmergencyContact) => {
    Alert.alert(
      'Remove contact',
      `Remove ${contact.firstName} ${contact.lastName} from your emergency contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/emergency-contacts/${contact.id}`);
              await loadContacts();
            } catch {
              Alert.alert('Error', 'Could not remove contact.');
            }
          },
        },
      ],
    );
  };

  const handleSetPrimary = async (contact: EmergencyContact) => {
    try {
      await api.post(`/emergency-contacts/${contact.id}/set-primary`);
      await loadContacts();
    } catch {
      Alert.alert('Error', 'Could not set primary contact.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Emergency Contacts</Text>
        <TouchableOpacity onPress={() => setIsModalVisible(true)} disabled={isSubmitting}>
          <Text style={styles.addLink}>Add</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} color="#17C964" />
      ) : contacts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No emergency contacts added yet. Add at least one trusted family
            member, friend, or healthcare provider who should receive an
            immediate alert if you activate an OPA emergency.
          </Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardInfo}>
                <View style={styles.cardNameRow}>
                  <Text style={styles.cardName}>
                    {item.firstName} {item.lastName}
                  </Text>
                  {item.isPrimary ? (
                    <View style={styles.primaryBadge}>
                      <Text style={styles.primaryBadgeText}>PRIMARY</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cardDetail}>{item.relationship}</Text>
                <Text style={styles.cardDetail}>{item.phoneNumber}</Text>
                {item.email ? (
                  <Text style={styles.cardDetail}>{item.email}</Text>
                ) : null}
              </View>
              <View style={styles.cardActions}>
                {!item.isPrimary && (
                  <TouchableOpacity onPress={() => handleSetPrimary(item)}>
                    <Text style={styles.actionLink}>Set primary</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => handleDelete(item)}>
                  <Text style={styles.deleteLink}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={isModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Emergency Contact</Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TextInput
              style={styles.input}
              placeholder="First name"
              placeholderTextColor="#8B949E"
              value={firstName}
              onChangeText={setFirstName}
              editable={!isSubmitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Last name"
              placeholderTextColor="#8B949E"
              value={lastName}
              onChangeText={setLastName}
              editable={!isSubmitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Relationship (e.g. Sister, Doctor)"
              placeholderTextColor="#8B949E"
              value={relationship}
              onChangeText={setRelationship}
              editable={!isSubmitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone number (e.g. 08012345678 or +14155552671)"
              placeholderTextColor="#8B949E"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              editable={!isSubmitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Email (optional)"
              placeholderTextColor="#8B949E"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!isSubmitting}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setIsModalVisible(false);
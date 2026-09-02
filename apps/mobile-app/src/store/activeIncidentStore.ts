import { create } from 'zustand';
import { api } from '../services/api';

export interface ActiveIncident {
  id: string;
  status: 'OPEN';
  notifications?: { queued: number; dispatched: boolean };
}

interface IncidentListItem {
  id: string;
  status: string;
}

interface ActiveIncidentState {
  activeIncident: ActiveIncident | null;
  isReconciling: boolean;
  setActiveIncident: (incident: ActiveIncident | null) => void;
  clearActiveIncident: () => void;
  reconcileActiveIncident: () => Promise<ActiveIncident | null>;
}

export const useActiveIncidentStore = create<ActiveIncidentState>((set) => ({
  activeIncident: null,
  isReconciling: false,

  setActiveIncident: (incident) => set({ activeIncident: incident }),

  clearActiveIncident: () => set({ activeIncident: null }),

  reconcileActiveIncident: async () => {
    set({ isReconciling: true });
    try {
      const { data } = await api.get<IncidentListItem[]>('/incidents');
      const open = data.find((incident) => incident.status === 'OPEN') ?? null;
      const active: ActiveIncident | null = open
        ? { id: open.id, status: 'OPEN' }
        : null;
      set({ activeIncident: active });
      return active;
    } finally {
      set({ isReconciling: false });
    }
  },
}));
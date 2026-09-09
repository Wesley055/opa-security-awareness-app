import { create } from 'zustand';
import { backgroundApi } from '../services/api';

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
  reconcileActiveIncident: (isCurrent?: () => boolean) => Promise<ActiveIncident | null>;
}

let revision = 0;
let requestId = 0;

export const useActiveIncidentStore = create<ActiveIncidentState>((set, get) => ({
  activeIncident: null,
  isReconciling: false,

  setActiveIncident: (incident) => {
    revision++;
    set({ activeIncident: incident });
  },

  clearActiveIncident: () => {
    revision++;
    set({ activeIncident: null });
  },

  reconcileActiveIncident: async (isCurrent = () => true) => {
    const startedRevision = revision;
    const currentRequest = ++requestId;
    set({ isReconciling: true });
    try {
      const { data } = await backgroundApi.get<IncidentListItem[]>('/incidents');
      const open = data.find((incident) => incident.status === 'OPEN') ?? null;
      const active: ActiveIncident | null = open
        ? { id: open.id, status: 'OPEN' }
        : null;
      // Never resurrect an ended incident or erase a newer local activation.
      if (isCurrent() && startedRevision === revision && currentRequest === requestId) {
        set({ activeIncident: active });
      }
      return get().activeIncident;
    } finally {
      if (currentRequest === requestId) set({ isReconciling: false });
    }
  },
}));
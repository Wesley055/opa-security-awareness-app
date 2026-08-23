export type OperatorTrackingState =
  | 'NO_SESSION'
  | 'AWAITING_FIRST_FIX'
  | 'RECEIVING'
  | 'SILENT'
  | 'ENDED';

export type TrackingOrigin = 'ACTIVATION' | 'TRACKED';

export type OperatorTrackingPoint = {
  sequence?: number;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  source: string;
  origin: TrackingOrigin;
  recordedAt: string;
  receivedAt: string | null;
};

export type OperatorTrackingSnapshot = {
  state: OperatorTrackingState;
  lastFixReceivedAt: string | null;
  latest: OperatorTrackingPoint;
  points: OperatorTrackingPoint[];
  serverTime: string;
};

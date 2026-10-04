export interface NotificationPayload {
  title: string;
  description: string;
  sender?: string;
  url?: string;
  color?: number;
  metadata?: Record<string, unknown>;
}

export interface NotificationPort {
  send(payload: NotificationPayload): Promise<boolean>;
}

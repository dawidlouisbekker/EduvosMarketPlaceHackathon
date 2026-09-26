/** NotificationService (proto/incubator/v1/notifications.proto). */
import { protoFetch } from './http';
import { mutate } from './store';

import { GetUnreadCountResponse, ListNotificationsResponse } from '@/gen/incubator/v1/notifications';
import type { Notification } from '@/types/models';

/** The viewer's inbox, newest first. */
export async function getNotifications(): Promise<Notification[]> {
  const res = await protoFetch('GET', '/notifications', { response: ListNotificationsResponse });
  return res.notifications;
}

export async function getUnreadCount(): Promise<number> {
  const res = await protoFetch('GET', '/notifications/unread-count', { response: GetUnreadCountResponse });
  return res.count;
}

export function markAllRead() {
  return mutate(() => protoFetch('POST', '/notifications/read-all'));
}

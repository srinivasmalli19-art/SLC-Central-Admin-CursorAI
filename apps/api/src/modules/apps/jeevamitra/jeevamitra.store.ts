import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore, type Query } from 'firebase-admin/firestore';

import { firebaseAppForBridge } from '../../bridge/firebaseBridge.service.js';

/**
 * Data access for JeevaMitra's Firebase project (`users`, `vets`, `farms`,
 * `bookings`, `disease_alerts`), through the Firebase Admin SDK. Kept behind an
 * interface so the service can be tested without Firebase.
 */

export const JEEVAMITRA_CLIENT_ID = 'jeevamitra-admin';

export interface JmUser {
  uid: string;
  name: string;
  phone: string;
  role: string;
  village: string | null;
  district: string | null;
  isVerified: boolean;
  isProfileComplete: boolean;
}

export interface JmAlert {
  id: string;
  title: string;
  disease: string;
  severity: string;
  district: string;
  village: string;
  isActive: boolean;
  issuedAt: string | null;
  reportedBy: string | null;
  sourceAuthority: string;
}

export interface JmSummary {
  users: number;
  farmers: number;
  shepherds: number;
  vets: number;
  vetsAwaitingVerification: number;
  farms: number;
  bookings: number;
  activeDiseaseAlerts: number;
}

export interface JmUserFilter {
  role?: string;
  verified?: boolean;
  limit: number;
  after?: string;
}

export interface JeevaMitraStore {
  summary(): Promise<JmSummary>;
  listUsers(filter: JmUserFilter): Promise<{ items: JmUser[]; nextCursor: string | null }>;
  getUser(uid: string): Promise<JmUser | null>;
  /** Sets isVerified on users/{uid} and on that person's vet profile(s). */
  setVetVerified(uid: string, verified: boolean): Promise<{ vetProfilesUpdated: number }>;
  /** Disables/enables the Firebase Auth account; disabling also revokes sessions. */
  setAccountDisabled(uid: string, disabled: boolean): Promise<void>;
  listAlerts(filter: { activeOnly: boolean; limit: number }): Promise<JmAlert[]>;
  setAlertActive(id: string, active: boolean): Promise<boolean>;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function toUser(uid: string, d: Record<string, unknown>): JmUser {
  return {
    uid,
    name: str(d.name),
    phone: str(d.phone),
    role: str(d.role),
    village: strOrNull(d.village),
    district: strOrNull(d.district),
    isVerified: d.isVerified === true,
    isProfileComplete: d.isProfileComplete === true,
  };
}

function toIso(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return null;
}

export class FirestoreJeevaMitraStore implements JeevaMitraStore {
  private get db(): Firestore {
    return getFirestore(firebaseAppForBridge(JEEVAMITRA_CLIENT_ID));
  }

  private async count(query: Query): Promise<number> {
    const snap = await query.count().get();
    return snap.data().count;
  }

  async summary(): Promise<JmSummary> {
    const users = this.db.collection('users');
    const [all, farmers, shepherds, vets, pending, farms, bookings, alerts] = await Promise.all([
      this.count(users),
      this.count(users.where('role', '==', 'farmer')),
      this.count(users.where('role', '==', 'shepherd')),
      this.count(users.where('role', '==', 'vet')),
      this.count(users.where('role', '==', 'vet').where('isVerified', '==', false)),
      this.count(this.db.collection('farms')),
      this.count(this.db.collection('bookings')),
      this.count(this.db.collection('disease_alerts').where('isActive', '==', true)),
    ]);
    return {
      users: all,
      farmers,
      shepherds,
      vets,
      vetsAwaitingVerification: pending,
      farms,
      bookings,
      activeDiseaseAlerts: alerts,
    };
  }

  async listUsers(filter: JmUserFilter): Promise<{ items: JmUser[]; nextCursor: string | null }> {
    let query: Query = this.db.collection('users');
    if (filter.role) query = query.where('role', '==', filter.role);
    if (filter.verified !== undefined) query = query.where('isVerified', '==', filter.verified);
    query = query.orderBy('__name__').limit(filter.limit + 1);
    if (filter.after) query = query.startAfter(filter.after);
    const snap = await query.get();
    const docs = snap.docs.slice(0, filter.limit);
    return {
      items: docs.map((doc) => toUser(doc.id, doc.data())),
      nextCursor: snap.docs.length > filter.limit ? docs[docs.length - 1]!.id : null,
    };
  }

  async getUser(uid: string): Promise<JmUser | null> {
    const snap = await this.db.collection('users').doc(uid).get();
    return snap.exists ? toUser(snap.id, snap.data()!) : null;
  }

  async setVetVerified(uid: string, verified: boolean): Promise<{ vetProfilesUpdated: number }> {
    const vets = this.db.collection('vets');
    const [byOwner, byId] = await Promise.all([vets.where('ownerId', '==', uid).get(), vets.doc(uid).get()]);
    const refs = new Map(byOwner.docs.map((doc) => [doc.id, doc.ref]));
    if (byId.exists) refs.set(byId.id, byId.ref);

    const batch = this.db.batch();
    batch.update(this.db.collection('users').doc(uid), { isVerified: verified });
    for (const ref of refs.values()) batch.update(ref, { isVerified: verified });
    await batch.commit();
    return { vetProfilesUpdated: refs.size };
  }

  async setAccountDisabled(uid: string, disabled: boolean): Promise<void> {
    const auth = getAuth(firebaseAppForBridge(JEEVAMITRA_CLIENT_ID));
    await auth.updateUser(uid, { disabled });
    if (disabled) await auth.revokeRefreshTokens(uid);
  }

  async listAlerts(filter: { activeOnly: boolean; limit: number }): Promise<JmAlert[]> {
    let query: Query = this.db.collection('disease_alerts');
    if (filter.activeOnly) query = query.where('isActive', '==', true);
    const snap = await query.orderBy('issuedAt', 'desc').limit(filter.limit).get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        title: str(d.title),
        disease: str(d.disease),
        severity: str(d.severity),
        district: str(d.district),
        village: str(d.village),
        isActive: d.isActive === true,
        issuedAt: toIso(d.issuedAt),
        reportedBy: strOrNull(d.reportedBy),
        sourceAuthority: str(d.sourceAuthority),
      };
    });
  }

  async setAlertActive(id: string, active: boolean): Promise<boolean> {
    const ref = this.db.collection('disease_alerts').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.update({ isActive: active });
    return true;
  }
}

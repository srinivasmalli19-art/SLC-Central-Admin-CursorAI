import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore, type Query } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import { firebaseAppForBridge } from '../../bridge/firebaseBridge.service.js';
import { logger } from '../../../lib/logger.js';
import {
  JEEVAMITRA_CLIENT_ID,
  fieldPostFiles,
  hideField,
  toItem,
  toUser,
  toVet,
  type JeevaMitraStore,
  type JmCropGuideEdit,
  type JmCropSettings,
  type JmItem,
  type JmItemFilter,
  type JmKind,
  type JmSummary,
  type JmUser,
  type JmUserFilter,
  type JmVet,
  type Page,
} from './jeevamitra.model.js';

export * from './jeevamitra.model.js';

/**
 * Data access for the live JeevaMitra app (Firebase project `jeevamitra`,
 * React/Capacitor app v61+), through the Firebase Admin SDK.
 *
 * Collections: users, lands, bookings, alerts, vets, stories, videos,
 * interactions (chats), fieldPosts, cropGuides, cropGuideSettings.
 *
 * "Pause" sets `hidden: true` (alerts: `withdrawn: true`, the app's own field).
 * App v62 skips hidden items; v61 phones keep showing them until updated.
 * Kept behind an interface so the routes can be tested without Firebase.
 */

export class FirestoreJeevaMitraStore implements JeevaMitraStore {
  private get app() {
    return firebaseAppForBridge(JEEVAMITRA_CLIENT_ID);
  }
  private get db(): Firestore {
    return getFirestore(this.app);
  }

  private async count(query: Query): Promise<number> {
    const snap = await query.count().get();
    return snap.data().count;
  }

  async summary(): Promise<JmSummary> {
    const c = (name: string) => this.db.collection(name);
    const [users, livestockOwners, landProviders, both, lands, bookings, bookingsPending, alerts, vets, stories, videos, chats, fieldPosts, fieldPostsHidden, cropGuideEdits] =
      await Promise.all([
        this.count(c('users')),
        this.count(c('users').where('profileType', '==', 'livestock')),
        this.count(c('users').where('profileType', '==', 'land')),
        this.count(c('users').where('profileType', '==', 'both')),
        this.count(c('lands')),
        this.count(c('bookings')),
        this.count(c('bookings').where('status', '==', 'pending')),
        this.count(c('alerts').where('withdrawn', '==', false)),
        this.count(c('vets')),
        this.count(c('stories')),
        this.count(c('videos')),
        this.count(c('interactions')),
        this.count(c('fieldPosts')),
        this.count(c('fieldPosts').where('hidden', '==', true)),
        this.count(c('cropGuides')),
      ]);
    return { users, livestockOwners, landProviders, both, lands, bookings, bookingsPending, alerts, vets, stories, videos, chats, fieldPosts, fieldPostsHidden, cropGuideEdits };
  }

  private async authState(uids: string[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    if (!uids.length) return out;
    const result = await getAuth(this.app).getUsers(uids.map((uid) => ({ uid })));
    for (const u of result.users) out.set(u.uid, u.disabled);
    return out;
  }

  async listUsers(filter: JmUserFilter): Promise<Page<JmUser>> {
    let query: Query = this.db.collection('users');
    if (filter.profileType) query = query.where('profileType', '==', filter.profileType);
    if (filter.phone) query = query.where('phone', '==', filter.phone);
    query = query.orderBy('__name__').limit(filter.limit + 1);
    if (filter.after) query = query.startAfter(filter.after);
    const snap = await query.get();
    const docs = snap.docs.slice(0, filter.limit);
    const auth = await this.authState(docs.map((d) => d.id));
    return {
      items: docs.map((doc) => toUser(doc.id, doc.data(), auth.has(doc.id) ? auth.get(doc.id)! : null)),
      nextCursor: snap.docs.length > filter.limit ? docs[docs.length - 1]!.id : null,
    };
  }

  async getUser(uid: string): Promise<JmUser | null> {
    const snap = await this.db.collection('users').doc(uid).get();
    if (!snap.exists) return null;
    const auth = await this.authState([uid]);
    return toUser(snap.id, snap.data()!, auth.has(uid) ? auth.get(uid)! : null);
  }

  async setAccountDisabled(uid: string, disabled: boolean): Promise<void> {
    const auth = getAuth(this.app);
    await auth.updateUser(uid, { disabled });
    if (disabled) await auth.revokeRefreshTokens(uid);
  }

  async listItems(kind: JmKind, filter: JmItemFilter): Promise<Page<JmItem>> {
    const col = this.db.collection(kind);
    let query: Query = col.orderBy('createdAt', 'desc').limit(filter.limit + 1);
    if (filter.after) {
      const cursor = await col.doc(filter.after).get();
      if (cursor.exists) query = query.startAfter(cursor);
    }
    const snap = await query.get();
    const docs = snap.docs.slice(0, filter.limit);
    return {
      items: docs.map((doc) => toItem(kind, doc.id, doc.data())),
      nextCursor: snap.docs.length > filter.limit ? docs[docs.length - 1]!.id : null,
    };
  }

  async getItem(kind: JmKind, id: string): Promise<JmItem | null> {
    const snap = await this.db.collection(kind).doc(id).get();
    return snap.exists ? toItem(kind, snap.id, snap.data()!) : null;
  }

  async setHidden(kind: JmKind, id: string, hidden: boolean): Promise<boolean> {
    const ref = this.db.collection(kind).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.update({ [hideField(kind)]: hidden });
    return true;
  }

  async deleteItem(kind: JmKind, id: string): Promise<{ deleted: boolean; filesDeleted: number }> {
    const ref = this.db.collection(kind).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { deleted: false, filesDeleted: 0 };
    let filesDeleted = 0;
    if (kind === 'fieldPosts') {
      const paths = fieldPostFiles(snap.data()!);
      if (paths.length) {
        const bucket = getStorage(this.app).bucket(process.env.JEEVAMITRA_STORAGE_BUCKET || `${this.app.options.projectId}.firebasestorage.app`);
        for (const path of paths) {
          try {
            await bucket.file(path).delete({ ignoreNotFound: true });
            filesDeleted += 1;
          } catch (err) {
            logger.warn({ err, path }, 'jeevamitra: could not delete field post file');
          }
        }
      }
    }
    await ref.delete();
    return { deleted: true, filesDeleted };
  }

  async getVet(id: string): Promise<JmVet | null> {
    const snap = await this.db.collection('vets').doc(id).get();
    return snap.exists ? toVet(snap.data()!) : null;
  }

  async createVet(vet: JmVet, addedBy: string): Promise<string> {
    const ref = await this.db.collection('vets').add({ ...vet, photoUrl: null, addedBy, hidden: false, createdAt: FieldValue.serverTimestamp() });
    return ref.id;
  }

  async updateVet(id: string, vet: JmVet): Promise<boolean> {
    const ref = this.db.collection('vets').doc(id);
    if (!(await ref.get()).exists) return false;
    await ref.update({ ...vet });
    return true;
  }

  async listCropGuideEdits(): Promise<{ edits: JmCropGuideEdit[]; settings: JmCropSettings | null }> {
    const [edits, settings] = await Promise.all([
      this.db.collection('cropGuides').get(),
      this.db.collection('cropGuideSettings').doc('default').get(),
    ]);
    return {
      edits: edits.docs.map((doc) => ({ ...(doc.data() as Omit<JmCropGuideEdit, 'id'>), id: doc.id })),
      settings: settings.exists ? (settings.data() as JmCropSettings) : null,
    };
  }

  async saveCropGuide(edit: JmCropGuideEdit, updatedBy: string): Promise<void> {
    const { id, ...fields } = edit;
    await this.db.collection('cropGuides').doc(id).set({ ...fields, updatedBy, updatedAt: FieldValue.serverTimestamp() });
  }

  async deleteCropGuide(id: string): Promise<boolean> {
    const ref = this.db.collection('cropGuides').doc(id);
    if (!(await ref.get()).exists) return false;
    await ref.delete();
    return true;
  }

  async saveCropSettings(settings: JmCropSettings, updatedBy: string): Promise<void> {
    await this.db.collection('cropGuideSettings').doc('default').set({ ...settings, updatedBy, updatedAt: FieldValue.serverTimestamp() });
  }
}

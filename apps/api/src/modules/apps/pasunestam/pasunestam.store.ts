import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore, type Query } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import { firebaseAppForBridge } from '../../bridge/firebaseBridge.service.js';

/**
 * Data access for Pasunestam's Firebase project through the Firebase Admin SDK.
 * Collections (as written by the Pasunestam app): `profiles`, `certificates`,
 * `certificateTemplates`, `cases`, `schemes`, `schemeApplications`.
 *
 * Queries avoid composite indexes on purpose (the app does the same): filters
 * on one field, ordering and status filtering done in memory on a bounded
 * window.
 */

export const PASUNESTAM_CLIENT_ID = 'pasunestam-admin';

/** Firebase uids of SLC staff accounts; those are managed in Keycloak, not here. */
export const SLC_STAFF_UID_PREFIX = 'slc:';

export type PnCaseStatus = 'submitted' | 'published' | 'rejected';
export type PnCertificateStatus = 'draft' | 'issued' | 'cancelled';

export interface PnSummary {
  vets: number;
  staff: number;
  certificatesIssued: number;
  certificatesCancelled: number;
  certificatesDraft: number;
  casesAwaitingReview: number;
  casesPublished: number;
  templates: number;
  templatesPublished: number;
  schemes: number;
  schemeApplications: number;
}

export interface PnCase {
  id: string;
  title: string;
  species: string;
  body: string;
  submitterName: string;
  submittedBy: string;
  status: PnCaseStatus;
  createdAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface PnCertificate {
  id: string;
  number: string | null;
  status: PnCertificateStatus;
  templateId: string;
  vetName: string | null;
  vetInstitution: string | null;
  vetDistrict: string | null;
  issuedAt: string | null;
  createdAt: string | null;
  cancelledReason: string | null;
  cancelledAt: string | null;
}

export interface PnVet {
  uid: string;
  fullName: string | null;
  designation: string | null;
  registrationNo: string | null;
  institution: string | null;
  district: string | null;
  createdAt: string | null;
  email: string | null;
  disabled: boolean | null;
}

export interface PnTemplate {
  id: string;
  key: string;
  name: string;
  numberPrefix: string;
  published: boolean;
}

export interface PnScheme {
  id: string;
  name: string;
  tag: string;
  description: string;
  fileName: string | null;
  fileUrl: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export interface PnSchemeApplication {
  id: string;
  schemeId: string;
  applicantName: string;
  mobile: string;
  village: string;
  animalCount: string;
  createdBy: string | null;
  createdAt: string | null;
}

export type CancelResult =
  | { outcome: 'cancelled'; certificate: PnCertificate }
  | { outcome: 'not_found' }
  | { outcome: 'not_issued'; status: PnCertificateStatus };

export interface PasunestamStore {
  summary(): Promise<PnSummary>;
  listCases(filter: { status: PnCaseStatus; limit: number }): Promise<PnCase[]>;
  setCaseStatus(id: string, status: Exclude<PnCaseStatus, 'submitted'>, reviewer: string): Promise<PnCase | null>;
  findCertificates(filter: { number?: string; status?: PnCertificateStatus; limit: number }): Promise<PnCertificate[]>;
  cancelCertificate(id: string, reason: string, cancelledBy: string): Promise<CancelResult>;
  listVets(filter: { limit: number; after?: string }): Promise<{ items: PnVet[]; nextCursor: string | null }>;
  getVet(uid: string): Promise<PnVet | null>;
  /** Disables/enables the vet's Firebase Auth account; disabling also revokes sessions. */
  setAccountDisabled(uid: string, disabled: boolean): Promise<void>;
  listTemplates(): Promise<PnTemplate[]>;
  setTemplatePublished(id: string, published: boolean): Promise<PnTemplate | null>;
  listSchemes(): Promise<PnScheme[]>;
  /** Deletes the scheme form and, when it lives in this project's Storage bucket, its file. */
  deleteScheme(id: string): Promise<PnScheme | null>;
  listSchemeApplications(limit: number): Promise<PnSchemeApplication[]>;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const newestFirst = <T extends { createdAt: string | null }>(a: T, b: T) =>
  (b.createdAt ?? '').localeCompare(a.createdAt ?? '');

function toIso(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' && value ? value : null;
}

export function toCase(id: string, d: Record<string, unknown>): PnCase {
  const status = d.status === 'published' || d.status === 'rejected' ? d.status : 'submitted';
  return {
    id,
    title: str(d.title),
    species: str(d.species),
    body: str(d.body).slice(0, 8000),
    submitterName: str(d.submitterName),
    submittedBy: str(d.submittedBy),
    status,
    createdAt: toIso(d.createdAt),
    reviewedAt: toIso(d.reviewedAt),
    reviewedBy: strOrNull(d.reviewedBy),
  };
}

export function toCertificate(id: string, d: Record<string, unknown>): PnCertificate {
  const vet = (d.vet && typeof d.vet === 'object' ? d.vet : {}) as Record<string, unknown>;
  const status = d.status === 'issued' || d.status === 'cancelled' ? d.status : 'draft';
  return {
    id,
    number: strOrNull(d.number),
    status,
    templateId: str(d.templateId),
    vetName: strOrNull(vet.fullName),
    vetInstitution: strOrNull(vet.institution),
    vetDistrict: strOrNull(vet.district),
    issuedAt: toIso(d.issuedAt),
    createdAt: toIso(d.createdAt),
    cancelledReason: strOrNull(d.cancelledReason),
    cancelledAt: toIso(d.cancelledAt),
  };
}

function toVet(uid: string, d: Record<string, unknown>): PnVet {
  return {
    uid,
    fullName: strOrNull(d.fullName),
    designation: strOrNull(d.designation),
    registrationNo: strOrNull(d.registrationNo),
    institution: strOrNull(d.institution),
    district: strOrNull(d.district),
    createdAt: toIso(d.createdAt),
    email: null,
    disabled: null,
  };
}

function toTemplate(id: string, d: Record<string, unknown>): PnTemplate {
  return { id, key: str(d.key), name: str(d.name), numberPrefix: str(d.numberPrefix), published: d.published === true };
}

function toScheme(id: string, d: Record<string, unknown>): PnScheme {
  return {
    id,
    name: str(d.name),
    tag: str(d.tag),
    description: str(d.description).slice(0, 2000),
    fileName: strOrNull(d.fileName),
    fileUrl: strOrNull(d.fileUrl),
    createdBy: strOrNull(d.createdBy),
    createdAt: toIso(d.createdAt),
  };
}

/** `https://storage.googleapis.com/<bucket>/<path>` → { bucket, path }, else null. */
export function storageLocation(fileUrl: string | null): { bucket: string; path: string } | null {
  if (!fileUrl) return null;
  const match = /^https:\/\/storage\.googleapis\.com\/([^/]+)\/(schemes\/[^?#]+)$/.exec(fileUrl);
  return match ? { bucket: match[1]!, path: decodeURIComponent(match[2]!) } : null;
}

const WINDOW = 300;

export class FirestorePasunestamStore implements PasunestamStore {
  private get app() {
    return firebaseAppForBridge(PASUNESTAM_CLIENT_ID);
  }

  private get db(): Firestore {
    return getFirestore(this.app);
  }

  private async count(query: Query): Promise<number> {
    return (await query.count().get()).data().count;
  }

  async summary(): Promise<PnSummary> {
    const profiles = this.db.collection('profiles');
    const certificates = this.db.collection('certificates');
    const cases = this.db.collection('cases');
    const templates = this.db.collection('certificateTemplates');
    const [vets, editors, admins, issued, cancelled, draft, awaiting, published, tpl, tplPublished, schemes, applications] =
      await Promise.all([
        this.count(profiles.where('role', '==', 'vet')),
        this.count(profiles.where('role', '==', 'editor')),
        this.count(profiles.where('role', '==', 'admin')),
        this.count(certificates.where('status', '==', 'issued')),
        this.count(certificates.where('status', '==', 'cancelled')),
        this.count(certificates.where('status', '==', 'draft')),
        this.count(cases.where('status', '==', 'submitted')),
        this.count(cases.where('status', '==', 'published')),
        this.count(templates),
        this.count(templates.where('published', '==', true)),
        this.count(this.db.collection('schemes')),
        this.count(this.db.collection('schemeApplications')),
      ]);
    return {
      vets,
      staff: editors + admins,
      certificatesIssued: issued,
      certificatesCancelled: cancelled,
      certificatesDraft: draft,
      casesAwaitingReview: awaiting,
      casesPublished: published,
      templates: tpl,
      templatesPublished: tplPublished,
      schemes,
      schemeApplications: applications,
    };
  }

  async listCases(filter: { status: PnCaseStatus; limit: number }): Promise<PnCase[]> {
    const snap = await this.db.collection('cases').where('status', '==', filter.status).limit(WINDOW).get();
    return snap.docs.map((doc) => toCase(doc.id, doc.data())).sort(newestFirst).slice(0, filter.limit);
  }

  async setCaseStatus(id: string, status: Exclude<PnCaseStatus, 'submitted'>, reviewer: string): Promise<PnCase | null> {
    const ref = this.db.collection('cases').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const reviewedAt = new Date().toISOString();
    await ref.update({ status, reviewedAt, reviewedBy: reviewer });
    return toCase(id, { ...snap.data(), status, reviewedAt, reviewedBy: reviewer });
  }

  async findCertificates(filter: { number?: string; status?: PnCertificateStatus; limit: number }): Promise<PnCertificate[]> {
    const certificates = this.db.collection('certificates');
    if (filter.number) {
      const snap = await certificates.where('number', '==', filter.number).limit(5).get();
      return snap.docs.map((doc) => toCertificate(doc.id, doc.data()));
    }
    const snap = await certificates.orderBy('createdAt', 'desc').limit(WINDOW).get();
    return snap.docs
      .map((doc) => toCertificate(doc.id, doc.data()))
      .filter((c) => !filter.status || c.status === filter.status)
      .slice(0, filter.limit);
  }

  async cancelCertificate(id: string, reason: string, cancelledBy: string): Promise<CancelResult> {
    const ref = this.db.collection('certificates').doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { outcome: 'not_found' } as const;
      const current = toCertificate(id, snap.data()!);
      if (current.status !== 'issued') return { outcome: 'not_issued', status: current.status } as const;
      const now = new Date().toISOString();
      // Same fields the app's own cancelCertificate writes, plus who did it.
      tx.update(ref, { status: 'cancelled', cancelledReason: reason, cancelledAt: now, updatedAt: now, cancelledBy });
      return {
        outcome: 'cancelled',
        certificate: { ...current, status: 'cancelled', cancelledReason: reason, cancelledAt: now },
      } as const;
    });
  }

  async listVets(filter: { limit: number; after?: string }): Promise<{ items: PnVet[]; nextCursor: string | null }> {
    let query: Query = this.db.collection('profiles').where('role', '==', 'vet').orderBy('__name__').limit(filter.limit + 1);
    if (filter.after) query = query.startAfter(filter.after);
    const snap = await query.get();
    const docs = snap.docs.slice(0, filter.limit);
    const vets = docs.map((doc) => toVet(doc.id, doc.data()));
    if (vets.length > 0) {
      const { users } = await getAuth(this.app).getUsers(vets.map((v) => ({ uid: v.uid })));
      const byUid = new Map(users.map((u) => [u.uid, u]));
      for (const vet of vets) {
        const record = byUid.get(vet.uid);
        vet.email = record?.email ?? null;
        vet.disabled = record ? record.disabled : null;
      }
    }
    return { items: vets, nextCursor: snap.docs.length > filter.limit ? docs[docs.length - 1]!.id : null };
  }

  async getVet(uid: string): Promise<PnVet | null> {
    const snap = await this.db.collection('profiles').doc(uid).get();
    if (!snap.exists || snap.data()!.role !== 'vet') return null;
    return toVet(uid, snap.data()!);
  }

  async setAccountDisabled(uid: string, disabled: boolean): Promise<void> {
    const auth = getAuth(this.app);
    await auth.updateUser(uid, { disabled });
    if (disabled) await auth.revokeRefreshTokens(uid);
  }

  async listTemplates(): Promise<PnTemplate[]> {
    const snap = await this.db.collection('certificateTemplates').get();
    return snap.docs.map((doc) => toTemplate(doc.id, doc.data())).sort((a, b) => a.name.localeCompare(b.name));
  }

  async setTemplatePublished(id: string, published: boolean): Promise<PnTemplate | null> {
    const ref = this.db.collection('certificateTemplates').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    await ref.update({ published });
    return toTemplate(id, { ...snap.data(), published });
  }

  async listSchemes(): Promise<PnScheme[]> {
    const snap = await this.db.collection('schemes').limit(WINDOW).get();
    return snap.docs.map((doc) => toScheme(doc.id, doc.data())).sort(newestFirst);
  }

  async deleteScheme(id: string): Promise<PnScheme | null> {
    const ref = this.db.collection('schemes').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const scheme = toScheme(id, snap.data()!);
    await ref.delete();
    const location = storageLocation(scheme.fileUrl);
    if (location) {
      await getStorage(this.app).bucket(location.bucket).file(location.path).delete({ ignoreNotFound: true });
    }
    return scheme;
  }

  async listSchemeApplications(limit: number): Promise<PnSchemeApplication[]> {
    const snap = await this.db.collection('schemeApplications').orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        schemeId: str(d.schemeId),
        applicantName: str(d.applicantName),
        mobile: str(d.mobile),
        village: str(d.village),
        animalCount: str(d.animalCount),
        createdBy: strOrNull(d.createdBy),
        createdAt: toIso(d.createdAt),
      };
    });
  }
}

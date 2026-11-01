import type { DocumentData } from 'firebase-admin/firestore';

/**
 * JeevaMitra admin data model and pure mapping helpers (no Firebase calls,
 * no config), shared by the Firestore store, the routes and the tests.
 */

export const JEEVAMITRA_CLIENT_ID = 'jeevamitra-admin';

export type JmProfileType = 'livestock' | 'land' | 'both';
export type JmKind = 'lands' | 'alerts' | 'vets' | 'stories' | 'videos' | 'fieldPosts';
export const JM_KINDS: readonly JmKind[] = ['lands', 'alerts', 'vets', 'stories', 'videos', 'fieldPosts'];
/** Content posted by app users (deleting it is a super_admin action). */
export const USER_CONTENT: readonly JmKind[] = ['lands', 'alerts', 'fieldPosts'];

export interface JmUser {
  uid: string;
  name: string;
  phone: string;
  profileType: string;
  village: string | null;
  district: string | null;
  state: string | null;
  /** Firebase Auth state; null when the Auth account no longer exists. */
  disabled: boolean | null;
}

export interface JmItem {
  id: string;
  kind: JmKind;
  title: string;
  subtitle: string;
  ownerId: string | null;
  hidden: boolean;
  status: string | null;
  createdAt: string | null;
}

export interface JmVet {
  name: string;
  sector: string;
  designation: string;
  services: string[];
  experienceYears: number;
  languages: string[];
  village: string;
  district: string;
  phone: string;
  rating: number | null;
  availability: string;
  lat: number | null;
  lng: number | null;
}

export type JmLocalized = { en?: string; te?: string; hi?: string };
export interface JmCropGuideEdit {
  id: string;
  emoji?: string;
  order?: number;
  hidden?: boolean;
  reviewedBy?: string;
  reviewedOn?: string;
  name?: JmLocalized;
  goodFor?: JmLocalized;
  risk?: JmLocalized;
  precautions?: JmLocalized;
}
export interface JmCropSettings {
  sprayWarningDays?: number;
  generalPrecautions?: { en?: string[]; te?: string[]; hi?: string[] };
  callVet?: JmLocalized;
  disclaimer?: JmLocalized;
}

export interface JmSummary {
  users: number;
  livestockOwners: number;
  landProviders: number;
  both: number;
  lands: number;
  bookings: number;
  bookingsPending: number;
  alerts: number;
  vets: number;
  stories: number;
  videos: number;
  chats: number;
  fieldPosts: number;
  fieldPostsHidden: number;
  cropGuideEdits: number;
}

export interface JmUserFilter {
  profileType?: JmProfileType;
  phone?: string;
  limit: number;
  after?: string;
}
export interface JmItemFilter {
  limit: number;
  after?: string;
}
export type Page<T> = { items: T[]; nextCursor: string | null };

export interface JeevaMitraStore {
  summary(): Promise<JmSummary>;
  listUsers(filter: JmUserFilter): Promise<Page<JmUser>>;
  getUser(uid: string): Promise<JmUser | null>;
  /** Disables/enables the Firebase Auth account; disabling also revokes sessions. */
  setAccountDisabled(uid: string, disabled: boolean): Promise<void>;

  listItems(kind: JmKind, filter: JmItemFilter): Promise<Page<JmItem>>;
  getItem(kind: JmKind, id: string): Promise<JmItem | null>;
  /** Pause (hide) or resume. Returns false when the item does not exist. */
  setHidden(kind: JmKind, id: string, hidden: boolean): Promise<boolean>;
  /** Deletes the document (and a field post's photos/voice note). False when missing. */
  deleteItem(kind: JmKind, id: string): Promise<{ deleted: boolean; filesDeleted: number }>;

  getVet(id: string): Promise<JmVet | null>;
  createVet(vet: JmVet, addedBy: string): Promise<string>;
  updateVet(id: string, vet: JmVet): Promise<boolean>;

  listCropGuideEdits(): Promise<{ edits: JmCropGuideEdit[]; settings: JmCropSettings | null }>;
  /** Replaces the admin edit for one crop (fields left out fall back to the app's built-in text). */
  saveCropGuide(edit: JmCropGuideEdit, updatedBy: string): Promise<void>;
  /** Removes the admin edit: a built-in crop goes back to the app text; an added crop disappears. */
  deleteCropGuide(id: string): Promise<boolean>;
  saveCropSettings(settings: JmCropSettings, updatedBy: string): Promise<void>;
}

// ---------------------------------------------------------------------------
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const join = (...parts: unknown[]): string => parts.map((p) => str(p).trim()).filter(Boolean).join(' · ');

export function toIso(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return null;
}

/** Field used to pause each kind: alerts use the app's own `withdrawn`. */
export const hideField = (kind: JmKind): 'hidden' | 'withdrawn' => (kind === 'alerts' ? 'withdrawn' : 'hidden');

function fieldPostTitle(d: DocumentData): string {
  if (d.kind === 'residue') return join(d.crop === 'other' ? d.cropOther || 'other crop' : d.crop, d.acres ? `${str(d.acres)} acres` : '') || 'Crop residue';
  if (d.kind === 'nightStayNeed') return join('Herd needed for manure', d.acres ? `${str(d.acres)} acres` : '', d.nights ? `${str(d.nights)} nights` : '');
  if (d.kind === 'herdAvailable') return join('Herd available', d.animalCount ? `${str(d.animalCount)} ${str(d.animalType)}` : d.animalType);
  return 'Field post';
}

/** Turns a Firestore document of any kind into one admin list row. Pure; unit-tested. */
export function toItem(kind: JmKind, id: string, d: DocumentData): JmItem {
  const place = [str(d.village), str(d.district)].filter(Boolean).join(', ');
  const base = { id, kind, hidden: d[hideField(kind)] === true, createdAt: toIso(d.createdAt), status: null as string | null };
  switch (kind) {
    case 'lands':
      return { ...base, title: str(d.title, '(untitled land)'), subtitle: join(place, d.acres ? `${str(d.acres)} acres` : '', d.price ? `₹${str(d.price)}/${str(d.unit, 'month')}` : ''), ownerId: strOrNull(d.ownerId) };
    case 'alerts':
      return { ...base, title: str(d.disease, '(no disease named)'), subtitle: join(d.severity, d.species, place, d.reporterName ? `by ${str(d.reporterName)}` : ''), ownerId: strOrNull(d.reporterId), status: strOrNull(d.severity) };
    case 'vets':
      return { ...base, title: str(d.name, '(no name)'), subtitle: join(d.designation, d.sector, place, d.phone), ownerId: null };
    case 'stories':
      return { ...base, title: str(d.title, '(untitled story)'), subtitle: join(d.authorName), ownerId: null };
    case 'videos':
      return { ...base, title: str(d.title, '(untitled video)'), subtitle: str(d.youtubeUrl), ownerId: null };
    case 'fieldPosts':
      return { ...base, title: fieldPostTitle(d), subtitle: join(d.kind, place), ownerId: strOrNull(d.ownerId), status: strOrNull(d.status) };
  }
}

export function toUser(uid: string, d: DocumentData, disabled: boolean | null): JmUser {
  return {
    uid,
    name: str(d.name),
    phone: str(d.phone),
    profileType: str(d.profileType),
    village: strOrNull(d.village),
    district: strOrNull(d.district),
    state: strOrNull(d.state),
    disabled,
  };
}

export function toVet(d: DocumentData): JmVet {
  return {
    name: str(d.name),
    sector: str(d.sector),
    designation: str(d.designation),
    services: strList(d.services),
    experienceYears: numOrNull(d.experienceYears) ?? 0,
    languages: strList(d.languages),
    village: str(d.village),
    district: str(d.district),
    phone: str(d.phone),
    rating: numOrNull(d.rating),
    availability: str(d.availability, 'Available today'),
    lat: numOrNull(d.lat),
    lng: numOrNull(d.lng),
  };
}

/** Storage paths of a field post's photos and voice note (only its own folder). */
export function fieldPostFiles(d: DocumentData): string[] {
  const owner = str(d.ownerId);
  const paths = [
    ...(Array.isArray(d.photos) ? d.photos.map((p: { path?: unknown }) => str(p?.path)) : []),
    str(d.voiceNote?.path),
  ];
  return paths.filter((p) => p && owner && p.startsWith(`fieldPosts/${owner}/`) && !p.includes('..'));
}

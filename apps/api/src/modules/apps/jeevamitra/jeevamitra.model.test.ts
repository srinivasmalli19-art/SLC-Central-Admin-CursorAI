import { describe, expect, it } from 'vitest';

import { fieldPostFiles, hideField, toItem, toUser } from './jeevamitra.model.js';

describe('JeevaMitra model', () => {
  it('builds list rows from live app documents', () => {
    expect(toItem('lands', 'l1', { title: 'Green', village: 'Ponnur', district: 'Guntur', acres: 4, price: 3000, unit: 'month', ownerId: 'u1', hidden: true }))
      .toMatchObject({ title: 'Green', subtitle: 'Ponnur, Guntur · 4 acres · ₹3000/month', ownerId: 'u1', hidden: true });
    expect(toItem('alerts', 'a1', { disease: 'PPR', severity: 'high', reporterId: 'u2', withdrawn: true })).toMatchObject({ hidden: true, ownerId: 'u2', status: 'high' });
    expect(toItem('fieldPosts', 'p1', { kind: 'herdAvailable', animalCount: 300, animalType: 'sheep', status: 'full' }).title).toBe('Herd available · 300 sheep');
    expect(toItem('fieldPosts', 'p2', { kind: 'nightStayNeed', acres: 2, nights: 3 }).title).toBe('Herd needed for manure · 2 acres · 3 nights');
    expect(toItem('fieldPosts', 'p3', { kind: 'residue', crop: 'other', cropOther: 'ragi', acres: 1 }).title).toBe('ragi · 1 acres');
    expect(toItem('vets', 'v1', {})).toMatchObject({ title: '(no name)', hidden: false, createdAt: null });
    expect(toItem('stories', 's1', { createdAt: { toDate: () => new Date('2026-11-01T00:00:00Z') } }).createdAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('pauses alerts with the app field "withdrawn", everything else with "hidden"', () => {
    expect(hideField('alerts')).toBe('withdrawn');
    expect(hideField('lands')).toBe('hidden');
  });

  it('only deletes files inside the post owner\'s own folder', () => {
    expect(fieldPostFiles({
      ownerId: 'u1',
      photos: [{ path: 'fieldPosts/u1/p/a.jpg' }, { path: 'fieldPosts/u2/p/b.jpg' }, { path: 'fieldPosts/u1/../x' }, {}],
      voiceNote: { path: 'fieldPosts/u1/p/v.webm' },
    })).toEqual(['fieldPosts/u1/p/a.jpg', 'fieldPosts/u1/p/v.webm']);
    expect(fieldPostFiles({ photos: [{ path: 'fieldPosts//a' }] })).toEqual([]);
  });

  it('maps users and keeps the Auth state', () => {
    expect(toUser('u1', { name: 'Rama', phone: '9876543210', profileType: 'both' }, null)).toMatchObject({ disabled: null, village: null });
  });
});

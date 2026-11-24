import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseRoute, PrivateModeUnavailable, shouldEscalate, normalizeConfidence, isBusyError, modelChain, frameDifference, LIVE_CHANGE_THRESHOLD, cleanAlerts, spokenAnswer, newAlerts } from '../src/lib/policy.ts';

test('dangers are spoken before the answer, in the chosen language', () => {
  const r = { alerts: ['May cause dizziness', 'Do not use if pregnant'], speech: 'Lisinopril 10 milligrams.', tip: '' };
  assert.equal(spokenAnswer(r, 'en'), 'Warning. May cause dizziness. Do not use if pregnant. Lisinopril 10 milligrams.');
  assert.equal(spokenAnswer(r, 'ko', 'Double-checked. ').startsWith('경고. '), true);
  assert.equal(spokenAnswer({ alerts: [], speech: 'A kitchen.', tip: 'Add more light' }, 'en'), 'A kitchen. Add more light');
});

test('alerts are cleaned and de-duplicated, keeping the most serious first', () => {
  assert.deepEqual(cleanAlerts([' Danger! ', 'danger', '', 'Wet floor.']), ['Danger', 'Wet floor']);
  assert.deepEqual(cleanAlerts(undefined), []);
});

test('live narration announces each alert only once', () => {
  const seen = new Set<string>();
  assert.deepEqual(newAlerts(['Stairs ahead'], seen), ['Stairs ahead']);
  assert.deepEqual(newAlerts(['stairs ahead', 'Car at 3 o\'clock'], seen), ['Car at 3 o\'clock']);
});

test('live narration never escalates, so it stays fast and does not burn cloud quota', () => {
  const e = { privacy: 'smart' as const, answeredOnDevice: true, confidence: 'low' as const, category: 'medicine' as const, escalateAt: 'low' as const, escalateMedicineAt: 'medium' as const };
  assert.equal(shouldEscalate(e), true);
  assert.equal(shouldEscalate({ ...e, live: true }), false);
});

test('live mode skips frames when the camera view has not changed', () => {
  const still = [10, 20, 30, 40];
  assert.ok(frameDifference(still, [11, 21, 29, 40]) < LIVE_CHANGE_THRESHOLD);
  assert.ok(frameDifference(still, [200, 20, 220, 40]) > LIVE_CHANGE_THRESHOLD);
  assert.equal(frameDifference(still, []), 1);
});

test('busy, quota, and retired-model errors are retried; auth errors are not', () => {
  assert.ok(isBusyError(new Error('[500 ] This model is currently experiencing high demand.')));
  assert.ok(isBusyError(new Error('GenerateRequestsPerDayPerProjectPerModel-FreeTier quota exceeded')));
  assert.ok(isBusyError(new Error('gemini-2.5-flash is no longer available to new users')));
  assert.ok(!isBusyError(new Error('[401 ] Firebase App Check token is invalid.')));
});

test('model chain retries the chosen model once, then each backup once without duplicates', () => {
  assert.deepEqual(modelChain('lite', ['flash', 'old', 'lite', '']), ['lite', 'lite', 'flash', 'old']);
});

const base = { mode: 'describe' as const, lang: 'en', onDeviceLanguages: ['en', 'es', 'ja'], languageName: 'English' };

test('private mode refuses instead of silently using the cloud when there is no on-device model', () => {
  assert.throws(() => chooseRoute({ ...base, privacy: 'private', deviceReady: false }), PrivateModeUnavailable);
  assert.equal(chooseRoute({ ...base, privacy: 'private', deviceReady: true }).mode, 'only_on_device');
});

test('smart mode prefers on-device, but routes unsupported languages to the cloud', () => {
  assert.equal(chooseRoute({ ...base, privacy: 'smart', deviceReady: true }).mode, 'prefer_on_device');
  const hindi = chooseRoute({ ...base, privacy: 'smart', deviceReady: true, lang: 'hi', languageName: 'Hindi' });
  assert.equal(hindi.mode, 'prefer_in_cloud');
  assert.match(hindi.why, /Hindi/);
});

test('best-quality mode prefers the cloud', () => {
  assert.equal(chooseRoute({ ...base, privacy: 'quality', deviceReady: true }).mode, 'prefer_in_cloud');
});

const esc = { privacy: 'smart' as const, answeredOnDevice: true, escalateAt: 'low' as const, escalateMedicineAt: 'medium' as const };

test('unsure on-device answers are double-checked in the cloud', () => {
  assert.equal(shouldEscalate({ ...esc, confidence: 'low' }), true);
  assert.equal(shouldEscalate({ ...esc, confidence: 'medium' }), false);
  assert.equal(shouldEscalate({ ...esc, confidence: 'high' }), false);
});

test('medicine uses a stricter bar', () => {
  assert.equal(shouldEscalate({ ...esc, confidence: 'medium', category: 'medicine' }), true);
  assert.equal(shouldEscalate({ ...esc, confidence: 'high', category: 'medicine' }), false);
});

test('never escalates in private mode or when the cloud already answered', () => {
  assert.equal(shouldEscalate({ ...esc, privacy: 'private', confidence: 'low' }), false);
  assert.equal(shouldEscalate({ ...esc, answeredOnDevice: false, confidence: 'low' }), false);
});

test('unknown confidence is treated as low', () => {
  assert.equal(normalizeConfidence('certain'), 'low');
  assert.equal(normalizeConfidence(undefined), 'low');
});

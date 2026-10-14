# Local testing helpers

`pasunestam-emulator.firebase.json` runs Pasunestam's Firebase emulators on
ports that do not clash with the SLC test setup (Keycloak 8080, Central Admin
API 4000). From the pasunestam folder:

```bash
npx firebase-tools emulators:start --only auth,firestore --project demo-pasunestam \
  --config ../SLC-Central-Admin-CursorAI/infra/testing/pasunestam-emulator.firebase.json
```

Then point both Pasunestam and Central Admin at it:

```
FIRESTORE_EMULATOR_HOST=127.0.0.1:8095
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
```

A `demo-` project id guarantees nothing reaches a real Firebase project.
The full walkthrough is in the "SLC admin login: status and testing guide" doc.

# Firebase / FCM setup (required for native push)

The Android app uses **Firebase Cloud Messaging**. The repo ships a **placeholder**
`android/app/google-services.json` so CI can compile; Alex must replace it with a
real Firebase Android app config before production push works.

## What Alex must create

1. Firebase console → create (or reuse) a project, e.g. `agent-progress`.
2. Add an **Android app** with package name **`com.brwnindustries.agentprogress`**.
3. Download **`google-services.json`** → replace `android/app/google-services.json`
   (keep the debug package client if you also build `*.debug`, or add a second Android app for `com.brwnindustries.agentprogress.debug`).
4. Project settings → **Service accounts** → Generate new private key (JSON).
   This is the **FCM HTTP v1** credential for the server. **Never commit it.**

## Where values go

| Value | Where |
|-------|--------|
| `google-services.json` | `android/app/google-services.json` (client; rebuild APK after change) |
| Service account JSON file | VPS e.g. `/opt/agent-progress/secrets/fcm-service-account.json` (mode `600`) |
| `FCM_PROJECT_ID` | `.env` / compose — Firebase project id (optional if present inside the JSON) |
| `FCM_SERVICE_ACCOUNT_PATH` | `.env` / compose — absolute path to that JSON on the VPS |
| *or* `FCM_SERVICE_ACCOUNT_JSON` | env — raw JSON string (avoid if possible; prefer file path) |

Example compose / `.env` (no secrets in git):

```bash
FCM_PROJECT_ID=your-firebase-project-id
FCM_SERVICE_ACCOUNT_PATH=/opt/agent-progress/secrets/fcm-service-account.json
```

Confirm after deploy: `curl -sS https://progress.brwnindustries.com/api/health` → `"fcmEnabled":true`.

## Server API

- `POST /api/push/fcm/register` `{ workspaceId, token, platform? }` (session cookie)
- `POST /api/push/fcm/unregister` `{ token }`
- Sends use FCM HTTP v1 `projects/{id}/messages:send`

Dedupe: users with an FCM device skip Web Push; if FCM delivered, BRWN Text relay is skipped for that event.

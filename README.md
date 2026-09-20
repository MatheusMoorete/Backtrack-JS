# Backtrack (@backtrack/browser)

[![npm version](https://img.shields.io/npm/v/@backtrack/browser.svg)](https://www.npmjs.com/package/@backtrack/browser)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Backtrack** is a privacy-first, client-side session recorder and time-travel engine for web applications. It captures pre-bug context (DOM mutations, console logs, network requests, navigation, and unhandled errors) in a rolling local ring-buffer, allowing developers to backtrack user sessions and reproduce bugs with exact fidelity.

- 🔒 **Privacy-First:** Strict data masking (passwords, credit cards, inputs, authorization headers). No data leaves the browser unless explicitly exported.
- ⚡ **Lightweight & Framework-Agnostic:** Pure TypeScript core. Zero framework dependencies (no React required in your client bundle).
- 🔄 **Rolling Ring Buffer:** Continuously stores the last $N$ minutes of user activity in IndexedDB with automatic retention and storage limits.
- 🎬 **Full Session Replay:** Powered by [rrweb](https://github.com/rrweb-io/rrweb) with synchronized timeline events.
- 🛠 **Built-in Incident Viewer:** Includes an interactive web inspector and CLI to replay incidents offline.

---

## Installation

```bash
# npm
npm install @backtrack/browser

# yarn
yarn add @backtrack/browser

# pnpm
pnpm add @backtrack/browser
```

---

## Quick Start

```typescript
import { Backtrack } from '@backtrack/browser';

// 1. Initialize Backtrack
const recorder = new Backtrack({
  bufferMinutes: 5,         // Keep last 5 minutes of activity in rolling buffer
  afterErrorSeconds: 15,    // Keep recording for 15 seconds after an error occurs
  maxStorageMb: 50,         // Maximum storage quota in IndexedDB
  captureHttpStatus: [500, 502, 503, 504], // Auto-trigger on server errors
  privacy: {
    maskAllInputs: true,    // Mask all form inputs by default
    blockMedia: true        // Replace images/media with placeholders
  }
});

// 2. Start recording
await recorder.start();

// 3. (Optional) Manually trigger an incident on user feedback or caught error
const incidentId = await recorder.capture('User reported payment bug', 30);
console.log('Incident captured:', incidentId);
```

---

## Privacy & Data Masking

Backtrack is designed with strict security defaults:

- **Inputs & Forms:** All `<input>`, `<textarea>`, and `<select>` values are masked by default (`maskAllInputs: true`).
- **Network Headers:** Authorization, Cookies, API keys, and Bearer tokens are automatically redacted.
- **Sensitive Selectors:** Use standard selectors or CSS classes to protect proprietary or personal data:

```typescript
const recorder = new Backtrack({
  privacy: {
    maskAllInputs: true,
    blockMedia: true,
    blockSelector: '.backtrack-block, [data-private]',      // Completely hides elements in replay
    maskTextSelector: '.backtrack-mask, .customer-pII',     // Scrambles text content
    sanitizeUrl: (url) => {
      // Remove sensitive query parameters
      url.searchParams.delete('token');
      return url.toString();
    }
  }
});
```

---

## Capturing Incidents

### Automatic Triggers
Backtrack automatically triggers and freezes an incident when:
1. An unhandled window exception occurs (`window.onerror`).
2. An unhandled promise rejection occurs (`unhandledrejection`).
3. An HTTP request returns a matching error status (`captureHttpStatus`).

### Manual Capture
You can trigger incident recording manually anywhere in your code (e.g. from an error boundary or user feedback modal):

```typescript
// Capture the last 60 seconds of context
const incidentId = await recorder.capture('Checkout error', 60);

// Export the complete incident artifact as a JSON object
const artifact = await recorder.exportIncident(incidentId);

// Download or send artifact to your support/logging service
const jsonBlob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
```

### Exception Capture
In React Error Boundaries or try/catch blocks:

```typescript
recorder.captureException(error, {
  source: 'react',
  componentStack: errorInfo.componentStack
});
```

---

## Inspecting Incidents (Viewer)

Backtrack includes an offline visualizer with video replay, console logs, network inspection, and breadcrumbs.

### Launch the Viewer CLI
Run the embedded CLI to launch the local visualizer:

```bash
npx backtrack
```

This starts a local server at `http://localhost:5173/` and opens your default browser. Drag and drop any exported incident `.json` file to replay it!

---

## API Reference

### `Backtrack` (`FlightRecorder`)

| Method | Return Type | Description |
| --- | --- | --- |
| `start()` | `Promise<void>` | Initializes storage and begins recording. |
| `stop()` | `void` | Stops recording and detaches listeners. |
| `capture(reason?, windowSeconds?)` | `Promise<string>` | Manually captures and finalizes an incident. Returns incident ID. |
| `captureException(error, context?)` | `void` | Records a caught exception and triggers an incident. |
| `listIncidents()` | `Promise<IncidentSummary[]>` | Lists all stored incidents. |
| `getArtifact(incidentId)` | `Promise<FlightRecorderArtifactV1>` | Retrieves the full artifact for an incident. |
| `exportIncident(incidentId)` | `Promise<FlightRecorderArtifactV1>` | Exports the artifact and marks it finalized. |
| `deleteIncident(incidentId)` | `Promise<void>` | Deletes an incident from local storage. |
| `clear()` | `Promise<void>` | Clears all stored chunks, sessions, and incidents. |
| `getHealth()` | `RecorderHealth` | Returns current buffer status, storage usage, and state. |

---

## License

[MIT](LICENSE)

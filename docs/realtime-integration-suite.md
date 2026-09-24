# Realtime Integration Suite

## Overview

The realtime integration suite tests the full WebSocket pipeline end-to-end:
server initialisation → room subscription → broadcast helpers → client event delivery.

## File

```
src/__tests__/integration/realtime-integration.test.ts
.github/workflows/realtime-integration.yml
```

## What is tested

| Scenario | Coverage |
|---|---|
| Server initialisation | `getWebSocketServer` returns a valid `SocketIOServer` |
| Unauthenticated `subscribe:circle` | Receives `error` event, not joined |
| Unauthenticated `subscribe:user` | Receives `error` event, not joined |
| Authenticated circle subscription | Joins room, no error |
| Unsubscribe | Leaves room cleanly |
| `broadcastContributionConfirmed` | Delivered to circle room |
| `broadcastContributionConfirmed` | NOT delivered to a different circle room |
| `broadcastPayoutProcessed` | Delivered with correct fields |
| `broadcastCircleCompleted` | Delivered with timestamp |
| `broadcastCircleStarted` | Delivered with timestamp |
| `broadcastChatMessage` | Delivered to correct room |
| `broadcastChatMessage` | NOT leaked to another room |
| Null `io` guard | No throw when server not initialised |

## Running locally

```bash
# Run only the realtime suite
npx jest --testPathPattern="realtime-integration" --runInBand --forceExit

# Run all integration tests
npx jest --testPathPattern="integration" --runInBand --forceExit
```

`--runInBand` ensures the in-process HTTP/WebSocket server does not conflict with other tests.  
`--forceExit` cleans up the open socket server handle after tests complete.

## CI

The `realtime-integration.yml` workflow runs on every push/PR to `main` and `develop`.  
Test output is uploaded as `realtime-integration-results` (retained 14 days).

# Electron Plugin Package Format v1

Status: experimental. The package validator, staging service, capability broker, lifecycle service, local signer trust store, desktop management UI, signing and packaging CLI, and maintained capability demo source exist. The repository ships no production signing key, prebuilt signed package, automatic updater, or public plugin catalog. See the [Electron Plugin MVP Quickstart](11-electron-plugin-mvp-quickstart.md).

## Scope

An Electron plugin package is a ZIP archive of prebuilt static files. The archive contains one root `plugin.json` manifest and the files listed in that manifest. The installer verifies the manifest signature and every file hash. It writes files to a private staging directory, then renames that directory to the plugin ID and version path.

The installer does not run package scripts, invoke `npm install`, or grant requested capabilities. Package staging does not activate the plugin.

## Archive layout

```text
plugin.json
index.html
assets/plugin.js
assets/style.css
```

The entrypoint must be an HTML file in the signed file list. Directory entries are optional. Every non-directory archive entry except the root `plugin.json` must appear exactly once in the signed file list.

The archive must use stored or deflate compression. Encrypted entries, path traversal, symlinks, special files, NTFS reparse points, repeated paths, case-colliding paths, and files that conflict with a parent directory are rejected.

## Manifest

The root `plugin.json` contains these fields:

| Field | Meaning |
| --- | --- |
| `formatVersion` | Must be the number `1`. |
| `id` | Lowercase plugin ID. Letters and digits may be separated by `.` or `-`. |
| `name` | Display name, 1–120 characters. |
| `version` | Stable `MAJOR.MINOR.PATCH` version. |
| `apiVersion` | Host API range with an inclusive minimum and exclusive maximum. |
| `entrypoint` | Safe relative path to the HTML entry file. |
| `requestedCapabilities` | Unique known capability IDs accepted by the package format. The current host may execute only a subset. A request is not an authorization. |
| `contributions` | Optional signed display metadata for tools provided by the package. The host may derive a metadata landing route, but this field does not register a host tool implementation or grant execution access. |
| `files` | Sorted list of every payload path and its lowercase SHA-256 digest. |
| `signature` | Ed25519 algorithm, trusted key ID, and standard Base64 signature. |

Example unsigned manifest fields:

```json
{
  "formatVersion": 1,
  "id": "org.example.sandbox",
  "name": "Example sandbox plugin",
  "version": "1.0.0",
  "apiVersion": {
    "minInclusive": "1.0.0",
    "maxExclusive": "2.0.0"
  },
  "entrypoint": "index.html",
  "requestedCapabilities": [],
  "contributions": {
    "tools": [
      {
        "id": "org.example.sandbox/example-tool",
        "title": "Example tool",
        "description": "Shows the signed display metadata for an external tool.",
        "keywords": ["example", "plugin"]
      }
    ]
  },
  "files": [
    {
      "path": "index.html",
      "sha256": "<64 lowercase hexadecimal characters>"
    }
  ]
}
```

`contributions` is optional. When present, `tools` contains at most 32 records. Each record uses a plugin-namespaced ID (`<plugin-id>/<tool-id>`), a non-empty title and description, and at most 32 unique keywords. The package validator trims display text, rejects unknown fields, duplicate IDs, and IDs outside the package namespace. The desktop plugin manager displays this metadata after signature verification and links each installed version to a host-owned metadata route at `/extensions/<plugin-id>/<version>/<tool-id>`. The route offers explicit run and stop actions through the existing lifecycle IPC; activation still uses the host capability confirmation and opens the package in its isolated plugin window. It does not execute external code in the host renderer or add a component to the host tool registry. A capability request remains separate from signature trust.

The package format currently accepts these known capability IDs: `runtime.info`, `clipboard.write`, `settings.read`, `settings.write`, `data.oui`, `device.camera`, `file.read`, and `file.save`. The v1 runtime broker currently executes only the first four. Installation keeps the other known declarations for forward compatibility; activation filters them out of the broker, and the desktop UI labels them as unsupported instead of offering a grant checkbox. A package can therefore run without an unavailable capability, but it cannot use that capability until a host API implements it.

Packages that omit `contributions` remain valid. The field is included in the signed payload only when it is present, so existing v1 signatures continue to verify without repacking.

The signer signs UTF-8 bytes of the domain string `IT Tools Electron Plugin Package v1`, followed by a newline and canonical JSON for the unsigned manifest. Canonical JSON sorts object keys with JavaScript string ordering, preserves array order, and uses `JSON.stringify` string and number encoding. The `files` array must use ascending JavaScript string order by `path`.

The host resolves `signature.keyId` from a host-owned key map. Each key entry lists the plugin IDs it can sign. The public key must be Ed25519. An unknown key, a key that is not allowed to sign this ID, a bad signature, or an incompatible host API range rejects the package.

## Path rules

Package paths use `/` separators and must be relative. The installer rejects empty, `.` and `..` segments, backslashes, drive prefixes, control characters, `%`, `?`, `#`, reserved Windows device names, trailing dots or spaces, and paths that are not in Unicode NFC form. A path can contain at most 1,024 characters and 32 segments. Each segment can contain at most 255 UTF-16 code units.

## Resource limits

| Limit | Maximum |
| --- | ---: |
| Compressed archive | 64 MiB |
| Expanded archive | 128 MiB |
| One payload file | 16 MiB |
| Manifest | 1 MiB |
| Payload files | 512 |
| All ZIP entries, including directories | 1,024 |
| Path segments | 32 |
| One file compression ratio | 100:1 |

The installer checks archive metadata before extraction. It also checks actual streamed byte counts and SHA-256 hashes while writing each file. A file that exceeds its declared size or the configured limit aborts the operation and removes the staging directory.

## Install result and limits

The staged path is `<installRoot>/<pluginId>/<version>`. The installer does not replace an existing version. It stores the validated manifest as normalized JSON. It serializes staging operations for the same install root and cleans abandoned staging directories before a new install.

The lifecycle service revalidates the signed manifest and every file before activation, limits active plugin windows, restores the previous version if a replacement fails to start, and supports disable and uninstall operations. The trusted desktop renderer calls it through main-process IPC that checks the sender frame and app origin. Package installation uses the Electron file picker. Renderer code does not receive local file paths.

The desktop UI stores only public Ed25519 keys in the application user-data directory. Each key is limited to named plugin IDs. The UI displays a SHA-256 fingerprint before trust, and a native confirmation dialog records the user's decision. Signature trust confirms package origin and integrity. It does not grant plugin capabilities. The main process asks for separate approval before it grants `runtime.info`, `clipboard.write`, `settings.read`, or `settings.write` for a running window. Settings are non-secret, plugin-namespaced preferences; they are not a credential store.

The Electron management UI is in the Plugins section of `/settings`. The legacy `/settings/extensions` route redirects there. The web UI states that external plugin packages are desktop-only. A local signer key must be verified with its publisher before it is trusted.

Plugin HTML runs in a sandboxed renderer. The host serves an unchanged signed file and injects a host-owned bootstrap into the HTML response. The bootstrap installs the Worker guard and the versioned `window.itTools` client. The transformation does not write to the package directory. The host removes `meta http-equiv` tags from the response so package markup cannot override the host security policy or prevent the bootstrap from running.

The document CSP allows only same-origin dedicated Workers. The guard allows at most two active Workers per plugin window and terminates each Worker after 30 seconds, on an error, or when the document closes. Worker script responses set `worker-src 'none'`, so Workers cannot create nested Workers. The host disables `SharedWorker` and service-worker registration. Worker and document network requests remain limited to the plugin origin; the session also blocks HTTP, HTTPS, WebSocket, FTP, permissions, and downloads.

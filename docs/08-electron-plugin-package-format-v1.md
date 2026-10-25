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
| `requestedCapabilities` | Unique names from the host capability set. A request is not an authorization. |
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
  "files": [
    {
      "path": "index.html",
      "sha256": "<64 lowercase hexadecimal characters>"
    }
  ]
}
```

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

The desktop UI stores only public Ed25519 keys in the application user-data directory. Each key is limited to named plugin IDs. The UI displays a SHA-256 fingerprint before trust, and a native confirmation dialog records the user's decision. Signature trust confirms package origin and integrity. It does not grant plugin capabilities. The main process asks for separate approval before it grants `runtime.info` or `clipboard.write` for a running window.

The Electron management UI is in the Plugins section of `/settings`. The legacy `/settings/extensions` route redirects there. The web UI states that external plugin packages are desktop-only. A local signer key must be verified with its publisher before it is trusted.

Plugin HTML runs in a sandboxed renderer. The host serves an unchanged signed file and injects a host-owned bootstrap into the HTML response. The bootstrap installs the Worker guard and the versioned `window.itTools` client. The transformation does not write to the package directory. The host removes `meta http-equiv` tags from the response so package markup cannot override the host security policy or prevent the bootstrap from running.

The document CSP allows only same-origin dedicated Workers. The guard allows at most two active Workers per plugin window and terminates each Worker after 30 seconds, on an error, or when the document closes. Worker script responses set `worker-src 'none'`, so Workers cannot create nested Workers. The host disables `SharedWorker` and service-worker registration. Worker and document network requests remain limited to the plugin origin; the session also blocks HTTP, HTTPS, WebSocket, FTP, permissions, and downloads.

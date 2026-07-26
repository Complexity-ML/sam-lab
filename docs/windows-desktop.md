# Windows desktop support

SAM LAB keeps Electron's standard Windows frame. The system title bar and its native minimize, maximize and close controls remain outside the SAM LAB interface, so the application header does not need to imitate or reserve space for them.

## Development

Requirements: Windows 10 or 11, Node.js 20+ and npm. DataHub OSS stdio also requires `uvx` on `PATH`.

```powershell
npm ci
npm run electron:dev
```

Closing the last window exits SAM LAB on Windows and runs the normal workspace cleanup path. SQLite is stored under Electron's per-user `userData` directory; no hard-coded macOS path is used.

## Packaging smoke test

```powershell
npm run package:win:ci
```

This produces an unsigned x64 NSIS installer and ZIP for local/CI verification. Unsigned packages intentionally cannot use the updater. Production publishing must use a trusted Windows code-signing certificate and retain the native confirmation before installation.

The repository's **Windows desktop smoke** workflow repeats the full test suite on `windows-2022`, packages both artifacts and checks the executable metadata. The release configuration also declares `arm64` targets for a future signed release workflow.

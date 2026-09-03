# DeepWrite Desktop

DeepWrite is a local-first Windows desktop application for long-form writing. It provides a rich-text editing experience similar to a traditional word processor, while presenting DeepSeek-powered writing analysis as optional, reviewable, and rejectable suggestions rather than allowing the model to overwrite the original text directly.

> Current status: `0.1.1`, a runnable Phase 1 product. Core editing, standalone `.dwrite` documents, safe saving, document-aware recovery, bounded local version history, structured DeepSeek suggestions, and basic DOCX import/export have been implemented. The Windows NSIS installer bundles the WebView2 Evergreen Offline Installer. Complex Word formatting, exact pagination, and fully lossless round-trip fidelity are not guaranteed at this stage.

## Main Features

* Tiptap open-source core rich-text editing: body text, Heading 1–3, font family/size, bold, italic, underline, strikethrough, text color, highlighting, four alignment modes, indentation, line spacing, lists, block quotes, links, and horizontal rules.
* Table operations: insert tables, add/remove rows and columns, and delete tables.
* Local images: insert data URI images with basic width scaling.
* Custom page-break nodes that are converted into real page breaks when printing.
* Windows shortcuts: `Ctrl+N/O/S/Shift+S/Z/Y/F/H/B/I/U`, plus standard cut, copy, paste, and select-all shortcuts.
* Windows single-instance handoff keeps second-launch `.dwrite` paths in a Rust FIFO until the renderer listener is ready, so an early second launch cannot be lost merely because the UI has not mounted yet.
* Standalone `.dwrite` JSON documents whose authoritative current content does not depend on SQLite.
* Safe writes using temporary files in the same directory plus Windows `MoveFileExW` replace/write-through behavior.
* 1.5-second debounced autosave, per-document crash recovery, recent files, and restorable version history.
* New/Open/Open Recent/window-close transitions protect unsaved or failed-save states and require save or explicit discard before replacing the current document.
* The DeepSeek API Key is entered by the user in Settings. The Stronghold master password is protected by Windows Credential Manager, while the Key itself is stored in an encrypted Stronghold vault.
* DeepSeek JSON Output with strict Zod runtime validation; failed responses are automatically repaired/retried once.
* Proofreading, light/deep polishing, shortening, expansion, rewriting, logic review, contradiction detection, character consistency, continuation writing, and custom instructions.
* Suggestions display deleted original text with strikethrough and added text with double underline/background highlighting; users can accept, reject, accept all, or reject all.
* Phase 1 concurrency protection is conservative: suggestions are tied to document ID and exact document revision, require a unique single-paragraph source span, are resolved into ProseMirror positions, and compare the exact current source text before application. Any intervening document edit makes the old suggestion non-applicable.
* Continuation writing is a separate generated-text flow: generated continuation is reviewable/copyable and is inserted only after explicit user action if the document revision is still the one used for generation.
* Automatic analysis after writing pauses: Off / 1 / 3 / 5 / 10 / 15 minutes. Stable hashes are used only for submission deduplication; they are not used as the final proof that text is unchanged.
* Import `.dwrite/.docx/.txt/.md/.html`; export `.dwrite/.docx/.txt/.md/.html`; supports system printing/PDF output.

## Screenshots

Implementation screenshots are stored in `docs/screenshots/main-window.png`, and the visual design reference is stored in `docs/screenshots/deepwrite-concept.png`.

## Technical Architecture

```text
React + TypeScript + Vite
  ├─ Tiptap / ProseMirror: editor, tables, custom page breaks, and suggestion decorations
  ├─ Zod: .dwrite and AI JSON runtime validation
  ├─ Mammoth: DOCX → HTML → Tiptap
  ├─ docx: Tiptap JSON → DOCX
  └─ Tauri JS plugins: Dialog / SQL / Stronghold

Tauri 2 / Rust
  ├─ Safe atomic writes and document-aware recovery files
  ├─ DeepSeek HTTPS requests (without logging Keys or document content)
  ├─ Stronghold + Windows Credential Manager
  └─ SQLite migrations: recent files, settings, bounded full-document version snapshots, AI suggestion metadata, and history metadata
```

The authoritative current article is the user-selected `.dwrite` file. SQLite is local application support storage, not the authority for the current document. The application does not include a server, account system, cloud synchronization, multi-user collaboration, or telemetry.

## Windows Development Requirements

* Windows 10/11 x64
* Node.js 22+
* pnpm 11+
* Rust stable via rustup, with the MSVC target
* Microsoft Visual Studio 2022 Build Tools with “Desktop development with C++” and the Windows SDK
* Microsoft Edge WebView2 Runtime, required only for local development; the production NSIS installer silently installs its bundled Evergreen Runtime when needed
* WiX is required when building MSI packages; Tauri handles it according to its toolchain requirements

See the [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

## Installing Dependencies

```powershell
pnpm install
pnpm approve-builds esbuild
```

The project uses `pnpm-lock.yaml`. Do not switch to Bun without a specific reason.

## Development

```powershell
pnpm tauri dev
```

To preview only the Web frontend, where filesystem access, SQLite, Stronghold, and DeepSeek Rust commands are unavailable:

```powershell
pnpm dev
```

## Tests and Checks

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:windows-bundle
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Tests cover document serialization, rejection of corrupted/future schemas, AI response schemas, exact stale-suggestion handling, ambiguous-anchor rejection, ProseMirror text-offset mapping, document-transition guard states, pause-analysis deduplication, autosave debouncing, recovery filename isolation, full-document diagnostic disclosure/batch identity, pending second-instance FIFO ordering, and basic DOCX export. GitHub Actions runs the JavaScript/TypeScript checks and Windows Rust checks on pushes and pull requests.

## Production Build

```powershell
pnpm build
pnpm tauri build --bundles nsis
pnpm validate:windows-artifact
```

Windows installer outputs are located at:

* `src-tauri/target/release/bundle/nsis/`
* `src-tauri/target/release/bundle/msi/` (requires a working WiX toolchain)

The release configuration explicitly uses Tauri 2's `offlineInstaller` mode and retains the NSIS `currentUser` installation scope. The installer does not need to download WebView2 over the network and does not require administrator privileges merely to install DeepWrite. If no usable Runtime is present, NSIS silently installs the Microsoft Evergreen Offline Installer bundled inside the package.

Compared with the online bootstrapper, this significantly increases installer size. Tauri documentation cites a typical increase of approximately 127 MB, but the Microsoft payload changes between versions, so an actual x64 installer exceeding 200 MB is also expected behavior.

`pnpm validate:windows-bundle` parses the configuration and prevents `offlineInstaller` or the installation scope from being accidentally reverted. After building, run `pnpm validate:windows-artifact`; it additionally verifies installer size, the generated NSIS mode, and the WebView2 offline payload.

If installation still reports that no Runtime can be found, retain the installer exit code and the system's WebView2/Edge Updater state for diagnosis. A production release should not require users to download the Runtime manually.

## DeepSeek API Configuration

The project **does not include a DeepSeek API Key**. Users must provide their own Key.

1. Launch DeepWrite.
2. Open “Settings → AI”.
3. Enter the Key under DeepSeek API Key and click “Save / Update Key”.
4. Use “Test Connection”; the interface only displays success/failure and a length-limited error message.
5. The default fast model is `deepseek-v4-flash`, and the default deep model is `deepseek-v4-pro`.

The API Base URL is fixed to `https://api.deepseek.com/` and uses the OpenAI-compatible Chat Completions API. `deepseek-chat` and `deepseek-reasoner` are not included in the allowed-model list.

The Key is never written to source code, `.env`, or SQLite. DeepWrite does not output the Key to the console or error logs.

## Data Storage Locations

* Articles: the authoritative current document is stored at the `.dwrite` path selected by the user; the format is independently readable and recoverable.
* Local application data: the application directory assigned to `com.deepwrite.desktop` by Tauri under Windows `%LOCALAPPDATA%`.
* SQLite: `deepwrite.db`. It stores recent files, settings, local history metadata, AI suggestion metadata, and version-history snapshots. **Version snapshots contain complete historical `.dwrite` document content.** By default at most 50 snapshots are retained per document; the limit can be changed in Settings, including `0` to disable new snapshots. The current document's History dialog can delete all of its local snapshots.
* AI suggestion history: only non-content metadata is persisted (`type`, `severity`, `status` plus document/revision indexing). Migration 2 deletes legacy suggestion rows created by 0.1.1 that could contain source/replacement text.
* Stronghold: `deepwrite.vault.hold`; the vault master password is stored in Windows Credential Manager.
* Crash recovery: document-specific `.dwrite` recovery files inside the application-data `recovery/` directory. A successful save clears only the matching document's recovery file. Explicitly discarding unsaved changes also clears that document's recovery copy.

All of these user-data files are excluded by `.gitignore`.

## Privacy

Articles are stored locally by default. Ordinary proofreading, polishing, rewriting, continuation, custom AI actions, and optional pause-analysis send only the relevant selection/recent text plus bounded surrounding context, chapter-title summary data, and author rules to the user-configured DeepSeek API when the feature is invoked. Automatic pause-analysis remains bounded to recent context and does not silently start a full-document diagnosis.

The logic-review, contradiction-detection, and character-consistency commands are different: they are full-document diagnostic operations. Before any request is sent, DeepWrite displays a separate confirmation explaining that the entire current document will be split into a specific number of overlapping request batches and sent to the configured DeepSeek API. The exact batch plan shown in that confirmation is the plan used for the diagnostic run. Cancelling the confirmation sends nothing for that run. Each batch can also include author rules, chapter-title summary data, and limited selection/cursor-adjacent context. DeepSeek's handling of received data is governed by the user's API account and DeepSeek's service terms.

DeepWrite itself does not retain AI request bodies as request logs, stores no document text in AI suggestion-history payloads, includes no telemetry, and sends no document data to the project maintainer. Local version history is different: when enabled, it deliberately retains full historical document snapshots on the user's machine so that older versions can be restored. The retention limit and deletion control are exposed to the user.

## DOCX Compatibility Boundaries

DOCX import is based on Mammoth and focuses on preserving semantic structure: normal paragraphs, Heading 1–3, bold, italic, lists, links, basic tables, and images that Mammoth can reliably extract.

DOCX export supports paragraphs, headings, bold, italic, underline, alignment, lists, basic tables, data URI images, and page breaks.

Complex Microsoft Word formatting is not guaranteed to survive a 100% lossless round trip. Headers and footers, Track Changes, text boxes, SmartArt, complex floating objects, macros, exact font metrics, sections and page layout, fields, footnotes/endnotes, table-of-contents fields, and advanced table styles may be simplified or lost. The project does not claim full Microsoft Word compatibility.

## Security

* Never commit real API Keys, user databases, Stronghold vaults, user documents, recovery files, logs containing document text, or build caches.
* The Rust DeepSeek client uses a fixed HTTPS endpoint, restricts allowed models, and limits response error length.
* AI responses must pass a strict Zod schema; invalid JSON is never allowed to modify the document.
* Before accepting an AI suggestion, DeepWrite checks document ID, exact document revision, resolved structured position, and exact current source text. Ambiguous or cross-paragraph anchors fail closed.
* Generated continuation text is never inserted automatically and is invalidated for direct insertion by an intervening document edit.
* Saves use temporary files, flush/sync, and same-volume replacement to avoid damaging the only copy of the document. Save completion is not allowed to clear recovery or mark the UI saved if a newer revision appeared while the write was in progress.
* Before release, run `git grep` and a reasonable secret-pattern scan.

Do not include real API Keys or private document content in public issues when reporting security problems.

## Roadmap

* Improved DOCX image sizing, numbering hierarchy, and style mapping.
* Multi-page visual layout, headers/footers, and more reliable print preview.
* Stable per-block identities and a true rebase mechanism so safe suggestions can survive unrelated document edits instead of Phase 1's conservative whole-revision invalidation.
* Document-level character/location reference libraries and chapter-summary management.
* Optional local full-text search and version-diff comparison.
* In-depth accessibility and keyboard-navigation auditing.

## License

MIT. Direct dependencies are publicly available packages from npm/crates.io. Before release, the dependency license inventory should be regenerated and reviewed against the lockfile.

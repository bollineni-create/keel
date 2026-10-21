import AppKit
import WebKit

// Keel: a native window around the Keel PWA, in the same mould as Palimpsest's Mac app.
// The app runs Keel's Node server from the project folder named in Info.plist (KeelSourceFolder), or uses one
// that's already running (a launchd agent, `npm start`), and shows it in a WKWebView. Quitting stops the server
// only if the app started it. Files under web/ reload the window when they change; files under src/ restart
// the server the app owns.

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var ready = false
    var quitting = false
    var restarting = false
    var startedAt = Date()
    var webSignature = ""
    var srcSignature = ""
    var lastDownload: URL?
    var titleObservation: NSKeyValueObservation?
    var env: [String: String] = [:]

    lazy var root: URL? = {
        guard let path = Bundle.main.object(forInfoDictionaryKey: "KeelSourceFolder") as? String, !path.isEmpty else { return nil }
        let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
        return FileManager.default.fileExists(atPath: url.appendingPathComponent("package.json").path) ? url : nil
    }()
    var port: Int { Int(env["PORT"] ?? "") ?? 4242 }
    var token: String { env["KEEL_TOKEN"] ?? "" }
    var base: URL { URL(string: "http://127.0.0.1:\(port)/")! }
    let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Keel/server.log")

    // MARK: Launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()               // keeps the token cookie, theme, saved views
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")

        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1440, screen.width * 0.9), height: min(920, screen.height * 0.9))
        window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Keel"
        window.minSize = NSSize(width: 380, height: 520)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.backgroundColor = .windowBackgroundColor
        window.contentView = webView
        window.delegate = self
        window.setFrameAutosaveName("KeelMainWindow")
        if !window.setFrameUsingName("KeelMainWindow") { window.center() }
        window.makeKeyAndOrderFront(nil)
        titleObservation = webView.observe(\.title, options: [.new]) { [weak self] wv, _ in
            guard let self = self, self.ready, let t = wv.title, !t.isEmpty else { return }
            self.window.title = t
        }

        connect()
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.checkForChanges() }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        quitting = true
        stopServer()
        return .terminateNow
    }

    // MARK: Server

    /// Uses a Keel server that's already answering on the port, otherwise starts one.
    func connect() {
        env = readEnv()
        ready = false
        guard root != nil else {
            return showMessage("Keel can’t find its project folder",
                               "This app runs Keel from the folder it was built in, and that folder has moved. Rebuild it with <code>npm run app</code> from the new location.")
        }
        showMessage("Starting Keel…", nil, spinner: true)
        probe { code in
            switch code {
            case 200: self.openApp()
            case 401: self.showMessage("Keel turned the app away",
                                       "Something on port \(self.port) is asking for a token that doesn’t match <code>KEEL_TOKEN</code> in <code>.env</code>.",
                                       actions: [("Try again", "retry")])
            default: self.startServer()
            }
        }
    }

    func probe(_ done: @escaping (Int) -> Void) {
        var req = URLRequest(url: base.appendingPathComponent("api/status"), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 1.5)
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            DispatchQueue.main.async { done(code) }
        }.resume()
    }

    func startServer() {
        guard let root = root else { return }
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("node_modules/tsx").path) else {
            return showMessage("Keel’s packages aren’t installed",
                               "Run <code>npm install</code> in <code>\(esc(root.path))</code>, then try again.",
                               actions: [("Try again", "retry"), ("Show project folder", "folder")])
        }
        try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let log = try? FileHandle(forWritingTo: logURL)

        // A login shell finds Node wherever it was installed (Homebrew, nvm, fnm, Volta). `exec` makes the
        // server this process itself, so terminating it stops Keel cleanly.
        let script = """
        export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
        [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
        command -v fnm >/dev/null 2>&1 && eval "$(fnm env)" >/dev/null 2>&1
        command -v node >/dev/null 2>&1 || exit 127
        cd \(shellQuote(root.path)) && exec node --import tsx src/server.ts
        """
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", script]
        p.environment = ProcessInfo.processInfo.environment
        p.standardOutput = log
        p.standardError = log
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { self?.serverExited(proc.terminationStatus) }
        }
        do { try p.run() } catch {
            return showMessage("Keel’s server couldn’t start", esc(error.localizedDescription), actions: [("Try again", "retry")])
        }
        server = p
        startedAt = Date()
        waitForServer()
    }

    func waitForServer() {
        probe { code in
            guard let p = self.server, p.isRunning else { return }
            if code == 200 { return self.openApp() }
            if Date().timeIntervalSince(self.startedAt) > 60 {
                return self.showMessage("Keel’s server didn’t answer", self.logTail(), actions: [("Try again", "retry"), ("Show log", "log")])
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.waitForServer() }
        }
    }

    func serverExited(_ status: Int32) {
        server = nil
        if quitting { return }
        if restarting { restarting = false; return connect() }
        ready = false
        if status == 127 {
            showMessage("Keel needs Node.js", "Install Node.js 20 or later (<code>brew install node</code>), then try again.", actions: [("Try again", "retry")])
        } else {
            showMessage("Keel’s server stopped", logTail(), actions: [("Restart", "retry"), ("Show log", "log")])
        }
    }

    func stopServer() {
        guard let p = server, p.isRunning else { return }
        p.terminate()
        let deadline = Date().addingTimeInterval(3)
        while p.isRunning && Date() < deadline { usleep(50_000) }
        if p.isRunning { kill(p.processIdentifier, SIGKILL) }
    }

    func restartServer() {
        guard server != nil else { return connect() }
        restarting = true
        ready = false
        showMessage("Restarting Keel…", nil, spinner: true)
        server?.terminate()
    }

    func openApp() {
        ready = true
        var c = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        if !token.isEmpty { c.queryItems = [URLQueryItem(name: "token", value: token)] }   // the server answers with a cookie
        webView.load(URLRequest(url: c.url!))
        webSignature = signature(of: ["web", "design"])
        srcSignature = signature(of: ["src", ".env"])
    }

    // MARK: Live reload

    /// Modification dates of the files under the given project paths.
    private func signature(of paths: [String]) -> String {
        guard let root = root else { return "" }
        var parts: [String] = []
        for path in paths {
            let url = root.appendingPathComponent(path)
            let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { continue }
            var files = [url]
            if isDir.boolValue, let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants]) {
                files = walker.compactMap { $0 as? URL }
            }
            for f in files.sorted(by: { $0.path < $1.path }) {
                let v = try? f.resourceValues(forKeys: Set(keys))
                parts.append("\(f.path):\(v?.contentModificationDate?.timeIntervalSince1970 ?? 0):\(v?.fileSize ?? 0)")
            }
        }
        return parts.joined(separator: "|")
    }

    private func checkForChanges() {
        guard ready else { return }
        let src = signature(of: ["src", ".env"])
        if src != srcSignature {
            srcSignature = src
            if server != nil { return restartServer() }      // only a server this app started
        }
        let web = signature(of: ["web", "design"])
        if web != webSignature {
            webSignature = web
            webView.reload()
        }
    }

    // MARK: Status pages

    func showMessage(_ title: String, _ body: String?, spinner: Bool = false, actions: [(String, String)] = []) {
        if !spinner { window.title = "Keel" }
        let buttons = actions.map { "<a class=\"btn\" href=\"keel://\($0.1)\">\(esc($0.0))</a>" }.joined()
        let spin = spinner ? "<div class=\"spin\"></div>" : ""
        var text = ""
        if let body = body { text = body.hasPrefix("<pre>") ? body : "<p>" + body + "</p>" }
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><style>
        :root { color-scheme: light dark; --bg: #f5f6f8; --card: #fff; --ink: #1a1d23; --muted: #6b7280; --line: #e6e8ec; --brand: #117a58; }
        @media (prefers-color-scheme: dark) { :root { --bg: #0f1216; --card: #171b21; --ink: #eef1f4; --muted: #9aa5b1; --line: #2a323c; --brand: #3ccf9a; } }
        body { margin: 0; height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink); font: 13px/18px -apple-system, system-ui, sans-serif; }
        .card { max-width: 520px; padding: 32px; text-align: center; }
        h1 { font-size: 17px; line-height: 22px; margin: 16px 0 8px; }
        p, pre { color: var(--muted); margin: 0 0 16px; }
        pre { text-align: left; font: 11px/15px ui-monospace, Menlo, monospace; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; max-height: 220px; overflow: auto; white-space: pre-wrap; }
        code { font: 12px ui-monospace, Menlo, monospace; }
        .btn { display: inline-block; margin: 0 4px; padding: 5px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink); text-decoration: none; font-weight: 500; }
        .btn:first-child { background: var(--brand); border-color: transparent; color: #fff; }
        .mark { width: 48px; height: 48px; }
        .spin { width: 18px; height: 18px; margin: 0 auto; border: 2px solid var(--line); border-top-color: var(--brand); border-radius: 50%; animation: s 0.8s linear infinite; }
        @keyframes s { to { transform: rotate(360deg); } }
        </style></head><body><div class="card">
        <svg class="mark" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="6" fill="#117a58"/><path d="M7 17V7m0 10a7 7 0 0 1 7-7m-7 7h10" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
        <h1>\(esc(title))</h1>
        \(spin)
        \(text)
        <div>\(buttons)</div>
        </div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func logTail() -> String {
        let text = (try? String(contentsOf: logURL, encoding: .utf8)) ?? ""
        let tail = text.split(separator: "\n", omittingEmptySubsequences: false).suffix(20).joined(separator: "\n")
        return tail.isEmpty ? "No output from the server." : "<pre>\(esc(tail))</pre>"
    }

    func handleCommand(_ cmd: String) {
        switch cmd {
        case "retry": connect()
        case "log": showLog(nil)
        case "folder": revealProject(nil)
        default: break
        }
    }

    // MARK: Navigation, downloads, panels

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        if url.scheme == "keel" {
            handleCommand(url.host ?? "")
            return decisionHandler(.cancel)
        }
        let isKeel = (url.host == "127.0.0.1" || url.host == "localhost") && url.port == port
        if url.scheme?.hasPrefix("http") == true && !isKeel {
            NSWorkspace.shared.open(url)                    // Get help, docs and other links open in the browser
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let r = navigationResponse.response as? HTTPURLResponse,
           let disposition = r.value(forHTTPHeaderField: "Content-Disposition"), disposition.lowercased().hasPrefix("attachment") {
            return decisionHandler(.download)               // CSV export
        }
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let name = (suggestedFilename as NSString).deletingPathExtension, ext = (suggestedFilename as NSString).pathExtension
        var url = dir.appendingPathComponent(suggestedFilename)
        var n = 1
        while FileManager.default.fileExists(atPath: url.path) {
            n += 1
            url = dir.appendingPathComponent(ext.isEmpty ? "\(name) \(n)" : "\(name) \(n).\(ext)")
        }
        lastDownload = url
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let url = lastDownload { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert()
        a.messageText = prompt
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.window.initialFirstResponder = field
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    // MARK: Menu actions (they drive the web app the same way its own controls do)

    private func js(_ source: String) { if ready { webView.evaluateJavaScript(source, completionHandler: nil) } }

    @objc func goTo(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        js("location.hash = '#\(path)'")
    }
    @objc func openSettings(_ sender: Any?) { js("document.querySelector('.sidebar [data-act=settings]').click()") }
    @objc func openStartHere(_ sender: Any?) { js("document.querySelector('.sidebar [data-act=start]').click()") }
    @objc func search(_ sender: Any?) {
        js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))")
    }
    @objc func newTransaction(_ sender: Any?) {
        js("""
        (() => { const add = () => document.querySelector('.pane--main [data-act=add]')?.click();
          if (location.hash.startsWith('#/transactions')) add(); else { location.hash = '#/transactions'; setTimeout(add, 600); } })()
        """)
    }
    @objc func exportCSV(_ sender: Any?) {
        js("""
        (() => { const b = document.querySelector('.pane--main [data-act=export]');
          if (b) b.click(); else location.href = '/api/transactions/export.csv?transfers=true&excluded=true'; })()
        """)
    }
    @objc func syncNow(_ sender: Any?) {
        js("fetch('/api/sync', { method: 'POST' }).then((r) => r.json()).finally(() => document.querySelector('[data-win=refresh]')?.click())")
    }
    @objc func reloadPage(_ sender: Any?) {
        if ready { webView.reload() } else { connect() }
    }
    @objc func restart(_ sender: Any?) { restartServer() }
    @objc func goBack(_ sender: Any?) { webView.goBack() }
    @objc func goForward(_ sender: Any?) { webView.goForward() }
    @objc func revealProject(_ sender: Any?) { if let root = root { NSWorkspace.shared.activateFileViewerSelecting([root]) } }
    @objc func showLog(_ sender: Any?) {
        if FileManager.default.fileExists(atPath: logURL.path) { NSWorkspace.shared.open(logURL) }
    }
    @objc func openHelp(_ sender: Any?) {
        if let url = URL(string: "https://github.com/bollineni-create/keel#readme") { NSWorkspace.shared.open(url) }
    }

    private func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            if !key.isEmpty { i.keyEquivalentModifierMask = mods }
            return i
        }

        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Keel", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(item("Settings…", #selector(openSettings(_:)), ","))
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Keel", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Keel", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem(); main.addItem(fileItem)
        let file = NSMenu(title: "File")
        file.addItem(item("New Transaction…", #selector(newTransaction(_:)), "n"))
        file.addItem(item("Export Transactions as CSV", #selector(exportCSV(_:)), "e", [.command, .shift]))
        file.addItem(.separator())
        file.addItem(item("Sync from Copilot", #selector(syncNow(_:)), "s", [.command, .shift]))
        file.addItem(.separator())
        file.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = file

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.addItem(.separator())
        edit.addItem(item("Search…", #selector(search(_:)), "k"))
        editItem.submenu = edit

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        let screens = [("Dashboard", "/"), ("Transactions", "/transactions"), ("Goals", "/goals"), ("Cash Flow", "/cashflow"),
                       ("Accounts", "/accounts"), ("Investments", "/investments"), ("Categories", "/categories"),
                       ("Recurrings", "/recurrings"), ("Assistant", "/assistant")]
        for (i, (title, path)) in screens.enumerated() {
            let s = item(title, #selector(goTo(_:)), String(i + 1))
            s.representedObject = path
            view.addItem(s)
        }
        view.addItem(.separator())
        view.addItem(item("Back", #selector(goBack(_:)), "["))
        view.addItem(item("Forward", #selector(goForward(_:)), "]"))
        view.addItem(item("Reload", #selector(reloadPage(_:)), "r"))
        view.addItem(.separator())
        let fs = item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.control, .command])
        view.addItem(fs)
        viewItem.submenu = view

        let serverItem = NSMenuItem(); main.addItem(serverItem)
        let srv = NSMenu(title: "Server")
        srv.addItem(withTitle: "Restart Server", action: #selector(restart(_:)), keyEquivalent: "")
        srv.addItem(withTitle: "Show Server Log", action: #selector(showLog(_:)), keyEquivalent: "")
        srv.addItem(withTitle: "Show Project Folder", action: #selector(revealProject(_:)), keyEquivalent: "")
        serverItem.submenu = srv

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winItem.submenu = win
        NSApp.windowsMenu = win

        let helpItem = NSMenuItem(); main.addItem(helpItem)
        let help = NSMenu(title: "Help")
        help.addItem(withTitle: "Start Here", action: #selector(openStartHere(_:)), keyEquivalent: "")
        help.addItem(withTitle: "Keel on GitHub", action: #selector(openHelp(_:)), keyEquivalent: "")
        helpItem.submenu = help
        NSApp.helpMenu = help

        NSApp.mainMenu = main
    }

    // MARK: Helpers

    func readEnv() -> [String: String] {
        guard let root = root, let text = try? String(contentsOf: root.appendingPathComponent(".env"), encoding: .utf8) else { return [:] }
        var out: [String: String] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
            let s = line.trimmingCharacters(in: .whitespaces)
            guard !s.isEmpty, !s.hasPrefix("#"), let eq = s.firstIndex(of: "=") else { continue }
            var key = String(s[..<eq]).trimmingCharacters(in: .whitespaces)
            if key.hasPrefix("export ") { key = String(key.dropFirst(7)).trimmingCharacters(in: .whitespaces) }
            var value = String(s[s.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            if value.count >= 2, let q = value.first, q == "\"" || q == "'", value.last == q { value = String(value.dropFirst().dropLast()) }
            out[key] = value
        }
        return out
    }
}

func shellQuote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
func esc(_ s: String) -> String {
    s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

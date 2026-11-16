import UIKit
import WebKit

// Detlog MNN for iPhone and iPad: the site (the bundled folder "site") in a full-screen web view.
// Its files are in the app's Documents folder, which the Files app shows, through
// window.webkit.messageHandlers.lucianfs: the same requests the Android and desktop apps answer.

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool { true }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: session.role)
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
    }
}

final class WebViewController: UIViewController, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    private var web: WKWebView!
    private let files = FileManager.default
    private var root: URL { files.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "lucianfs")
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let site = Bundle.main.url(forResource: "site", withExtension: nil)!
        web.loadFileURL(site.appendingPathComponent("index.html"), allowingReadAccessTo: site)
    }

    // other sites open in Safari
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, let scheme = url.scheme, scheme.hasPrefix("http") {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    private func inside(_ rel: String?) throws -> URL {
        let base = root.standardizedFileURL
        let url = base.appendingPathComponent((rel ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))).standardizedFileURL
        guard url.path == base.path || url.path.hasPrefix(base.path + "/") else { throw err("outside the app folder") }
        return url
    }
    private func err(_ s: String) -> NSError { NSError(domain: "lucianfs", code: 1, userInfo: [NSLocalizedDescriptionKey: s]) }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let req = message.body as? [String: Any], let op = req["op"] as? String else { replyHandler(["ok": false, "error": "bad request"], nil); return }
        do {
            let url = try inside(req["path"] as? String)
            var out: [String: Any] = ["ok": true]
            switch op {
            case "root": out["data"] = "On My iPhone › Detlog MNN"
            case "list":
                let names = try files.contentsOfDirectory(atPath: url.path).filter { !$0.hasPrefix(".") }
                out["entries"] = names.map { name -> [String: Any] in
                    let p = url.appendingPathComponent(name)
                    var dir: ObjCBool = false
                    files.fileExists(atPath: p.path, isDirectory: &dir)
                    if dir.boolValue { return ["name": name, "type": "dir"] }
                    let a = (try? files.attributesOfItem(atPath: p.path)) ?? [:]
                    return ["name": name, "type": "file", "size": (a[.size] as? NSNumber)?.intValue ?? 0, "mtime": ((a[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000]
                }
            case "read":
                let data = try Data(contentsOf: url)
                if (req["encoding"] as? String) == "base64" { out["data"] = data.base64EncodedString() }
                else { out["data"] = String(decoding: data, as: UTF8.self) }
            case "write":
                try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                let s = req["data"] as? String ?? ""
                let data = (req["encoding"] as? String) == "base64" ? (Data(base64Encoded: s) ?? Data()) : Data(s.utf8)
                try data.write(to: url, options: .atomic)
            case "mkdir": try files.createDirectory(at: url, withIntermediateDirectories: true)
            case "remove":
                guard url.path != root.standardizedFileURL.path else { throw err("can't remove the app folder") }
                try files.removeItem(at: url)
            case "rename":
                let to = try inside(req["to"] as? String)
                try files.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
                try files.moveItem(at: url, to: to)
            case "stat": out["exists"] = files.fileExists(atPath: url.path)
            case "share":
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
                present(sheet, animated: true)
            default: throw err("unknown request \(op)")
            }
            replyHandler(out, nil)
        } catch {
            let ns = error as NSError
            let text = ns.domain == NSCocoaErrorDomain && (ns.code == NSFileReadNoSuchFileError || ns.code == NSFileNoSuchFileError) ? "no such file or folder" : error.localizedDescription
            replyHandler(["ok": false, "error": text], nil)
        }
    }
}

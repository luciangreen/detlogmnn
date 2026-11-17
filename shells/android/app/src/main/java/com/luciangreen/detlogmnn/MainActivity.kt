package com.luciangreen.detlogmnn

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// Detlog MNN for Android: the site (the app's assets) in a full-screen WebView, served from
// https://appassets.androidplatform.net so it runs as a normal web page. Its files live on the
// phone in the app's folder (Android/data/com.luciangreen.detlogmnn/files), through window.LucianAndroid.fs.
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var chooserCallback: ValueCallback<Array<Uri>>? = null
    private val chooser = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        chooserCallback?.onReceiveValue(uris.toTypedArray())
        chooserCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.databaseEnabled = true
        web.addJavascriptInterface(Bridge(), "LucianAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                startActivity(Intent(Intent.ACTION_VIEW, url)) // other sites open in the browser
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // <input type="file">: the phone's document picker
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                chooserCallback?.onReceiveValue(null)
                chooserCallback = callback
                chooser.launch(arrayOf("*/*"))
                return true
            }
        }
        setContentView(web)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })
        if (savedInstanceState == null) web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
        else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }

    private fun root(): File = (getExternalFilesDir(null) ?: filesDir).also { it.mkdirs() }

    private fun inside(rel: String?): File {
        val base = root().canonicalFile
        val f = File(base, (rel ?: "").trimStart('/')).canonicalFile
        if (f != base && !f.path.startsWith(base.path + File.separator)) throw IllegalArgumentException("outside the app folder")
        return f
    }

    // The same requests the iPhone and desktop apps answer: { op, path, to?, data?, encoding? }.
    inner class Bridge {
        @JavascriptInterface
        fun fs(json: String): String {
            val out = JSONObject()
            try {
                val req = JSONObject(json)
                val f = inside(req.optString("path"))
                when (req.optString("op")) {
                    "root" -> out.put("data", root().path)
                    "list" -> {
                        val arr = JSONArray()
                        (f.listFiles() ?: throw java.io.FileNotFoundException("no such folder: ${req.optString("path")}"))
                            .filter { !it.name.startsWith(".") }
                            .forEach { e ->
                                val o = JSONObject().put("name", e.name).put("type", if (e.isDirectory) "dir" else "file")
                                if (e.isFile) o.put("size", e.length()).put("mtime", e.lastModified())
                                arr.put(o)
                            }
                        out.put("entries", arr)
                    }
                    "read" -> {
                        val bytes = f.readBytes()
                        out.put("data", if (req.optString("encoding") == "base64") Base64.encodeToString(bytes, Base64.NO_WRAP) else String(bytes, Charsets.UTF_8))
                    }
                    "write" -> {
                        f.parentFile?.mkdirs()
                        val data = req.optString("data")
                        if (req.optString("encoding") == "base64") f.writeBytes(Base64.decode(data, Base64.DEFAULT)) else f.writeText(data)
                    }
                    "mkdir" -> f.mkdirs()
                    "remove" -> { if (f == root().canonicalFile) throw IllegalArgumentException("can't remove the app folder"); f.deleteRecursively() }
                    "rename" -> { val to = inside(req.optString("to")); to.parentFile?.mkdirs(); if (!f.renameTo(to)) throw java.io.IOException("couldn't rename ${f.name}") }
                    "stat" -> out.put("exists", f.exists())
                    "share" -> runOnUiThread {
                        val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                        val send = Intent(Intent.ACTION_SEND).setType("*/*").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        startActivity(Intent.createChooser(send, f.name))
                    }
                    else -> throw IllegalArgumentException("unknown request ${req.optString("op")}")
                }
                out.put("ok", true)
            } catch (e: Exception) {
                out.put("ok", false).put("error", if (e is java.io.FileNotFoundException) "no such file or folder" else (e.message ?: e.toString()))
            }
            return out.toString()
        }
    }
}

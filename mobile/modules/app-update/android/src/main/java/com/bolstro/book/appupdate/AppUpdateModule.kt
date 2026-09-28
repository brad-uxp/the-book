package com.bolstro.book.appupdate

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.MessageDigest

/**
 * In-app updates: the pieces JavaScript can't do.
 *
 * - `sha256` hashes a downloaded APK (~50–120 MB) as a stream, off the JS
 *   thread, so the phone can compare it with the published digest.
 * - `install` hands it to Android's package installer through a FileProvider.
 *   Android shows its own confirmation, and installs only an APK signed with
 *   the same key as the running app.
 *
 * Both accept only files inside the app's cache/updates/ folder: JavaScript
 * cannot point them at anything else on the phone.
 */
class AppUpdateModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw NoContextException()

  override fun definition() = ModuleDefinition {
    Name("AppUpdate")

    Function("installedVersion") {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      mapOf("name" to (info.versionName ?: ""), "code" to PackageInfoCompat.getLongVersionCode(info).toDouble())
    }

    AsyncFunction("sha256") { path: String ->
      val file = updateFile(path)
      val digest = MessageDigest.getInstance("SHA-256")
      file.inputStream().use { input ->
        val buffer = ByteArray(1 shl 20)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          digest.update(buffer, 0, read)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    Function("canInstall") {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    }

    Function("openInstallSettings") {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("install") { path: String ->
      val file = updateFile(path)
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.appupdate.files", file)
      val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  /** The file behind `path` (a path or file:// URI), only if it sits in cache/updates/. */
  private fun updateFile(path: String): File {
    val file = File(Uri.parse(path).path ?: path).canonicalFile
    val dir = File(context.cacheDir, "updates").canonicalFile
    if (file.parentFile != dir || !file.isFile) throw NotAnUpdateFileException()
    return file
  }
}

private class NoContextException : CodedException("ERR_NO_CONTEXT", "The app context is not available", null)

private class NotAnUpdateFileException :
  CodedException("ERR_NOT_AN_UPDATE_FILE", "Only a downloaded update in the app's cache can be hashed or installed", null)

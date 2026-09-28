package com.bolstro.book.appupdate

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
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
 * - `verify` reads the APK's package name and signing certificates and
 *   requires both to be this app's. Android's own same-key rule only protects
 *   an update of the SAME package: an APK of another package, signed with any
 *   key, would install as a new app. So a build the server offers — through a
 *   stolen release token, say — is refused unless it is book., signed by the
 *   key the installed book. is signed with.
 * - `install` verifies again, then hands the file to Android's package
 *   installer through a FileProvider. Android shows its own confirmation.
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

    AsyncFunction("verify") { path: String ->
      verdict(updateFile(path))
    }

    Function("install") { path: String ->
      val file = updateFile(path)
      if (verdict(file) != "ok") throw NotThisAppException()
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.appupdate.files", file)
      val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  /**
   * "ok" only for an APK of this package whose current signer(s) are the
   * installed app's — or, after a key rotation, whose signing lineage includes
   * the installed app's signer, which is what Android itself accepts.
   * Anything unreadable is refused: fail closed.
   */
  private fun verdict(file: File): String {
    val pm = context.packageManager
    val archive = archiveInfo(pm, file.path) ?: return "unreadable"
    if (archive.packageName != context.packageName) return "wrong_package"
    val installed = installedInfo(pm)
    val mine = currentSigners(installed)
    val theirs = currentSigners(archive)
    if (mine.isEmpty() || theirs.isEmpty()) return "unreadable"
    if (theirs == mine) return "ok"
    // Rotation: a single new signer whose proof-of-rotation history includes ours.
    if (mine.size == 1 && pastSigners(archive).contains(mine.first())) return "ok"
    return "wrong_signer"
  }

  @Suppress("DEPRECATION")
  private fun archiveInfo(pm: PackageManager, path: String): PackageInfo? {
    val flags =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        // GET_SIGNATURES too: some Android versions leave signingInfo empty
        // for an archive (not installed) APK.
        PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES
      } else {
        PackageManager.GET_SIGNATURES
      }
    return pm.getPackageArchiveInfo(path, flags)
  }

  @Suppress("DEPRECATION")
  private fun installedInfo(pm: PackageManager): PackageInfo {
    val flags =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
      else PackageManager.GET_SIGNATURES
    return pm.getPackageInfo(context.packageName, flags)
  }

  /** SHA-256 digests of the certificates the package is signed with now. */
  @Suppress("DEPRECATION")
  private fun currentSigners(info: PackageInfo): Set<String> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signing = info.signingInfo
      if (signing != null) {
        val certs =
          if (signing.hasMultipleSigners()) signing.apkContentsSigners
          else signing.signingCertificateHistory?.lastOrNull()?.let { arrayOf(it) }
        if (certs != null && certs.isNotEmpty()) return certs.map(::digest).toSet()
      }
    }
    return info.signatures?.map(::digest)?.toSet() ?: emptySet()
  }

  /** Every certificate in a single-signer package's rotation history (API 28+). */
  private fun pastSigners(info: PackageInfo): Set<String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return emptySet()
    val signing = info.signingInfo ?: return emptySet()
    if (signing.hasMultipleSigners()) return emptySet()
    return signing.signingCertificateHistory?.map(::digest)?.toSet() ?: emptySet()
  }

  private fun digest(sig: Signature): String =
    MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }

  /** The file behind `path` (a path or file:// URI), only if it sits in cache/updates/. */
  private fun updateFile(path: String): File {
    val file = File(Uri.parse(path).path ?: path).canonicalFile
    val dir = File(context.cacheDir, "updates").canonicalFile
    if (file.parentFile != dir || !file.isFile) throw NotAnUpdateFileException()
    return file
  }
}

private class NoContextException : CodedException("ERR_NO_CONTEXT", "The app context is not available", null)

private class NotThisAppException :
  CodedException("ERR_NOT_THIS_APP", "The update is not book. signed with this app's key", null)

private class NotAnUpdateFileException :
  CodedException("ERR_NOT_AN_UPDATE_FILE", "Only a downloaded update in the app's cache can be hashed or installed", null)

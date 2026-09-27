package com.bolstro.book.googleid

import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Sign in with Google through Android's Credential Manager, the API Google
 * supports today (the old GoogleSignInClient is deprecated).
 *
 * Returns a Google ID token whose audience is `serverClientId` — the book.
 * WEB OAuth client — so the server can verify it against its own client id.
 * The Android OAuth client (package + signing SHA-1) never appears in code:
 * Google checks it on the device, and refuses with DEVELOPER_ERROR if the app
 * is not signed with a key registered for this package.
 *
 * `nonce` is the server's single-use nonce; Google signs it into the token.
 */
class GoogleIdModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GoogleId")

    AsyncFunction("signIn") Coroutine { serverClientId: String, nonce: String ->
      val activity = appContext.currentActivity ?: throw NoActivityException()

      val option = GetSignInWithGoogleOption.Builder(serverClientId)
        .setNonce(nonce)
        .build()
      val request = GetCredentialRequest.Builder()
        .addCredentialOption(option)
        .build()

      val result = try {
        CredentialManager.create(activity).getCredential(activity, request)
      } catch (e: GetCredentialCancellationException) {
        throw SignInCancelledException()
      } catch (e: NoCredentialException) {
        throw NoAccountException()
      } catch (e: GetCredentialException) {
        throw SignInFailedException("${e.type}: ${e.message}", e)
      }

      val credential = result.credential
      if (credential !is CustomCredential ||
        credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
      ) {
        throw SignInFailedException("Unexpected credential type: ${credential.type}", null)
      }

      val google = try {
        GoogleIdTokenCredential.createFrom(credential.data)
      } catch (e: GoogleIdTokenParsingException) {
        throw SignInFailedException("Google returned an unreadable credential", e)
      }

      mapOf(
        "idToken" to google.idToken,
        "email" to google.id,
        "displayName" to google.displayName
      )
    }
  }
}

internal class NoActivityException :
  CodedException("ERR_NO_ACTIVITY", "There is no screen to show Google's sign-in on", null)

internal class SignInCancelledException :
  CodedException("ERR_CANCELLED", "Sign-in was cancelled", null)

internal class NoAccountException :
  CodedException("ERR_NO_ACCOUNT", "No Google account is available on this device", null)

internal class SignInFailedException(message: String, cause: Throwable?) :
  CodedException("ERR_SIGN_IN_FAILED", message, cause)

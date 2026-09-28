package com.bolstro.book.appupdate

import androidx.core.content.FileProvider

/** A FileProvider of its own: its authority and paths never mix with another library's. */
class UpdateFileProvider : FileProvider()

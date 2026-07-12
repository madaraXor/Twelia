package app.twelia.client

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  @Suppress("DEPRECATION")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    if (BuildConfig.DEBUG) {
      WebView.setWebContentsDebuggingEnabled(true)
    }

    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT

    val content = findViewById<View>(android.R.id.content)
    content.setBackgroundColor(Color.rgb(13, 12, 10))
    content.post { disableBrowserZoom(content) }
    enterImmersiveMode()
  }

  override fun onResume() {
    super.onResume()
    val content = findViewById<View>(android.R.id.content)
    content.post { disableBrowserZoom(content) }
    enterImmersiveMode()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      enterImmersiveMode()
    }
  }

  private fun enterImmersiveMode() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes = window.attributes.apply {
        layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
      systemBarsBehavior =
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.systemBars())
    }
  }

  private fun disableBrowserZoom(view: View) {
    if (view is WebView) {
      view.settings.setSupportZoom(false)
      view.settings.builtInZoomControls = false
      view.settings.displayZoomControls = false
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        disableBrowserZoom(view.getChildAt(index))
      }
    }
  }
}

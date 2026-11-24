package com.pingpong.android

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AudioRouteModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var previousMode: Int? = null
  private var active = false

  override fun getName(): String = "AudioRouteModule"

  private fun audioManager(): AudioManager =
    reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  @ReactMethod
  fun start(output: String, promise: Promise) {
    try {
      val manager = audioManager()
      if (!active) {
        previousMode = manager.mode
        active = true
      }
      manager.mode = AudioManager.MODE_IN_COMMUNICATION
      applyOutput(manager, output)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("AUDIO_ROUTE_START_FAILED", error)
    }
  }

  @ReactMethod
  fun selectOutput(output: String, promise: Promise) {
    try {
      val manager = audioManager()
      applyOutput(manager, output)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("AUDIO_ROUTE_SELECT_FAILED", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      val manager = audioManager()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        manager.clearCommunicationDevice()
      }
      @Suppress("DEPRECATION")
      manager.isSpeakerphoneOn = false
      manager.mode = previousMode ?: AudioManager.MODE_NORMAL
      previousMode = null
      active = false
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("AUDIO_ROUTE_STOP_FAILED", error)
    }
  }

  private fun applyOutput(manager: AudioManager, output: String) {
    val useSpeaker = output == "speaker"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val targetType =
        if (useSpeaker) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
        else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
      val device = manager.availableCommunicationDevices.firstOrNull { it.type == targetType }
      if (device != null) {
        manager.setCommunicationDevice(device)
        return
      }
    }
    @Suppress("DEPRECATION")
    manager.isSpeakerphoneOn = useSpeaker
  }
}

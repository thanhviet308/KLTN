import { NativeModules, Platform } from 'react-native';

export type AudioOutput = 'speaker' | 'earpiece';

interface NativeAudioRoute {
  start(output: AudioOutput): Promise<void>;
  selectOutput(output: AudioOutput): Promise<void>;
  stop(): Promise<void>;
}

const nativeModule = NativeModules.AudioRouteModule as
  NativeAudioRoute | undefined;

export const AudioRoute = {
  async start(output: AudioOutput) {
    if (Platform.OS !== 'android' || !nativeModule) return;
    await nativeModule.start(output);
  },
  async selectOutput(output: AudioOutput) {
    if (Platform.OS !== 'android' || !nativeModule) return;
    await nativeModule.selectOutput(output);
  },
  async stop() {
    if (Platform.OS !== 'android' || !nativeModule) return;
    await nativeModule.stop();
  },
};

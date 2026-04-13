# Android / APK Path

This workspace is prepared as an installable PWA and has a Capacitor config for Android packaging.

To produce a real APK on a machine with Java + Android SDK installed:

```bash
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Then build an APK or AAB from Android Studio or Gradle.

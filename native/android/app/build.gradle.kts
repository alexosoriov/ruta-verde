plugins {
    id("com.android.application")
}

android {
    namespace = "cl.rutaverde.navigator"
    compileSdk = 37

    defaultConfig {
        applicationId = "cl.rutaverde.navigator"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "RUTA_VERDE_URL", "\"https://rutaverde.cl\"")
        buildConfigField("String", "RUTA_VERDE_HOST", "\"rutaverde.cl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

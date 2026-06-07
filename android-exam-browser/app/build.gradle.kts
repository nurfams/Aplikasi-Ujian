plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "id.sman94.cbt.exam"
    compileSdk = 36

    defaultConfig {
        applicationId = "id.sman94.cbt.exam"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "CBT_BASE_URL", "\"http://192.168.1.3:5173/\"")
        buildConfigField("String", "CBT_API_BASE_URL", "\"http://192.168.1.3:4100/api\"")
        buildConfigField("String", "EXAM_CLIENT_ID", "\"sman94-exam-browser\"")
        buildConfigField("String", "EXAM_CLIENT_KEY", "\"dev-exam-client-key\"")
        buildConfigField("String", "SECURITY_MODE_LABEL", "\"Hybrid\"")
        buildConfigField("Boolean", "REQUIRE_OVERLAY", "false")
    }

    flavorDimensions += "security"

    productFlavors {
        create("hybrid") {
            dimension = "security"
            applicationIdSuffix = ".hybrid"
            versionNameSuffix = "-hybrid"
            resValue("string", "app_name", "CBT SMAN 94 Hybrid")
            buildConfigField("String", "SECURITY_MODE_LABEL", "\"Hybrid\"")
            buildConfigField("Boolean", "REQUIRE_OVERLAY", "false")
        }

        create("overlay") {
            dimension = "security"
            applicationIdSuffix = ".overlay"
            versionNameSuffix = "-overlay"
            resValue("string", "app_name", "CBT SMAN 94 Overlay")
            buildConfigField("String", "SECURITY_MODE_LABEL", "\"Overlay\"")
            buildConfigField("Boolean", "REQUIRE_OVERLAY", "true")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun quotedBuildConfig(value: String): String {
    return "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""
}

fun configValue(name: String, defaultValue: String): String {
    return (findProperty(name) as String?) ?: System.getenv(name) ?: defaultValue
}

val cbtBaseUrl = configValue("CBT_BASE_URL", "http://120.29.153.130:5173/").trim().trimEnd('/') + "/"
val cbtApiBaseUrl = configValue("CBT_API_BASE_URL", "http://120.29.153.130:4100/api").trim().trimEnd('/')
val examClientKey = configValue("EXAM_CLIENT_KEY", "dev-exam-client-key").trim()

android {
    namespace = "id.sman94.cbt.exam"
    compileSdk = 36

    defaultConfig {
        applicationId = "id.sman94.cbt.exam"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "CBT_BASE_URL", quotedBuildConfig(cbtBaseUrl))
        buildConfigField("String", "CBT_API_BASE_URL", quotedBuildConfig(cbtApiBaseUrl))
        buildConfigField("String", "EXAM_CLIENT_ID", "\"sman94-exam-browser\"")
        buildConfigField("String", "EXAM_CLIENT_KEY", quotedBuildConfig(examClientKey))
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

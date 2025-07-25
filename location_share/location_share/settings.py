# location_share/settings.py
import os
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = 'IYr0ucl/HPSlnH/vRcn7SqTnC7gi06Xk+LWEbm+E'

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True

ALLOWED_HOSTS = ['locationsshare.com','52.192.90.62', '127.0.0.1', 'localhost']
# メール設定
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.gmail.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = 'hujisimariku33@gmail.com'
EMAIL_HOST_PASSWORD = 'hcyn apie qaxf yxfd'
DEFAULT_FROM_EMAIL = 'hujisimariku33@gmail.com'

# お問い合わせメール受信先（オプション）
CONTACT_EMAIL = 'hujisimariku33@gmail.com'
#Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'channels',
    'tracker',
    'django.contrib.sitemaps',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'location_share.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'location_share.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'locations',         # 作成したPostgreSQLのデータベース名
        'USER': 'postgres',         # PostgreSQLのユーザー名
        'PASSWORD': '3333', # パスワード
        'HOST': 'localhost',            # 通常はローカル開発なら 'localhost'
        'PORT': '5432',                 # PostgreSQLのデフォルトポート
    }
}


# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# ASGIアプリケーション
ASGI_APPLICATION = 'location_share.asgi.application'

# 開発用のInMemoryChannelLayerを使用
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
            'CONFIG': {
            'expiry': 300,  # 5分
        },
    },
}
WEBSOCKET_TIMEOUT = 60  # 60秒
# 本番環境でRedisを使用する場合は以下をコメントアウト解除
# CHANNEL_LAYERS = {
#     'default': {
#         'BACKEND': 'channels_redis.core.RedisChannelLayer',
#         'CONFIG': {
#             "hosts": [('127.0.0.1', 6379)],
#         },
#     },
# }
# Internationalization
LANGUAGE_CODE = 'ja'
TIME_ZONE = 'Asia/Tokyo'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
#STATIC_ROOT = '/usr/share/nginx/html/static'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')  # ←追加！なければNoneになる

# Media files
MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Session settings
SESSION_COOKIE_AGE = 24 * 60 * 60  # 24時間
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SESSION_SAVE_EVERY_REQUEST = True
# HTTPS設定
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_TLS = True

# Security settings for production
if not DEBUG:
    SECURE_SSL_REDIRECT = False
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER = True
    X_FRAME_OPTIONS = 'DENY'
    
    # HTTPS settings
    CSRF_COOKIE_SECURE = False
    SESSION_COOKIE_SECURE = False

# Logging
# Logging
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'django.log',  # ログディレクトリを作らずにプロジェクトルートに保存
            'formatter': 'verbose',
        },
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
        'contact_file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'contact.log',
            'formatter': 'simple',
        },
    },
    'root': {
        'handlers': ['console'],  # ファイルハンドラーを削除して一旦コンソールのみに
        'level': 'INFO',
    },
    'loggers': {
        'tracker.views': {
            'handlers': ['contact_file'],
            'level': 'INFO',
            'propagate': False,  # Trueだと重複してログが出力される可能性がある
        },
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}

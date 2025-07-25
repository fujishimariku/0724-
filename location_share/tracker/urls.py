# tracker/urls.py
from django.urls import path
from . import views

app_name = 'tracker'

urlpatterns = [
    # メインページ
    path('', views.home, name='home'),
    path('contact/', views.contact, name='contact'),
    # セッション管理
    path('create/', views.create_session, name='create_session'),
    path('session/<uuid:session_id>/', views.session_created, name='session_created'),
    path('share/<uuid:session_id>/', views.share_location, name='share_location'),
    
    # API エンドポイント
    path('api/session/<uuid:session_id>/update/', views.api_update_location, name='api_update_location'),
    path('api/session/<uuid:session_id>/locations/', views.api_get_locations, name='api_get_locations'),
    path('api/session/<uuid:session_id>/leave/', views.api_leave_session, name='api_leave_session'),
]
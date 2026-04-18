from django.urls import path
from . import views

app_name = 'transcriber'

urlpatterns = [
    path('', views.main_view, name='record'),
    path('upload/', views.main_view, {'default_tab': 'upload'}, name='upload'),
    path('api/upload/', views.record_upload_view, name='api_upload'),
    path('api/upload-file/', views.api_upload_file_view, name='api_upload_file'),
    path('result/<int:pk>/', views.result_view, name='result'),
    path('download/<int:pk>/', views.download_view, name='download'),
]

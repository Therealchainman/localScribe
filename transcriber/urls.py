from django.urls import path
from . import views

app_name = 'transcriber'

urlpatterns = [
    path('', views.record_view, name='record'),
    path('upload/', views.upload_view, name='upload'),
    path('api/upload/', views.record_upload_view, name='api_upload'),
    path('result/<int:pk>/', views.result_view, name='result'),
    path('download/<int:pk>/', views.download_view, name='download'),
]

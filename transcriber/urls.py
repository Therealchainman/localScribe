from django.urls import path
from . import views

app_name = 'transcriber'

urlpatterns = [
    path('', views.main_view, name='record'),
    path('upload/', views.main_view, {'default_tab': 'upload'}, name='upload'),
    path('api/upload/', views.api_upload_view, name='api_upload'),
]

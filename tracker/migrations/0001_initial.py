# Generated by Django 5.2.4 on 2025-07-25 01:45

import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='LocationSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('session_id', models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ('duration_minutes', models.IntegerField(choices=[(15, '15分'), (30, '30分'), (60, '1時間'), (120, '2時間'), (240, '4時間'), (480, '8時間'), (720, '12時間')], default=30)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('is_active', models.BooleanField(default=True)),
                ('max_participants', models.IntegerField(default=50)),
            ],
        ),
        migrations.CreateModel(
            name='LocationData',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('participant_id', models.CharField(max_length=50)),
                ('participant_name', models.CharField(blank=True, max_length=100)),
                ('latitude', models.DecimalField(blank=True, decimal_places=10, max_digits=13, null=True)),
                ('longitude', models.DecimalField(blank=True, decimal_places=10, max_digits=13, null=True)),
                ('accuracy', models.FloatField(blank=True, null=True)),
                ('timestamp', models.DateTimeField(auto_now_add=True)),
                ('last_updated', models.DateTimeField(auto_now=True)),
                ('is_active', models.BooleanField(default=True)),
                ('is_background', models.BooleanField(default=False)),
                ('is_online', models.BooleanField(default=True)),
                ('connection_count', models.IntegerField(default=0)),
                ('altitude', models.FloatField(blank=True, null=True)),
                ('heading', models.FloatField(blank=True, null=True)),
                ('speed', models.FloatField(blank=True, null=True)),
                ('status', models.CharField(choices=[('waiting', '共有待機中'), ('sharing', '共有中'), ('stopped', '共有停止中')], default='waiting', max_length=20)),
                ('session', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='locations', to='tracker.locationsession')),
            ],
            options={
                'ordering': ['-last_updated'],
                'indexes': [models.Index(fields=['session', 'is_active'], name='tracker_loc_session_9e28d8_idx'), models.Index(fields=['participant_id', 'last_updated'], name='tracker_loc_partici_99883a_idx'), models.Index(fields=['session', 'is_active', 'last_updated'], name='tracker_loc_session_fc7906_idx')],
                'unique_together': {('session', 'participant_id')},
            },
        ),
        migrations.CreateModel(
            name='SessionLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(choices=[('created', 'セッション作成'), ('joined', '参加'), ('left', '退出'), ('expired', '期限切れ'), ('location_updated', '位置更新'), ('websocket_connected', 'WebSocket接続'), ('websocket_disconnected', 'WebSocket切断'), ('error', 'エラー')], max_length=50)),
                ('participant_id', models.CharField(blank=True, max_length=50)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.TextField(blank=True)),
                ('timestamp', models.DateTimeField(auto_now_add=True)),
                ('connection_id', models.CharField(blank=True, max_length=100)),
                ('error_message', models.TextField(blank=True)),
                ('additional_data', models.JSONField(blank=True, null=True)),
                ('session', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='logs', to='tracker.locationsession')),
            ],
            options={
                'ordering': ['-timestamp'],
                'indexes': [models.Index(fields=['session', 'action'], name='tracker_ses_session_79f120_idx'), models.Index(fields=['participant_id', 'timestamp'], name='tracker_ses_partici_e15460_idx'), models.Index(fields=['action', 'timestamp'], name='tracker_ses_action_9bea46_idx')],
            },
        ),
        migrations.CreateModel(
            name='WebSocketConnection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('participant_id', models.CharField(max_length=50)),
                ('channel_name', models.CharField(max_length=255)),
                ('connected_at', models.DateTimeField(auto_now_add=True)),
                ('last_ping', models.DateTimeField(auto_now=True)),
                ('is_active', models.BooleanField(default=True)),
                ('session', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='connections', to='tracker.locationsession')),
            ],
            options={
                'indexes': [models.Index(fields=['session', 'is_active'], name='tracker_web_session_decdf8_idx'), models.Index(fields=['participant_id', 'is_active'], name='tracker_web_partici_025cab_idx')],
                'unique_together': {('session', 'participant_id', 'channel_name')},
            },
        ),
    ]

# tracker/models.py
from django.db import models
import uuid
from django.utils import timezone
from datetime import timedelta

class LocationSession(models.Model):
    """位置情報共有セッション"""
    DURATION_CHOICES = [
        (15, '15分'),
        (30, '30分'),
        (60, '1時間'),
        (120, '2時間'),
        (240, '4時間'),
        (480, '8時間'),
        (720, '12時間'),
    ]
    
    session_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    duration_minutes = models.IntegerField(choices=DURATION_CHOICES, default=30)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    
    # WebSocket関連のメタデータ
    max_participants = models.IntegerField(default=50)  # 最大参加者数
    
    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(minutes=self.duration_minutes)
        super().save(*args, **kwargs)
    
    def is_expired(self):
        return timezone.now() > self.expires_at
    
    def get_share_url(self):
        return f"/share/{self.session_id}"
    
    def get_websocket_url(self, request=None):
        """WebSocket接続URLを取得"""
        protocol = 'wss' if request and request.is_secure() else 'ws'
        host = request.get_host() if request else 'localhost:8000'
        return f"{protocol}://{host}/ws/location/{self.session_id}/"
    
    def get_active_participants_count(self):
        """アクティブな参加者数を取得"""
        return self.locations.filter(is_active=True).count()
    
    def get_active_participants(self):
        """アクティブな参加者のリストを取得"""
        return self.locations.filter(is_active=True).order_by('-last_updated')
    
    # def cleanup_inactive_participants(self, inactive_threshold_minutes=5):
    #     """非アクティブな参加者をクリーンアップ"""
    #     threshold_time = timezone.now() - timedelta(minutes=inactive_threshold_minutes)
    #     inactive_count = self.locations.filter(
    #         last_updated__lt=threshold_time,
    #         is_active=True
    #     ).update(is_active=False)
    #     return inactive_count
    
    def __str__(self):
        return f"Session {self.session_id} - {self.duration_minutes}分"

class LocationData(models.Model):
    """位置情報データ"""
    session = models.ForeignKey(LocationSession, on_delete=models.CASCADE, related_name='locations')
    participant_id = models.CharField(max_length=50)  # 参加者の一意識別子
    participant_name = models.CharField(max_length=100, blank=True)  # 表示名（任意）
    latitude = models.DecimalField(decimal_places=10, max_digits=13, null=True, blank=True)
    longitude = models.DecimalField(decimal_places=10, max_digits=13, null=True, blank=True)
    accuracy = models.FloatField(blank=True, null=True)  # 精度（メートル）
    timestamp = models.DateTimeField(auto_now_add=True)  # 初回作成時刻
    last_updated = models.DateTimeField(auto_now=True)  # 最終更新時刻
    
    # WebSocket関連フィールド
    is_active = models.BooleanField(default=True)  # 参加者がアクティブかどうか
    is_background = models.BooleanField(default=False)  # バックグラウンド状態
    is_online = models.BooleanField(default=True)  # オンライン状態
    connection_count = models.IntegerField(default=0)  # WebSocket接続数
    
    # 追加の位置情報メタデータ
    altitude = models.FloatField(blank=True, null=True)  # 高度
    heading = models.FloatField(blank=True, null=True)  # 方位角
    speed = models.FloatField(blank=True, null=True)  # 速度
    status = models.CharField(
    max_length=20, 
    choices=[
        ('waiting', '共有待機中'),
        ('sharing', '共有中'),
        ('stopped', '共有停止中'),
    ],
    default='waiting'
    )
    class Meta:
        unique_together = ['session', 'participant_id']
        ordering = ['-last_updated']
        indexes = [
            models.Index(fields=['session', 'is_active']),
            models.Index(fields=['participant_id', 'last_updated']),
            models.Index(fields=['session', 'is_active', 'last_updated']),
        ]
    
    def get_display_name(self):
        """表示用の名前を取得"""
        return self.participant_name or f'参加者{self.participant_id[:8]}'
    
    def is_recently_active(self, minutes=1):
        """最近アクティブだったかチェック"""
        threshold = timezone.now() - timedelta(minutes=minutes)
        return self.last_updated > threshold
    
    def update_location(self, latitude, longitude, accuracy=None, **kwargs):
        """位置情報を更新"""
        self.latitude = latitude
        self.longitude = longitude
        if accuracy is not None:
            self.accuracy = accuracy
        
        # 追加のフィールドを更新
        for field, value in kwargs.items():
            if hasattr(self, field) and value is not None:
                setattr(self, field, value)
        
        self.last_updated = timezone.now()
        self.is_active = True
        self.save()
    
    # def set_offline(self):
    #     """オフライン状態に設定"""
    #     self.is_active = False
    #     self.is_online = False
    #     self.connection_count = 0
    #     self.save()
    
    def increment_connection(self):
        """WebSocket接続数を増加"""
        self.connection_count += 1
        self.is_online = True
        self.is_active = True
        self.save()
    
    def decrement_connection(self):
        """WebSocket接続数を減少"""
        self.connection_count = max(0, self.connection_count - 1)
        if self.connection_count == 0:
            self.is_online = False
        self.save()
    
    def __str__(self):
        name = self.get_display_name()
        return f"{name} - {self.latitude}, {self.longitude}"

class SessionLog(models.Model):
    """セッション利用ログ（統計・デバッグ用）"""
    ACTION_CHOICES = [
        ('created', 'セッション作成'),
        ('joined', '参加'),
        ('left', '退出'),
        ('expired', '期限切れ'),
        ('location_updated', '位置更新'),
        ('websocket_connected', 'WebSocket接続'),
        ('websocket_disconnected', 'WebSocket切断'),
        ('error', 'エラー'),
    ]
    
    session = models.ForeignKey(LocationSession, on_delete=models.CASCADE, related_name='logs')
    action = models.CharField(max_length=50, choices=ACTION_CHOICES)
    participant_id = models.CharField(max_length=50, blank=True)
    ip_address = models.GenericIPAddressField(blank=True, null=True)
    user_agent = models.TextField(blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    
    # WebSocket関連の追加情報
    connection_id = models.CharField(max_length=100, blank=True)  # WebSocket接続ID
    error_message = models.TextField(blank=True)  # エラーメッセージ
    additional_data = models.JSONField(blank=True, null=True)  # 追加のメタデータ
    
    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['session', 'action']),
            models.Index(fields=['participant_id', 'timestamp']),
            models.Index(fields=['action', 'timestamp']),
        ]
    
    def __str__(self):
        action_display = dict(self.ACTION_CHOICES).get(self.action, self.action)
        return f"{action_display} - {self.session.session_id}"

class WebSocketConnection(models.Model):
    """WebSocket接続の管理"""
    session = models.ForeignKey(LocationSession, on_delete=models.CASCADE, related_name='connections')
    participant_id = models.CharField(max_length=50)
    channel_name = models.CharField(max_length=255)  # Django Channelsのチャンネル名
    connected_at = models.DateTimeField(auto_now_add=True)
    last_ping = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)
    
    class Meta:
        unique_together = ['session', 'participant_id', 'channel_name']
        indexes = [
            models.Index(fields=['session', 'is_active']),
            models.Index(fields=['participant_id', 'is_active']),
        ]
    
    def is_connected(self, timeout_minutes=2):
        """接続が生きているかチェック"""
        if not self.is_active:
            return False
        threshold = timezone.now() - timedelta(minutes=timeout_minutes)
        return self.last_ping > threshold
    
    def ping(self):
        """接続のpingを更新"""
        self.last_ping = timezone.now()
        self.save()
    
    def disconnect(self):
        """接続を切断状態に設定"""
        self.is_active = False
        self.save()
    
    def __str__(self):
        return f"{self.participant_id} - {self.channel_name}"
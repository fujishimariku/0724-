import json
import logging
from datetime import datetime, timedelta
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from .models import LocationSession, LocationData

logger = logging.getLogger(__name__)

class LocationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.session_id = self.scope['url_route']['kwargs']['session_id']
        self.room_group_name = f'location_{self.session_id}'
        self.participant_id = None
        
        # セッションの有効性をチェック
        session_exists = await self.check_session_exists(self.session_id)
        if not session_exists:
            await self.close()
            return
            
        # グループに参加
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        await self.accept()
        logger.info(f"WebSocket connection established for session {self.session_id}")

    async def disconnect(self, close_code):
        if self.participant_id:
            # 参加者をオフライン状態に更新（位置情報もクリア）
            await self.update_participant_offline_with_location_clear(self.participant_id)
            
            # 更新された情報を全参加者に即座に送信
            await self.broadcast_updated_locations()
            
            # 参加者のオフライン状態をグループに通知
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'participant_offline',
                    'participant_id': self.participant_id,
                    'participant_name': await self.get_participant_name(self.participant_id)
                }
            )
        
        # グループから退出
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        
        logger.info(f"WebSocket disconnected for session {self.session_id}, participant {self.participant_id}")

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            
            if message_type == 'join':
                await self.handle_join(data)
            elif message_type == 'location_update':
                await self.handle_location_update(data)
            elif message_type == 'name_update':
                await self.handle_name_update(data)
            elif message_type == 'background_status_update':
                await self.handle_background_status_update(data)
            elif message_type == 'stop_sharing':
                await self.handle_stop_sharing(data)
            elif message_type == 'confirm_stop_sharing':
                await self.handle_confirm_stop_sharing(data)
            elif message_type == 'sync_status':
                await self.handle_sync_status(data)
            elif message_type == 'offline':
                await self.handle_offline(data)
            elif message_type == 'leave':
                await self.handle_leave(data)
            elif message_type == 'ping':
                await self.handle_ping(data)
            else:
                logger.warning(f"Unknown message type: {message_type}")
                
        except json.JSONDecodeError:
            logger.error("Invalid JSON received")
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Invalid JSON format'
            }))
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Internal server error'
            }))

    async def handle_join(self, data):
        self.participant_id = data.get('participant_id')
        participant_name = data.get('participant_name', '')
        is_sharing = data.get('is_sharing', False)
        has_cached_position = data.get('has_cached_position', False)
        initial_status = data.get('initial_status', 'waiting')
        
        logger.info(f"Participant {self.participant_id} joining - sharing: {is_sharing}, cached: {has_cached_position}, status: {initial_status}")
        
        # 参加者情報を更新（初期状態を正確に設定）
        if is_sharing or (has_cached_position and initial_status == 'sharing'):
            # 共有中または復帰時に共有状態
            await self.update_participant_info(self.participant_id, participant_name, is_online=True, status='sharing')
        else:
            # 初回参加または共有停止中の場合は待機状態
            await self.update_participant_info(self.participant_id, participant_name, is_online=True, status='waiting')
        
        # 全参加者に即座に更新を送信
        await self.broadcast_updated_locations()
        
        # 自分にも現在の状況を送信
        locations = await self.get_all_locations()
        await self.send(text_data=json.dumps({
            'type': 'location_update',
            'locations': locations
        }))

    async def handle_location_update(self, data):
        participant_id = data.get('participant_id')
        
        # セッションの有効期限をチェック
        is_valid = await self.check_session_valid()
        if not is_valid:
            await self.send(text_data=json.dumps({
                'type': 'session_expired',
                'message': 'Session has expired'
            }))
            return
        
        logger.info(f"Location update from {participant_id} - background: {data.get('is_background', False)}")
        
        # 位置情報をデータベースに保存（ステータスを'sharing'に更新）
        await self.save_location_data({
            'participant_id': participant_id,
            'participant_name': data.get('participant_name', ''),
            'latitude': data.get('latitude'),
            'longitude': data.get('longitude'),
            'accuracy': data.get('accuracy'),
            'is_background': data.get('is_background', False),
            'is_online': True,
            'status': 'sharing'
        })
        
        # 全参加者に即座に位置情報更新を送信
        await self.broadcast_updated_locations()

    async def handle_stop_sharing(self, data):
        """位置共有停止を処理（待機状態に戻す）"""
        participant_id = data.get('participant_id')
        participant_name = data.get('participant_name', '')
        is_background = data.get('is_background', False)
        
        logger.info(f"Stop sharing from {participant_id} - background: {is_background}")
        
        # 待機状態に更新（位置情報をクリア、ステータスを'waiting'に）
        await self.update_participant_to_waiting(participant_id)
        
        # 全参加者に即座に更新を送信
        await self.broadcast_updated_locations()

    async def handle_confirm_stop_sharing(self, data):
        """バックグラウンドでの共有停止確認"""
        participant_id = data.get('participant_id')
        participant_name = data.get('participant_name', '')
        
        logger.info(f"Confirm stop sharing from {participant_id} (background)")
        
        # 確実に待機状態に更新
        await self.update_participant_to_waiting(participant_id)
        
        # 全参加者に即座に更新を送信
        await self.broadcast_updated_locations()

    async def handle_sync_status(self, data):
        """フォアグラウンド復帰時の状態同期"""
        participant_id = data.get('participant_id')
        participant_name = data.get('participant_name', '')
        is_sharing = data.get('is_sharing', False)
        status = data.get('status', 'waiting')
        is_background = data.get('is_background', False)
        
        logger.info(f"Status sync from {participant_id} - sharing: {is_sharing}, status: {status}, background: {is_background}")
        
        # 状態を同期
        if is_sharing:
            await self.update_participant_info(participant_id, participant_name, is_online=True, status='sharing')
        else:
            await self.update_participant_to_waiting(participant_id)
        
        # バックグラウンド状態も更新
        await self.update_background_status(participant_id, is_background)
        
        # 全参加者に即座に更新を送信
        await self.broadcast_updated_locations()

    async def handle_name_update(self, data):
        participant_id = data.get('participant_id')
        participant_name = data.get('participant_name', '')
        
        logger.info(f"Name update from {participant_id}: {participant_name}")
        
        await self.update_participant_info(participant_id, participant_name, is_online=True)
        
        # 全参加者に即座に更新を送信
        await self.broadcast_updated_locations()

    async def handle_background_status_update(self, data):
        participant_id = data.get('participant_id')
        is_background = data.get('is_background', False)
        participant_name = data.get('participant_name', '')
        is_sharing = data.get('is_sharing', False)
        
        logger.info(f"Background status update from {participant_id} - background: {is_background}, sharing: {is_sharing}")
        
        # データベースのバックグラウンド状態を更新
        await self.update_background_status(participant_id, is_background)
        
        # 即座に全参加者に背景状態変更を送信
        await self.broadcast_background_status_change(participant_id, participant_name, is_background)

    async def handle_ping(self, data):
        """Pingメッセージの処理"""
        participant_id = data.get('participant_id')
        is_sharing = data.get('is_sharing', False)
        has_position = data.get('has_position', False)
        
        if participant_id:
            # 最終更新時刻を更新
            await self.update_participant_last_seen(participant_id)
        
        # Pongレスポンスを送信
        await self.send(text_data=json.dumps({
            'type': 'pong',
            'timestamp': data.get('timestamp'),
            'participant_id': participant_id
        }))

    async def handle_offline(self, data):
        """完全なオフライン状態を処理"""
        participant_id = data.get('participant_id')
        participant_name = data.get('participant_name', '')
        
        logger.info(f"Offline notification from {participant_id}")
        
        # オフライン状態に更新（位置情報をクリア、ステータスを'stopped'に）
        await self.update_participant_offline_with_location_clear(participant_id)
        
        # 全参加者に即座に更新を送信
        await self.broadcast_updated_locations()

    async def handle_leave(self, data):
        participant_id = data.get('participant_id')
        
        logger.info(f"Leave request from {participant_id}")
        
        # 完全に退出する場合は非アクティブ状態に設定
        await self.update_participant_inactive(participant_id)
        
        # 全参加者に即座に更新を送信
        await self.broadcast_updated_locations()
        
        await self.close()

    async def broadcast_updated_locations(self):
        """全参加者に更新された位置情報を即座に送信"""
        locations = await self.get_all_locations()
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'location_broadcast',
                'locations': locations
            }
        )

    async def broadcast_background_status_change(self, participant_id, participant_name, is_background):
        """バックグラウンド状態変更を全参加者に送信"""
        locations = await self.get_all_locations()
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'background_status_change_broadcast',
                'participant_id': participant_id,
                'participant_name': participant_name,
                'is_background': is_background,
                'locations': locations
            }
        )

    # グループメッセージハンドラー
    async def location_broadcast(self, event):
        await self.send(text_data=json.dumps({
            'type': 'location_update',
            'locations': event['locations']
        }))

    async def background_status_change_broadcast(self, event):
        await self.send(text_data=json.dumps({
            'type': 'background_status_change',
            'participant_id': event['participant_id'],
            'participant_name': event['participant_name'],
            'is_background': event['is_background'],
            'locations': event['locations']
        }))

    async def participant_joined(self, event):
        # 自分以外に通知
        if event['participant_id'] != self.participant_id:
            await self.send(text_data=json.dumps({
                'type': 'participant_joined',
                'participant_id': event['participant_id'],
                'participant_name': event['participant_name']
            }))

    async def participant_offline(self, event):
        # 自分以外に通知
        if event['participant_id'] != self.participant_id:
            await self.send(text_data=json.dumps({
                'type': 'participant_offline',
                'participant_id': event['participant_id'],
                'participant_name': event['participant_name']
            }))

    async def participant_left(self, event):
        # 自分以外に通知
        if event['participant_id'] != self.participant_id:
            await self.send(text_data=json.dumps({
                'type': 'participant_left',
                'participant_id': event['participant_id'],
                'participant_name': event['participant_name']
            }))

    # データベース操作メソッド
    @database_sync_to_async
    def check_session_exists(self, session_id):
        return LocationSession.objects.filter(session_id=session_id).exists()

    @database_sync_to_async
    def check_session_valid(self):
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            return timezone.now() < session.expires_at
        except LocationSession.DoesNotExist:
            return False

    @database_sync_to_async
    def save_location_data(self, data):
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            
            location, _ = LocationData.objects.update_or_create(
                session=session,
                participant_id=data['participant_id'],
                defaults={
                    'participant_name': data['participant_name'],
                    'latitude': data['latitude'],
                    'longitude': data['longitude'],
                    'accuracy': data.get('accuracy'),
                    'last_updated': timezone.now(),
                    'is_active': True,
                    'is_online': data.get('is_online', True),
                    'is_background': data.get('is_background', False),
                    'altitude': data.get('altitude'),
                    'heading': data.get('heading'),
                    'speed': data.get('speed'),
                    'status': data.get('status', 'sharing')
                }
            )
            return location
        except LocationSession.DoesNotExist:
            return None

    @database_sync_to_async
    def get_all_locations(self):
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            # is_activeがTrueの参加者のみを取得（オンライン・オフライン問わず）
            locations = LocationData.objects.filter(
                session=session,
                is_active=True
            ).order_by('-last_updated')
            
            return [
                {
                    'participant_id': loc.participant_id,
                    'participant_name': loc.participant_name,
                    'latitude': float(loc.latitude) if loc.latitude else None,
                    'longitude': float(loc.longitude) if loc.longitude else None,
                    'accuracy': float(loc.accuracy) if loc.accuracy else None,
                    'last_updated': loc.last_updated.isoformat(),
                    'is_background': loc.is_background,
                    'is_online': loc.is_online,
                    'status': loc.status,
                    'altitude': float(loc.altitude) if loc.altitude else None,
                    'heading': float(loc.heading) if loc.heading else None,
                    'speed': float(loc.speed) if loc.speed else None
                }
                for loc in locations
            ]
        except LocationSession.DoesNotExist:
            return []

    @database_sync_to_async
    def update_participant_info(self, participant_id, participant_name, is_online=True, status=None):
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            
            # 既存のレコードを取得または作成
            location, created = LocationData.objects.get_or_create(
                session=session,
                participant_id=participant_id,
                defaults={
                    'participant_name': participant_name,
                    'is_online': is_online,
                    'is_active': True,
                    'status': status or 'waiting',
                    'last_updated': timezone.now()
                }
            )
            
            # 既存のレコードの場合は更新
            if not created:
                location.participant_name = participant_name
                location.is_online = is_online
                location.is_active = True
                if status:
                    location.status = status
                location.last_updated = timezone.now()
                location.save()
                
        except LocationSession.DoesNotExist:
            pass

    @database_sync_to_async
    def update_participant_to_waiting(self, participant_id):
        """参加者を待機状態にする（位置情報をクリアしてwaitingステータスに）"""
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            LocationData.objects.filter(
                session=session,
                participant_id=participant_id
            ).update(
                is_online=True,  # オンラインは維持
                status='waiting',  # 待機状態に
                latitude=None,
                longitude=None,
                accuracy=None,
                altitude=None,
                heading=None,
                speed=None,
                last_updated=timezone.now()
                # is_activeはTrueのまま維持してリストには残す
            )
        except LocationSession.DoesNotExist:
            pass

    @database_sync_to_async
    def update_participant_last_seen(self, participant_id):
        """参加者の最終確認時刻を更新"""
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            LocationData.objects.filter(
                session=session,
                participant_id=participant_id
            ).update(
                last_updated=timezone.now(),
                is_online=True
            )
        except LocationSession.DoesNotExist:
            pass

    @database_sync_to_async
    def update_background_status(self, participant_id, is_background):
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            LocationData.objects.filter(
                session=session,
                participant_id=participant_id
            ).update(
                is_background=is_background,
                last_updated=timezone.now()
            )
        except LocationSession.DoesNotExist:
            pass

    @database_sync_to_async
    def update_participant_offline_with_location_clear(self, participant_id):
        """参加者をオフライン状態にし、位置情報をクリアする"""
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            LocationData.objects.filter(
                session=session,
                participant_id=participant_id
            ).update(
                is_online=False,
                status='stopped',
                latitude=None,
                longitude=None,
                accuracy=None,
                altitude=None,
                heading=None,
                speed=None,
                last_updated=timezone.now()
                # is_activeはTrueのまま維持してリストには残す
            )
        except LocationSession.DoesNotExist:
            pass

    @database_sync_to_async
    def update_participant_offline(self, participant_id):
        """参加者をオフライン状態にする（リストには残す）"""
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            LocationData.objects.filter(
                session=session,
                participant_id=participant_id
            ).update(
                is_online=False,
                status='stopped',
                last_updated=timezone.now()
                # is_activeはTrueのまま維持してリストに残す
            )
        except LocationSession.DoesNotExist:
            pass

    @database_sync_to_async
    def update_participant_inactive(self, participant_id):
        """参加者を完全に非アクティブ状態にする（リストから削除）"""
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            LocationData.objects.filter(
                session=session,
                participant_id=participant_id
            ).update(
                is_active=False,
                is_online=False,
                status='stopped'
            )
        except LocationSession.DoesNotExist:
            pass

    @database_sync_to_async
    def get_participant_name(self, participant_id):
        try:
            session = LocationSession.objects.get(session_id=self.session_id)
            location = LocationData.objects.filter(
                session=session,
                participant_id=participant_id
            ).first()
            return location.participant_name if location else ''
        except LocationSession.DoesNotExist:
            return ''